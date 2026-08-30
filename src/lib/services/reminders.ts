import "server-only";

import { prisma } from "@/lib/db/prisma";
import {
  addCalendarDays,
  calendarDateIn,
  toCalendarDate,
} from "@/lib/domain/calendar";
import { derivePlan } from "@/lib/domain/payments";
import { evaluatePassport } from "@/lib/domain/passport";
import {
  passportAlertEmail,
  paymentReminderEmail,
} from "@/lib/email/templates";
import { formatMoney } from "@/lib/format";
import { formatEmailDate } from "@/lib/email/layout";
import {
  listPassengersForSystemJob,
  type PassengerForSystemJob,
} from "./passengers";
import {
  appUrl,
  footerFor,
  langOf,
  tripEmailContext,
  deliver,
} from "./notifications";
import type { Currency } from "@/lib/domain/fx";

/**
 * Avisos automáticos: recordatorios de cuota y alertas de pasaporte.
 *
 * Los dispara el cron diario, sin sesión. Toda la autorización está en el
 * endpoint (`CRON_SECRET`); acá abajo no hay decisiones de permisos.
 *
 * ── Idempotencia ──────────────────────────────────────────────────────────
 *
 * Dos corridas el mismo día no pueden mandar dos veces el mismo aviso. La
 * garantía es un índice unique en la base —`SentReminder(installmentId,
 * offsetDays)` y `SentNotification(kind, passengerId, tag)`— y el orden en
 * que se hacen las cosas:
 *
 *   1. Se INSERTA la marca. Si choca contra el unique, ya se mandó: se saltea.
 *   2. Recién entonces se manda el mail.
 *   3. Si el envío falla, se BORRA la marca para que la próxima corrida
 *      reintente.
 *
 * El orden importa. Mandando primero y marcando después, un fallo entre las
 * dos operaciones manda el mail otra vez mañana. Marcando primero, dos
 * ejecuciones simultáneas chocan en el INSERT y solo una manda — que es
 * exactamente lo que pide la ventana de disparo de ~1 h de Vercel Cron, donde
 * un reintento de la plataforma puede solaparse con la corrida original.
 *
 * El paso 3 admite un duplicado en un caso raro: si el proveedor mandó el mail
 * pero la respuesta se perdió, se borra la marca y mañana se reintenta. Un
 * recordatorio repetido es molesto; uno que nunca sale hace que alguien pierda
 * el viaje. La elección es deliberada.
 *
 * ── Corte y retome ───────────────────────────────────────────────────────
 *
 * Ninguna tarea asume que termina. Cada una recibe un presupuesto de mails y
 * un instante límite, y devuelve `remaining: true` si dejó cosas sin hacer.
 * Lo que queda pendiente no se pierde: al no existir su marca, la corrida
 * siguiente lo vuelve a encontrar.
 */

export interface TaskBudget {
  /** Máximo de mails que esta tarea puede mandar en esta corrida. */
  maxEmails: number;
  /** Momento a partir del cual hay que cortar, aunque quede presupuesto. */
  deadline: number;
}

export interface TaskResult {
  sent: number;
  /** Ya estaba avisado, o no correspondía. */
  skipped: number;
  failed: number;
  /** Quedó trabajo sin hacer. La corrida siguiente lo retoma. */
  remaining: boolean;
}

const EMPTY: TaskResult = {
  sent: 0,
  skipped: 0,
  failed: 0,
  remaining: false,
};

/** Estados de viaje en los que tiene sentido molestar a alguien por mail. */
const ACTIVE_TRIP_STATUSES = ["ABIERTO", "CERRADO"] as const;

function exhausted(budget: TaskBudget, sent: number): boolean {
  return sent >= budget.maxEmails || Date.now() >= budget.deadline;
}

// ------------------------- Recordatorios de cuota --------------------------

/**
 * Manda los recordatorios de cuota que correspondan hoy.
 *
 * Los offsets son por viaje (`Trip.reminderOffsetsDays`, default `[-7, 1]`):
 * negativo es antes del vencimiento, positivo después.
 *
 * La condición de disparo es `hoy >= vencimiento + offset`, no `hoy ==`. Con
 * la igualdad, un día que el cron no corrió —o corrió y falló— se pierde el
 * recordatorio para siempre. Con `>=`, la corrida siguiente lo manda igual,
 * tarde pero mandado, y el unique impide que se mande dos veces. La deuda
 * sigue existiendo aunque el cron haya tenido un mal día.
 *
 * NUNCA se manda a un pasajero CANCELADO ni a un coordinador, ni sobre una
 * cuota ya cubierta.
 */
export async function sendPaymentReminders(
  now: Date,
  budget: TaskBudget,
): Promise<TaskResult> {
  const result = { ...EMPTY };

  const trips = await prisma.trip.findMany({
    where: { status: { in: [...ACTIVE_TRIP_STATUSES] } },
    select: {
      id: true,
      currency: true,
      timezone: true,
      reminderOffsetsDays: true,
      paymentToleranceAmount: true,
    },
  });

  for (const trip of trips) {
    if (exhausted(budget, result.sent)) {
      result.remaining = true;
      return result;
    }

    const today = calendarDateIn(now, trip.timezone);

    const passengers = (await listPassengersForSystemJob(trip.id)).filter(
      (p) => !p.isCoordinator && p.status !== "CANCELADO" && p.email !== null,
    );
    if (passengers.length === 0) continue;

    const byId = new Map(passengers.map((p) => [p.id, p]));

    const plans = await prisma.paymentPlan.findMany({
      where: { passengerId: { in: passengers.map((p) => p.id) } },
      select: {
        passengerId: true,
        totalAmount: true,
        installments: {
          orderBy: { number: "asc" },
          select: { id: true, number: true, dueDate: true, amount: true },
        },
        payments: {
          select: {
            id: true,
            installmentId: true,
            kind: true,
            status: true,
            amountInTripCurrency: true,
          },
        },
      },
    });

    const context = await tripEmailContext(trip.id);

    for (const plan of plans) {
      const passenger = byId.get(plan.passengerId);
      if (!passenger?.email) continue;

      const derived = derivePlan({
        totalAmount: plan.totalAmount.toString(),
        installments: plan.installments.map((i) => ({
          id: i.id,
          number: i.number,
          dueDate: toCalendarDate(i.dueDate),
          amount: i.amount.toString(),
        })),
        payments: plan.payments.map((p) => ({
          id: p.id,
          installmentId: p.installmentId,
          kind: p.kind,
          status: p.status,
          amountInTripCurrency: p.amountInTripCurrency.toString(),
        })),
        today,
        tolerance: trip.paymentToleranceAmount.toString(),
      });

      for (const installment of derived.installments) {
        // Nunca sobre una cuota ya cubierta: el pasajero ya hizo lo suyo.
        if (installment.state === "PAGADA") continue;

        for (const offset of trip.reminderOffsetsDays) {
          if (exhausted(budget, result.sent)) {
            result.remaining = true;
            return result;
          }

          const target = addCalendarDays(installment.dueDate, offset);
          if (today < target) continue;

          const outcome = await sendOnce(
            () =>
              prisma.sentReminder.create({
                data: { installmentId: installment.id, offsetDays: offset },
                select: { id: true },
              }),
            (marker) =>
              prisma.sentReminder.delete({ where: { id: marker.id } }),
            async () => {
              const lang = langOf(passenger.preferredLanguage);
              const rendered = paymentReminderEmail(lang, {
                tripName: context.tripName,
                passengerName: passenger.fullName,
                installmentNumber: installment.number,
                amount: formatMoney(
                  installment.remaining.toFixed(2),
                  trip.currency as Currency,
                  lang,
                ),
                dueDate: formatEmailDate(installment.dueDate),
                balance: formatMoney(
                  derived.balance.toFixed(2),
                  trip.currency as Currency,
                  lang,
                ),
                overdue: installment.overdue,
                url: appUrl("/mis-pagos", lang),
                footer: footerFor(context, lang),
              });

              await deliver({
                to: passenger.email!,
                lang,
                rendered,
                context,
              });
            },
          );

          result[outcome] += 1;
        }
      }
    }
  }

  return result;
}

// -------------------------- Alertas de pasaporte ---------------------------

/**
 * Avisa a quien tiene el pasaporte vencido o por vencer.
 *
 * Una vez por nivel y por pasajero: el `tag` de `SentNotification` es
 * BLOQUEANTE o ADVERTENCIA. Sin eso, alguien con el pasaporte vencido
 * recibiría el mismo mail todos los días hasta renovarlo, que es la forma más
 * rápida de que empiece a ignorar los mails del viaje.
 *
 * Si el pasaporte empeora —pasa de amarillo a rojo— sí se manda de nuevo,
 * porque es un `tag` distinto y la situación cambió.
 */
export async function sendPassportAlerts(
  now: Date,
  budget: TaskBudget,
): Promise<TaskResult> {
  const result = { ...EMPTY };

  const trips = await prisma.trip.findMany({
    where: { status: { in: [...ACTIVE_TRIP_STATUSES] } },
    select: {
      id: true,
      endDate: true,
      passportValidityMonths: true,
      requireFullPassportValidity: true,
    },
  });

  for (const trip of trips) {
    if (exhausted(budget, result.sent)) {
      result.remaining = true;
      return result;
    }

    const passengers = (await listPassengersForSystemJob(trip.id)).filter(
      (p) => !p.isCoordinator && p.status !== "CANCELADO" && p.email !== null,
    );
    if (passengers.length === 0) continue;

    const context = await tripEmailContext(trip.id);

    for (const passenger of passengers) {
      if (exhausted(budget, result.sent)) {
        result.remaining = true;
        return result;
      }

      const evaluation = evaluatePassport(passenger.passportExpiryDate, {
        tripEndDate: trip.endDate,
        passportValidityMonths: trip.passportValidityMonths,
        requireFullPassportValidity: trip.requireFullPassportValidity,
      });

      // SIN_DATO también avisa: alguien que no cargó el pasaporte tiene el
      // mismo problema que alguien que lo tiene vencido, solo que todavía no
      // lo sabe.
      const level =
        evaluation.level === "BLOQUEANTE" || evaluation.level === "SIN_DATO"
          ? "BLOQUEANTE"
          : evaluation.level === "ADVERTENCIA"
            ? "ADVERTENCIA"
            : null;

      if (level === null) {
        result.skipped += 1;
        continue;
      }

      const outcome = await sendOnce(
        () =>
          prisma.sentNotification.create({
            data: {
              kind: "ALERTA_PASAPORTE",
              passengerId: passenger.id,
              tag: level,
            },
            select: { id: true },
          }),
        (marker) =>
          prisma.sentNotification.delete({ where: { id: marker.id } }),
        async () => {
          const lang = langOf(passenger.preferredLanguage);
          const rendered = passportAlertEmail(lang, {
            tripName: context.tripName,
            passengerName: passenger.fullName,
            level,
            expiryDate: passenger.passportExpiryDate
              ? formatEmailDate(passenger.passportExpiryDate)
              : null,
            minimumDate: formatEmailDate(evaluation.minimumExpiryToConfirm),
            tripEndDate: formatEmailDate(trip.endDate),
            url: appUrl("/mis-datos", lang),
            footer: footerFor(context, lang),
          });

          await deliver({ to: passenger.email!, lang, rendered, context });
        },
      );

      result[outcome] += 1;
    }
  }

  return result;
}

// ------------------------------- Mecánica ----------------------------------

/**
 * Marca primero, manda después, y desmarca si el envío falla.
 *
 * Es el corazón de la idempotencia. `claim` inserta la marca contra un índice
 * unique: si otra corrida ya la puso, el INSERT falla y no se manda nada. Ver
 * la nota larga arriba sobre por qué este orden y no el otro.
 */
async function sendOnce<T>(
  claim: () => Promise<T>,
  release: (marker: T) => Promise<unknown>,
  send: () => Promise<void>,
): Promise<"sent" | "skipped" | "failed"> {
  let marker: T;

  try {
    marker = await claim();
  } catch {
    // Chocó contra el unique: ya se avisó. No es un error.
    return "skipped";
  }

  try {
    await send();
    return "sent";
  } catch (error) {
    // Nunca el destinatario: esto va a los logs de la plataforma.
    console.error(
      `[cron] no se pudo enviar un aviso: ${(error as Error).message}`,
    );
    // Se suelta la marca para que la corrida siguiente reintente.
    await release(marker).catch(() => {});
    return "failed";
  }
}

export type { PassengerForSystemJob };

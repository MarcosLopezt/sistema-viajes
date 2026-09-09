import "server-only";

import { prisma } from "@/lib/db/prisma";
import {
  requireCapability,
  requireInterestAccess,
  requireSessionUser,
} from "@/lib/auth/guards";
import { ForbiddenError } from "@/lib/auth/errors";
import {
  confirmUploadForInterest,
  signDownloadWithinPersonFolder,
} from "./storage";
import { convertWithinTransaction } from "./interest";
import { recordAudit, auditMoney } from "./audit";
import { getFxSnapshot } from "./fx";
import {
  appUrl,
  footerFor,
  langOf,
  tripEmailContext,
  tryDeliver,
} from "./notifications";
import { paymentRejectedEmail } from "@/lib/email/templates";
import { pickLocalized } from "@/lib/domain/rich-text";
import { impute } from "@/lib/domain/payments";
import { convert, deriveRate, type Currency } from "@/lib/domain/fx";
import { toDecimal } from "@/lib/domain/money";
import {
  calendarDateIn,
  daysBetweenCalendarDates,
  fromCalendarDate,
  toCalendarDate,
} from "@/lib/domain/calendar";
import type {
  ConfirmDepositInput,
  RejectDepositInput,
  SubmitDepositInput,
} from "@/lib/validation/deposit";
import type { Language } from "@/generated/prisma/enums";

/**
 * La seña: de que la interesada transfiere, a que queda convertida en pasajera.
 *
 * ── Dónde vive la seña y por qué no es un Payment todavía ─────────────────
 *
 * Un `Payment` cuelga de un `PaymentPlan`, que cuelga de un `Passenger`. Acá
 * no hay ninguna de las tres cosas: la seña se paga ANTES de la conversión.
 * Vive en `DepositProof` mientras es una promesa, y se convierte en `Payment`
 * recién cuando `generatePaymentPlan` crea el plan que la puede alojar. El
 * detalle está en el docblock del modelo y en `services/payments.ts`.
 *
 * ── Lo que este módulo NO hace ────────────────────────────────────────────
 *
 * No toca `Passenger` ni `Person` con Prisma, igual que `interest.ts`. La
 * creación del Passenger en la conversión se la pide a
 * `convertWithinTransaction()`, que a su vez se la pide a
 * `services/passengers.ts`. `check:layers` lo verifica archivo por archivo.
 *
 * ── El orden de los actos, que es lo que hace que esto sea seguro ─────────
 *
 *   1. Ella sube el comprobante Y acepta la condición, en UNA transacción.
 *      No puede existir una fila sin texto aceptado ni una aceptación sin
 *      comprobante: las dos columnas son NOT NULL en la misma fila, así que
 *      lo garantiza el modelo y no el orden en que alguien llame a estas
 *      funciones.
 *   2. La coordinadora abre el comprobante y decide.
 *   3. Confirmar es, en el mismo acto, convertirla en pasajera. Lo que hace
 *      imposible convertir dos veces no es un chequeo previo sino un UPDATE
 *      condicionado al estado anterior — el mismo mecanismo de
 *      `confirmPayment`.
 */

export class DepositError extends Error {
  constructor(
    message: string,
    readonly reason:
      | "SIN_VIAJE_ABIERTO"
      | "SIN_MONTO_DEFINIDO"
      | "SIN_CONDICIONES"
      | "CONDICIONES_CAMBIARON"
      | "YA_HAY_UNA_VIGENTE"
      | "TC_FALTANTE"
      | "NO_CONVERTIBLE",
  ) {
    super(message);
    this.name = "DepositError";
  }
}

// ---------------------------------------------------------------------------
// 1 · Lo que ve la interesada
// ---------------------------------------------------------------------------

export interface MyDepositView {
  /** Monto de la seña, en la moneda del viaje. `null` si no lo cargaron. */
  amount: string | null;
  currency: Currency;
  /** La condición de no reembolsable, en el idioma del lector. */
  terms: string | null;
  /** Dónde transferir. Del viaje: una interesada no tiene override propio. */
  paymentInstructions: string | null;
  /** Su seña vigente, si ya subió una. */
  current: {
    id: string;
    status: "EN_REVISION" | "CONFIRMADO";
    amount: string;
    currency: Currency;
    transferDate: string;
  } | null;
  /**
   * El motivo del ÚLTIMO rechazo, y solo si no hay una vigente.
   *
   * Es lo primero que va a preguntar cuando vuelva a entrar, así que tiene que
   * estar en la pantalla y no en un mail que capaz no le llegó. Se muestra
   * únicamente el último: los rechazos anteriores son historia interna del
   * embudo, y una lista de todas las veces que le dijeron que no es un
   * castigo, no información. Por eso la consulta es un `findFirst` ordenado
   * por `reviewedAt` descendente, y no un `findMany`.
   */
  lastRejection: { reason: string | null; at: Date } | null;
}

/**
 * Todo lo que la pantalla de la seña necesita, en una sola lectura.
 *
 * El `select` del viaje enumera cinco campos y esa es la superficie completa:
 * ni cupos, ni precios de costo, ni una referencia a otra persona. Misma regla
 * que `getMyInterestView`.
 */
export async function getMyDepositView(
  locale: string,
): Promise<MyDepositView | null> {
  const user = await requireSessionUser();

  const interest = await prisma.interest.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      trip: {
        select: {
          currency: true,
          depositAmount: true,
          depositTermsEs: true,
          depositTermsEn: true,
          paymentInstructionsEs: true,
          paymentInstructionsEn: true,
        },
      },
    },
  });

  if (!interest) return null;

  const [current, lastRejected] = await Promise.all([
    prisma.depositProof.findFirst({
      where: { interestId: interest.id, status: { not: "RECHAZADO" } },
      select: {
        id: true,
        status: true,
        amount: true,
        currency: true,
        transferDate: true,
      },
    }),
    prisma.depositProof.findFirst({
      where: { interestId: interest.id, status: "RECHAZADO" },
      orderBy: { reviewedAt: "desc" },
      select: { rejectionReason: true, reviewedAt: true },
    }),
  ]);

  return {
    amount: interest.trip.depositAmount?.toString() ?? null,
    currency: interest.trip.currency as Currency,
    terms: pickLocalized(
      interest.trip.depositTermsEs,
      interest.trip.depositTermsEn,
      locale,
    ),
    paymentInstructions: pickLocalized(
      interest.trip.paymentInstructionsEs,
      interest.trip.paymentInstructionsEn,
      locale,
    ),
    current: current
      ? {
          id: current.id,
          status: current.status as "EN_REVISION" | "CONFIRMADO",
          amount: current.amount.toString(),
          currency: current.currency as Currency,
          transferDate: toCalendarDate(current.transferDate),
        }
      : null,
    // Con una seña vigente el rechazo viejo ya no es noticia: subió otra vez y
    // está esperando. Mostrarlo al lado de "en revisión" solo confunde.
    lastRejection:
      current === null && lastRejected
        ? {
            reason: lastRejected.rejectionReason,
            at: lastRejected.reviewedAt ?? new Date(0),
          }
        : null,
  };
}

// ---------------------------------------------------------------------------
// 2 · Subir el comprobante y aceptar la condición
// ---------------------------------------------------------------------------

/** El texto vigente de la condición, con su idioma. Nunca uno guardado antes. */
function currentTerms(
  trip: { depositTermsEs: string | null; depositTermsEn: string | null },
  locale: string,
): { text: string; lang: Language } | null {
  const text = pickLocalized(trip.depositTermsEs, trip.depositTermsEn, locale);
  if (!text) return null;

  // El idioma que se registra es el del TEXTO que efectivamente se mostró, no
  // el del navegador: `pickLocalized` cae al otro idioma si falta el propio, y
  // decir "aceptó en inglés" sobre un párrafo en español sería falso en un
  // registro que existe para ser leído dentro de un año.
  const shownEn = text === trip.depositTermsEn?.trim();
  return { text, lang: shownEn ? "EN" : "ES" };
}

/**
 * La interesada sube el comprobante de su seña y acepta la condición.
 *
 * ── Una sola escritura, no dos ────────────────────────────────────────────
 *
 * El comprobante y la aceptación entran en la MISMA fila y en la misma
 * transacción. No hay un momento en que exista una sin la otra, y no porque
 * las llamemos en orden: `proofFileId`, `acceptedTermsText`, `acceptedAt`,
 * `shownAmount` y `shownCurrency` son NOT NULL en `DepositProof`. Una fila a
 * medias no se puede escribir aunque alguien lo intente desde otro lado.
 *
 * ── Qué se congela, y por qué son cinco cosas y no una ───────────────────
 *
 * Se guarda el TEXTO exacto que se mostró, su idioma, la fecha, y el MONTO y
 * la MONEDA que lo acompañaban. Todo junto es lo que ella vio en pantalla ese
 * día. Si dentro de un año hay un reclamo, la pregunta no va a ser "¿aceptó?"
 * —eso lo contestaría un booleano— sino "¿qué decía la pantalla?", y a esa
 * solo la contesta una copia.
 *
 * Son copias y no referencias a propósito: cuando las coordinadoras editen las
 * condiciones o suban la seña, esta fila no se entera. Ese es el punto.
 *
 * ── Volver a subir después de un rechazo ─────────────────────────────────
 *
 * La aceptación se vuelve a pedir con el texto VIGENTE en ese momento; no se
 * hereda nada de la fila rechazada. Si cambiaron las condiciones en el medio,
 * lo que acepta son las nuevas — que es exactamente lo que va a regir, así que
 * es lo que tiene que haber leído.
 *
 * Como la fila vieja no se toca, el motivo por el que la rechazaron sigue
 * disponible. Volver a intentar no borra el historial de intentos.
 */
export async function submitDeposit(
  input: SubmitDepositInput,
  locale: string,
): Promise<{ depositId: string }> {
  const { interestId, tripId } = await requireInterestAccess();

  const trip = await prisma.trip.findUniqueOrThrow({
    where: { id: tripId },
    select: {
      currency: true,
      depositAmount: true,
      depositTermsEs: true,
      depositTermsEn: true,
    },
  });

  if (trip.depositAmount === null) {
    throw new DepositError(
      "Todavía no está definido el monto de la seña. Escribinos antes de transferir.",
      "SIN_MONTO_DEFINIDO",
    );
  }

  const terms = currentTerms(trip, locale);
  if (!terms) {
    // Sin condición cargada no se puede aceptar nada, y guardar un string
    // vacío como "lo que aceptó" sería peor que no dejarla avanzar: dejaría
    // una fila que dice que aceptó, sin decir qué.
    throw new DepositError(
      "Todavía no están cargadas las condiciones de la seña.",
      "SIN_CONDICIONES",
    );
  }

  // El texto que ella dice haber leído contra el que el servidor tiene ahora.
  // Si difieren, editaron las condiciones mientras tenía el formulario
  // abierto: se la manda a leer de nuevo en vez de guardar una aceptación de
  // algo que ya no rige.
  if (input.acceptedTermsText.trim() !== terms.text.trim()) {
    throw new DepositError(
      "Las condiciones cambiaron mientras completabas el formulario. Volvé a leerlas, por favor.",
      "CONDICIONES_CAMBIARON",
    );
  }

  // El comprobante se verifica contra el bucket —tipo y tamaño REALES, no los
  // que declaró el navegador— y la path se valida contra su carpeta.
  const proofPath = await confirmUploadForInterest(input.proofFileId);

  const tripCurrency = trip.currency as Currency;
  let provisionalRate: string | null = null;
  let amountInTripCurrency = toDecimal(input.amount).toFixed(2);

  // Igual que en `declarePayment`: la conversión que se guarda ahora es la
  // sugerida por definición, porque nadie miró todavía ningún extracto.
  if (input.currency !== tripCurrency) {
    const { snapshot } = await getFxSnapshot();
    provisionalRate = deriveRate(snapshot, input.currency, tripCurrency)
      .toDecimalPlaces(8)
      .toFixed(8);
    amountInTripCurrency = convert(
      input.amount,
      input.currency,
      tripCurrency,
      snapshot,
    ).toFixed(2);
  }

  try {
    const deposit = await prisma.depositProof.create({
      data: {
        interestId,
        amount: input.amount,
        currency: input.currency,
        fxRateUsed: provisionalRate,
        fxRateSource: provisionalRate === null ? null : "SUGERIDO",
        amountInTripCurrency,
        transferDate: fromCalendarDate(input.transferDate),
        proofFileId: proofPath,
        acceptedTermsText: terms.text,
        acceptedTermsLang: terms.lang,
        acceptedAt: new Date(),
        shownAmount: trip.depositAmount.toString(),
        shownCurrency: tripCurrency,
        status: "EN_REVISION",
      },
      select: { id: true },
    });

    return { depositId: deposit.id };
  } catch (error) {
    // El índice parcial "DepositProof_una_vigente_por_interesada". Dos envíos
    // simultáneos —doble tap en un teléfono con mala señal es el caso normal,
    // no el raro— llegan los dos hasta acá y el segundo choca. Se traduce a un
    // mensaje que la interesada pueda entender en vez de un 500.
    if (isUniqueViolation(error)) {
      throw new DepositError(
        "Ya tenemos un comprobante tuyo esperando revisión.",
        "YA_HAY_UNA_VIGENTE",
      );
    }
    throw error;
  }
}

/** ¿Es la violación de un índice único de Postgres? */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

// ---------------------------------------------------------------------------
// 3 · El comprobante
// ---------------------------------------------------------------------------

/** Quién es dueño de una seña y en qué viaje vive. Sin decidir nada todavía. */
async function depositContext(depositId: string) {
  const deposit = await prisma.depositProof.findUnique({
    where: { id: depositId },
    select: {
      id: true,
      status: true,
      amount: true,
      currency: true,
      amountInTripCurrency: true,
      proofFileId: true,
      interestId: true,
      interest: {
        select: {
          userId: true,
          tripId: true,
          status: true,
          user: {
            select: {
              personId: true,
              email: true,
              // Enumerado, como en `listInterests`: una interesada convertida
              // ya tiene pasaporte y datos de salud en su Person, y un
              // `person: true` acá los traería a un contexto que no los pide.
              person: {
                select: { fullName: true, preferredLanguage: true },
              },
            },
          },
          trip: { select: { currency: true, name: true } },
        },
      },
    },
  });

  // 404 y no 403: confirmarle a alguien que esa seña existe ya es información.
  if (!deposit) throw new ForbiddenError();
  return deposit;
}

/**
 * URL temporal para abrir el comprobante de una seña.
 *
 * ── Las dos puertas, y por qué la de la interesada no acepta un id ────────
 *
 * Lo puede abrir la coordinadora del viaje —capability `interest:manage`— o la
 * propia interesada. Para la coordinadora el `depositId` viene del cliente y se
 * valida contra su capability sobre el viaje AL QUE PERTENECE esa seña, no
 * contra un tripId que también venga del cliente.
 *
 * Para la interesada la comparación es contra el `userId` de la sesión: pedir
 * la seña de otra devuelve el mismo 404 que pedir una que no existe. Ese es el
 * caso que el test de aislamiento ejercita.
 */
export async function getDepositProofUrl(depositId: string): Promise<string> {
  const deposit = await depositContext(depositId);
  const { tripId, userId } = deposit.interest;

  const viewer = await requireSessionUser();
  const isOwner = viewer.id === userId;

  if (!isOwner) {
    // Tira ForbiddenError si no coordina este viaje. No se atrapa: quien no es
    // ni la dueña ni la coordinadora no tiene por qué distinguir los casos.
    await requireCapability(tripId, "interest:manage");
  }

  const personId = deposit.interest.user.personId;
  if (!personId) throw new ForbiddenError();

  return signDownloadWithinPersonFolder(
    tripId,
    personId,
    deposit.proofFileId,
    `deposito:${depositId}`,
  );
}

// ---------------------------------------------------------------------------
// 4 · La revisión de la coordinadora
// ---------------------------------------------------------------------------

export interface PendingDeposit {
  depositId: string;
  interestId: string;
  fullName: string | null;
  email: string;
  amount: string;
  currency: Currency;
  tripCurrency: Currency;
  provisionalAmountInTripCurrency: string;
  suggestedFxRate: string | null;
  transferDate: string;
  /** Lo que se le mostró al aceptar. Puede diferir del monto vigente hoy. */
  shownAmount: string;
  acceptedAt: Date;
  createdAt: Date;
  /**
   * Días enteros que la seña lleva esperando revisión, en la zona del viaje.
   *
   * Se calcula acá y no en el navegador por dos razones. Una es que "cuántos
   * días pasaron" depende de la zona horaria, y la del navegador de la
   * coordinadora no tiene por qué ser la del viaje. La otra es que un valor
   * derivado del reloj del cliente cambia entre el render del servidor y el
   * del navegador, y eso es un error de hidratación.
   */
  waitingDays: number;
}

/**
 * Las señas esperando revisión de un viaje.
 *
 * Los nombres salen de la Person a través de la Interest, con el `select`
 * enumerado: una interesada convertida ya tiene pasaporte y datos de salud
 * cargados, y un `person: true` acá los mostraría en esta pantalla.
 */
export async function listPendingDeposits(
  tripId: string,
  now: Date = new Date(),
): Promise<PendingDeposit[]> {
  await requireCapability(tripId, "interest:manage");

  const trip = await prisma.trip.findUniqueOrThrow({
    where: { id: tripId },
    select: { currency: true, timezone: true },
  });
  const tripCurrency = trip.currency as Currency;
  const today = calendarDateIn(now, trip.timezone);

  const rows = await prisma.depositProof.findMany({
    where: { status: "EN_REVISION", interest: { tripId } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      interestId: true,
      amount: true,
      currency: true,
      amountInTripCurrency: true,
      transferDate: true,
      shownAmount: true,
      acceptedAt: true,
      createdAt: true,
      interest: {
        select: {
          user: {
            select: {
              email: true,
              person: { select: { fullName: true } },
            },
          },
        },
      },
    },
  });

  if (rows.length === 0) return [];

  // Una sola consulta de cotización para toda la cola, no una por fila.
  const { snapshot } = await getFxSnapshot();

  return rows.map((row) => ({
    depositId: row.id,
    interestId: row.interestId,
    fullName: row.interest.user.person?.fullName ?? null,
    email: row.interest.user.email,
    amount: row.amount.toString(),
    currency: row.currency as Currency,
    tripCurrency,
    provisionalAmountInTripCurrency: row.amountInTripCurrency.toString(),
    suggestedFxRate:
      row.currency === tripCurrency
        ? null
        : deriveRate(snapshot, row.currency as Currency, tripCurrency)
            .toDecimalPlaces(8)
            .toFixed(8),
    transferDate: toCalendarDate(row.transferDate),
    shownAmount: row.shownAmount.toString(),
    acceptedAt: row.acceptedAt,
    createdAt: row.createdAt,
    waitingDays: Math.max(
      0,
      daysBetweenCalendarDates(calendarDateIn(row.createdAt, trip.timezone), today),
    ),
  }));
}

export type DepositOutcome = "APLICADO" | "YA_RESUELTO";

/**
 * Confirma la seña y, en el mismo acto, convierte a la interesada en pasajera.
 *
 * ── Por qué es UN acto y no dos ──────────────────────────────────────────
 *
 * Porque el estado intermedio no significa nada. Una seña confirmada de
 * alguien que no es pasajera es plata cobrada sin cupo reservado; una pasajera
 * creada con la seña sin confirmar es un cupo dado sin cobrar. Las dos se
 * descubren tarde y se arreglan a mano.
 *
 * ── Idempotencia: el mismo mecanismo que confirmPayment ──────────────────
 *
 * Doble click, o dos coordinadoras mirando la misma cola. El gate NO es
 * "¿ya es pasajera?" leído antes de escribir —eso tiene la ventana de carrera
 * clásica entre el SELECT y el UPDATE—, sino un UPDATE condicionado al estado
 * anterior:
 *
 *     UPDATE "DepositProof" SET status='CONFIRMADO'
 *      WHERE id=? AND status='EN_REVISION'
 *
 * Postgres serializa las dos ejecuciones sobre la fila: la segunda reevalúa el
 * WHERE después de que la primera commiteó, no encuentra nada, afecta 0 filas
 * y sale por `YA_RESUELTO` sin haber creado nada.
 *
 * Y hay una segunda red debajo, por si alguien algún día toca lo de arriba: el
 * `@@unique([tripId, personId])` de Passenger y el `@unique` de
 * `DepositProof.passengerId`. Convertir dos veces no puede producir dos
 * pasajeras aunque el CAS fallara.
 *
 * ── El CAS va DENTRO de la transacción ───────────────────────────────────
 *
 * Si el UPDATE se hiciera afuera y la conversión adentro, un fallo en la
 * conversión dejaría la seña confirmada y a la interesada sin convertir — el
 * peor de los dos estados intermedios, porque parece resuelto.
 *
 * ── No mira `acceptingInterest` ──────────────────────────────────────────
 *
 * A propósito. Ella pagó cuando la captación estaba abierta; que la escuela
 * haya cerrado el registro después no puede dejar su plata en el limbo.
 * Cerrar la captación significa "no entra gente nueva", no "se congela lo que
 * ya entró". El único guard es la capability de la coordinadora sobre el
 * viaje.
 */
export async function confirmDepositAndConvert(
  input: ConfirmDepositInput,
): Promise<{ outcome: DepositOutcome; passengerId: string | null }> {
  const deposit = await depositContext(input.depositId);
  const { tripId } = deposit.interest;
  const viewer = await requireCapability(tripId, "interest:manage");

  if (deposit.interest.status === "DESCARTADA") {
    throw new DepositError(
      "Esta interesada está descartada. Cambiá su estado antes de convertirla.",
      "NO_CONVERTIBLE",
    );
  }

  const personId = deposit.interest.user.personId;
  if (!personId) {
    // No debería poder pasar: el registro público crea la Person antes que la
    // Interest. Si pasa, es un dato roto y no un caso de negocio.
    throw new DepositError(
      "Esta interesada no tiene datos personales cargados.",
      "NO_CONVERTIBLE",
    );
  }

  const tripCurrency = deposit.interest.trip.currency as Currency;
  const depositCurrency = deposit.currency as Currency;

  // La necesidad del TC se decide contra la moneda REAL guardada en la base,
  // no contra lo que venga en el input.
  if (depositCurrency !== tripCurrency && input.fxRateUsed === null) {
    throw new DepositError(
      "La seña está en otra moneda: ingresá el tipo de cambio del extracto.",
      "TC_FALTANTE",
    );
  }

  const converts = depositCurrency !== tripCurrency;
  const fxRateUsed = converts ? input.fxRateUsed : null;
  const fxRateSource = converts ? input.fxRateSource : null;
  const imputed = impute(
    deposit.amount.toString(),
    depositCurrency,
    tripCurrency,
    fxRateUsed,
  );

  const result = await prisma.$transaction(
    async (tx) => {
    const { count } = await tx.depositProof.updateMany({
      where: { id: deposit.id, status: "EN_REVISION" },
      data: {
        status: "CONFIRMADO",
        fxRateUsed,
        fxRateSource,
        amountInTripCurrency: imputed.toFixed(2),
        reviewedById: viewer.userId,
        reviewedAt: new Date(),
      },
    });

    // Alguien llegó primero. El resultado que la coordinadora quería ya está,
    // así que no es un error: se corta antes de crear una segunda pasajera y
    // antes de duplicar la auditoría.
    if (count === 0) return null;

    const passenger = await convertWithinTransaction(tx, {
      interestId: deposit.interestId,
      tripId,
      personId,
      userId: deposit.interest.userId,
    });

    // El sello que le permite a `generatePaymentPlan` encontrar la seña sin
    // recorrer Passenger → Person → User → Interest. Va en esta transacción y
    // no después: una pasajera creada con una seña que no la señala es
    // exactamente el estado en que la seña no se imputa nunca.
    await tx.depositProof.update({
      where: { id: deposit.id },
      data: { passengerId: passenger.id },
    });

      return passenger;
    },
    {
      // ── Por qué estos dos números no son decorativos ───────────────────
      //
      // El pool es de UNA conexión por instancia (ver lib/db/prisma.ts), y
      // una transacción interactiva la retiene de punta a punta. O sea que
      // dos confirmaciones concurrentes en la misma instancia —el doble click
      // de siempre— NO se solapan: la segunda tiene que esperar a que la
      // primera termine.
      //
      // Con el `maxWait` default de Prisma, que son 2 segundos, esa espera se
      // agota y la segunda muere con "Unable to start a transaction in the
      // given time". La coordinadora ve un error de infraestructura por haber
      // hecho doble click, cuando lo correcto es que espere su turno, entre,
      // encuentre la seña ya confirmada y salga por YA_RESUELTO.
      //
      // `maxWait` cubre la espera por la conexión; `timeout`, lo que tarda la
      // transacción una vez adentro. Los dos son generosos por la misma razón
      // por la que los tests tienen timeouts largos: contra el pooler de
      // Supabase se está midiendo latencia de red, no trabajo.
      maxWait: 15_000,
      timeout: 20_000,
    },
  );

  if (result === null) {
    return { outcome: "YA_RESUELTO", passengerId: null };
  }

  await recordAudit(viewer.userId, [
    {
      entity: "DepositProof",
      entityId: deposit.id,
      field: "status",
      oldValue: "EN_REVISION",
      newValue: "CONFIRMADO",
    },
    {
      entity: "DepositProof",
      entityId: deposit.id,
      field: "amountInTripCurrency",
      oldValue: auditMoney(deposit.amountInTripCurrency),
      newValue: auditMoney(imputed),
    },
    {
      entity: "Interest",
      entityId: deposit.interestId,
      field: "status",
      oldValue: deposit.interest.status,
      newValue: "CONVERTIDA",
    },
    {
      entity: "Passenger",
      entityId: result.id,
      field: "creadoDesdeSena",
      oldValue: null,
      newValue: `deposito:${deposit.id}`,
    },
  ]);

  return { outcome: "APLICADO", passengerId: result.id };
}

/**
 * Rechaza la seña. El motivo es obligatorio y se le notifica.
 *
 * "Rechazado" a secas no es información: es alguien mirando su plata sin saber
 * si tiene que volver a transferir, mandar otro comprobante o escribir por
 * WhatsApp. Es el mismo criterio que `rejectPayment`.
 *
 * La fila NO se borra ni se reusa: queda RECHAZADA con su motivo, y el índice
 * parcial deja que se acumulen. Cuando ella vuelva a subir, la pantalla le
 * muestra el motivo del último rechazo — ver `getMyDepositView`.
 */
export async function rejectDeposit(
  input: RejectDepositInput,
): Promise<DepositOutcome> {
  const deposit = await depositContext(input.depositId);
  const { tripId } = deposit.interest;
  const viewer = await requireCapability(tripId, "interest:manage");

  const { count } = await prisma.depositProof.updateMany({
    where: { id: deposit.id, status: "EN_REVISION" },
    data: {
      status: "RECHAZADO",
      rejectionReason: input.reason,
      reviewedById: viewer.userId,
      reviewedAt: new Date(),
    },
  });

  if (count === 0) return "YA_RESUELTO";

  await recordAudit(viewer.userId, [
    {
      entity: "DepositProof",
      entityId: deposit.id,
      field: "status",
      oldValue: "EN_REVISION",
      newValue: "RECHAZADO",
    },
  ]);

  await notifyDepositRejected(deposit, input.reason);

  return "APLICADO";
}

/**
 * Le avisa del rechazo. NUNCA hace fallar la operación.
 *
 * El rechazo ya ocurrió y quedó auditado; que el proveedor de mail esté caído
 * no puede deshacerlo. El motivo además está en su pantalla, que es por qué
 * un mail perdido acá no la deja sin saber qué pasó.
 */
async function notifyDepositRejected(
  deposit: Awaited<ReturnType<typeof depositContext>>,
  reason: string,
): Promise<void> {
  try {
    const { email, person } = deposit.interest.user;

    const lang = langOf(person?.preferredLanguage ?? "ES");
    const context = await tripEmailContext(deposit.interest.tripId);

    const rendered = paymentRejectedEmail(lang, {
      tripName: deposit.interest.trip.name,
      passengerName: person?.fullName ?? null,
      declaredAmount: `${deposit.amount.toString()} ${deposit.currency}`,
      installmentNumber: null,
      reason,
      url: appUrl("/mi-viaje", lang),
      footer: footerFor(context, lang),
    });

    await tryDeliver({ to: email, lang, rendered, context });
  } catch (error) {
    console.error(
      "[deposits] no se pudo avisar del rechazo de una seña:",
      error instanceof Error ? error.message : "error desconocido",
    );
  }
}

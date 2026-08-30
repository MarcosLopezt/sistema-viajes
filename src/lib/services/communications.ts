import "server-only";

import { prisma } from "@/lib/db/prisma";
import {
  getSessionUser,
  requireCapability,
  requirePassengerAccess,
} from "@/lib/auth/guards";
import { ForbiddenError } from "@/lib/auth/errors";
import { communicationEmail } from "@/lib/email/templates";
import type { EmailLang } from "@/lib/email";
import { listPassengersForSystemJob } from "./passengers";
import {
  deliver,
  footerFor,
  langOf,
  tripEmailContext,
  type TripEmailContext,
} from "./notifications";
import type { TaskBudget, TaskResult } from "./reminders";
import type {
  CommunicationDraftInput,
} from "@/lib/validation/communication";

/**
 * Comunicaciones del coordinador.
 *
 * ── Por qué el envío no es un `for` dentro del request ────────────────────
 *
 * Vercel Hobby corta las funciones a los ~10 s y el free tier de Brevo permite
 * 300 mails por día. Un envío masivo hecho en el request se cae a la mitad y
 * deja la mitad de la gente sin el mail y sin forma de saber a quiénes.
 *
 * En cambio se MATERIALIZA una fila de `CommunicationRecipient` por
 * destinatario, con su idioma ya resuelto y su estado. A partir de ahí, mandar
 * es drenar filas PENDIENTE: lo hace el request si le da el tiempo, y lo
 * termina el cron si no. Un fallo individual marca esa fila como FALLIDO con
 * su error y sigue con la siguiente; el lote nunca se aborta.
 *
 * Esa tabla es además la respuesta a "¿le llegó a Ana?", que es la pregunta
 * que se hace de verdad.
 */

export class CommunicationError extends Error {
  constructor(
    message: string,
    readonly reason:
      | "ESTADO"
      | "SIN_DESTINATARIOS"
      | "SIN_CASILLA"
      | "PROGRAMACION",
  ) {
    super(message);
    this.name = "CommunicationError";
  }
}

/** Cuántos mails manda como mucho un envío inmediato antes de dejar el resto. */
const INLINE_BATCH = 12;

// --------------------------- Idioma del destinatario -----------------------

/**
 * ¿Hay versión en inglés?
 *
 * Solo si el asunto Y el cuerpo están completos. Media traducción es peor que
 * ninguna: un mail con el asunto en inglés y el cuerpo en español parece un
 * error del sistema, y quien lo recibe no sabe si le falta algo.
 */
export function hasEnglishVersion(communication: {
  subjectEn: string | null;
  bodyEn: string | null;
}): boolean {
  return (
    (communication.subjectEn?.trim() ?? "") !== "" &&
    (communication.bodyEn?.trim() ?? "") !== ""
  );
}

/**
 * En qué idioma le escribimos a esta persona.
 *
 * Su preferencia, si existe la versión; español si no. El fallback es al
 * español —el idioma obligatorio— y no a "no mandar nada": alguien que prefiere
 * inglés y recibe el aviso en español se entera igual de que la cuota vence.
 */
function langFor(
  communication: { subjectEn: string | null; bodyEn: string | null },
  preferred: "ES" | "EN",
): "ES" | "EN" {
  return preferred === "EN" && hasEnglishVersion(communication) ? "EN" : "ES";
}

function contentFor(
  communication: {
    subjectEs: string;
    bodyEs: string;
    subjectEn: string | null;
    bodyEn: string | null;
  },
  lang: "ES" | "EN",
): { subject: string; body: string } {
  if (lang === "EN" && hasEnglishVersion(communication)) {
    return {
      subject: communication.subjectEn!.trim(),
      body: communication.bodyEn!.trim(),
    };
  }
  return { subject: communication.subjectEs, body: communication.bodyEs };
}

// -------------------------------- Lectura ----------------------------------

const COMMUNICATION_SELECT = {
  id: true,
  tripId: true,
  subjectEs: true,
  bodyEs: true,
  subjectEn: true,
  bodyEn: true,
  audience: true,
  includeCancelled: true,
  status: true,
  scheduledFor: true,
  sentAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export interface CommunicationSummary {
  id: string;
  subjectEs: string;
  status: string;
  audience: string;
  hasEnglish: boolean;
  scheduledFor: Date | null;
  sentAt: Date | null;
  createdAt: Date;
  counts: { total: number; sent: number; failed: number; pending: number };
}

export async function listCommunications(
  tripId: string,
): Promise<CommunicationSummary[]> {
  await requireCapability(tripId, "communication:send");

  const rows = await prisma.communication.findMany({
    where: { tripId },
    orderBy: { createdAt: "desc" },
    select: {
      ...COMMUNICATION_SELECT,
      recipients: { select: { status: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    subjectEs: row.subjectEs,
    status: row.status,
    audience: row.audience,
    hasEnglish: hasEnglishVersion(row),
    scheduledFor: row.scheduledFor,
    sentAt: row.sentAt,
    createdAt: row.createdAt,
    counts: {
      total: row.recipients.length,
      sent: row.recipients.filter((r) => r.status === "ENVIADO").length,
      failed: row.recipients.filter((r) => r.status === "FALLIDO").length,
      pending: row.recipients.filter((r) => r.status === "PENDIENTE").length,
    },
  }));
}

export interface CommunicationDetail {
  id: string;
  tripId: string;
  subjectEs: string;
  bodyEs: string;
  subjectEn: string | null;
  bodyEn: string | null;
  audience: "TODOS" | "SELECCION";
  includeCancelled: boolean;
  status: string;
  hasEnglish: boolean;
  scheduledFor: Date | null;
  sentAt: Date | null;
  passengerIds: string[];
  recipients: {
    id: string;
    passengerId: string;
    fullName: string | null;
    lang: "ES" | "EN";
    status: "PENDIENTE" | "ENVIADO" | "FALLIDO";
    sentAt: Date | null;
    error: string | null;
  }[];
}

export async function getCommunication(
  communicationId: string,
): Promise<CommunicationDetail> {
  const communication = await prisma.communication.findUnique({
    where: { id: communicationId },
    select: {
      ...COMMUNICATION_SELECT,
      recipients: {
        select: {
          id: true,
          passengerId: true,
          lang: true,
          status: true,
          sentAt: true,
          error: true,
        },
      },
    },
  });

  // 404, no 403: confirmar que existe ya es información.
  if (!communication) throw new ForbiddenError();

  await requireCapability(communication.tripId, "communication:send");

  // Los nombres salen de passengers.ts, no de una consulta a Person desde acá.
  const names = new Map(
    (await listPassengersForSystemJob(communication.tripId)).map((p) => [
      p.id,
      p.fullName,
    ]),
  );

  return {
    id: communication.id,
    tripId: communication.tripId,
    subjectEs: communication.subjectEs,
    bodyEs: communication.bodyEs,
    subjectEn: communication.subjectEn,
    bodyEn: communication.bodyEn,
    audience: communication.audience,
    includeCancelled: communication.includeCancelled,
    status: communication.status,
    hasEnglish: hasEnglishVersion(communication),
    scheduledFor: communication.scheduledFor,
    sentAt: communication.sentAt,
    passengerIds: communication.recipients.map((r) => r.passengerId),
    recipients: communication.recipients.map((r) => ({
      id: r.id,
      passengerId: r.passengerId,
      fullName: names.get(r.passengerId) ?? null,
      lang: r.lang,
      status: r.status,
      sentAt: r.sentAt,
      error: r.error,
    })),
  };
}

// -------------------------------- Escritura --------------------------------

/** Estados en los que la comunicación todavía se puede editar. */
const EDITABLE = ["BORRADOR", "PROGRAMADA"] as const;

async function requireEditable(communicationId: string) {
  const communication = await prisma.communication.findUnique({
    where: { id: communicationId },
    select: { ...COMMUNICATION_SELECT },
  });
  if (!communication) throw new ForbiddenError();

  await requireCapability(communication.tripId, "communication:send");

  if (!EDITABLE.includes(communication.status as (typeof EDITABLE)[number])) {
    throw new CommunicationError(
      "Esta comunicación ya se envió y no se puede modificar.",
      "ESTADO",
    );
  }
  return communication;
}

export async function createCommunication(
  tripId: string,
  input: CommunicationDraftInput,
): Promise<{ id: string }> {
  const viewer = await requireCapability(tripId, "communication:send");

  return prisma.communication.create({
    data: {
      tripId,
      subjectEs: input.subjectEs,
      bodyEs: input.bodyEs,
      subjectEn: input.subjectEn,
      bodyEn: input.bodyEn,
      audience: input.audience,
      includeCancelled: input.includeCancelled,
      createdById: viewer.userId,
      status: "BORRADOR",
    },
    select: { id: true },
  });
}

export async function updateCommunication(
  communicationId: string,
  input: CommunicationDraftInput,
): Promise<void> {
  await requireEditable(communicationId);

  await prisma.communication.update({
    where: { id: communicationId },
    data: {
      subjectEs: input.subjectEs,
      bodyEs: input.bodyEs,
      subjectEn: input.subjectEn,
      bodyEn: input.bodyEn,
      audience: input.audience,
      includeCancelled: input.includeCancelled,
    },
  });
}

export async function deleteCommunication(
  communicationId: string,
): Promise<void> {
  const communication = await requireEditable(communicationId);
  await prisma.communication.delete({ where: { id: communication.id } });
}

// ------------------------------ Vista previa -------------------------------

export interface CommunicationPreview {
  lang: EmailLang;
  subject: string;
  html: string;
  text: string;
}

/**
 * Cómo se va a ver el mail, en cada idioma que se vaya a mandar.
 *
 * Existe porque nadie aprieta "enviar a catorce personas" sin haber visto
 * antes qué sale. Se renderiza con las MISMAS funciones que el envío real, así
 * que la vista previa no puede diferir del mail: si difiriera, no serviría
 * para nada.
 */
export async function previewCommunication(
  communicationId: string,
): Promise<CommunicationPreview[]> {
  const communication = await prisma.communication.findUnique({
    where: { id: communicationId },
    select: COMMUNICATION_SELECT,
  });
  if (!communication) throw new ForbiddenError();

  await requireCapability(communication.tripId, "communication:send");

  const context = await tripEmailContext(communication.tripId);
  const langs: ("ES" | "EN")[] = hasEnglishVersion(communication)
    ? ["ES", "EN"]
    : ["ES"];

  return langs.map((lang) => {
    const content = contentFor(communication, lang);
    const rendered = communicationEmail(langOf(lang), {
      subject: content.subject,
      body: content.body,
      // En la vista previa no hay una persona concreta: el saludo se muestra
      // sin nombre, que es como lo va a ver quien no tenga el nombre cargado.
      passengerName: null,
      footer: footerFor(context, langOf(lang)),
    });
    return { lang: langOf(lang), ...rendered };
  });
}

/**
 * Se manda una prueba a la casilla del propio coordinador.
 *
 * La casilla sale de la SESIÓN, no de un campo del formulario. Si se pudiera
 * elegir el destinatario, esto sería un relay abierto: cualquiera con acceso
 * al panel podría mandar mails con el remitente del viaje a donde quisiera.
 */
export async function sendTestEmail(
  communicationId: string,
  lang: "ES" | "EN",
): Promise<{ to: string }> {
  const communication = await prisma.communication.findUnique({
    where: { id: communicationId },
    select: COMMUNICATION_SELECT,
  });
  if (!communication) throw new ForbiddenError();

  await requireCapability(communication.tripId, "communication:send");

  const user = await getSessionUser();
  if (!user?.email) {
    throw new CommunicationError(
      "Tu usuario no tiene una casilla asociada.",
      "SIN_CASILLA",
    );
  }

  const context = await tripEmailContext(communication.tripId);
  const content = contentFor(communication, lang);
  const rendered = communicationEmail(langOf(lang), {
    subject: `[PRUEBA] ${content.subject}`,
    body: content.body,
    passengerName: null,
    footer: footerFor(context, langOf(lang)),
  });

  await deliver({ to: user.email, lang: langOf(lang), rendered, context });
  return { to: user.email };
}

// --------------------------- Destinatarios ---------------------------------

/**
 * Congela la lista de destinatarios con su idioma ya resuelto.
 *
 * Se materializa AL ENVIAR y no antes: entre que se escribe un borrador y se
 * manda pueden entrar pasajeros nuevos, y quien escribió "todos" quiso decir
 * todos los de ese momento.
 *
 * El idioma se guarda en la fila. Si se recalculara al mandar cada mail, un
 * pasajero que cambia su preferencia mientras el lote está a medio drenar
 * recibiría un idioma distinto del que dice la fila, y la trazabilidad de
 * "¿en qué idioma se le mandó?" sería mentira.
 */
async function materializeRecipients(
  communicationId: string,
  tripId: string,
  communication: {
    audience: "TODOS" | "SELECCION";
    includeCancelled: boolean;
    subjectEn: string | null;
    bodyEn: string | null;
  },
  selectedPassengerIds: string[],
): Promise<number> {
  const all = await listPassengersForSystemJob(tripId);

  const eligible = all.filter((passenger) => {
    // Un coordinador no es destinatario de las comunicaciones del viaje: las
    // escribe él.
    if (passenger.isCoordinator) return false;
    // Sin casilla no hay a dónde mandar: todavía no canjeó la invitación.
    if (!passenger.email) return false;
    if (passenger.status === "CANCELADO" && !communication.includeCancelled) {
      return false;
    }
    if (communication.audience === "SELECCION") {
      return selectedPassengerIds.includes(passenger.id);
    }
    return true;
  });

  if (eligible.length === 0) {
    throw new CommunicationError(
      "No hay destinatarios para esta comunicación.",
      "SIN_DESTINATARIOS",
    );
  }

  await prisma.communicationRecipient.createMany({
    data: eligible.map((passenger) => ({
      communicationId,
      passengerId: passenger.id,
      lang: langFor(communication, passenger.preferredLanguage),
    })),
    // Reenviar una comunicación ya materializada no duplica destinatarios: el
    // unique (communicationId, passengerId) los descarta.
    skipDuplicates: true,
  });

  /**
   * Corrige el idioma de las filas que YA existían.
   *
   * Con audiencia SELECCION, `setSelectedPassengers()` crea las filas al
   * guardar el borrador y les pone ES provisorio: en ese momento todavía no se
   * sabe si va a haber versión en inglés, porque el coordinador puede
   * completarla después. `createMany` con `skipDuplicates` las deja intactas,
   * así que sin este paso un pasajero que prefiere inglés recibiría la versión
   * en español aunque la traducción esté completa.
   *
   * Solo se tocan las PENDIENTE: el idioma de un mail ya enviado es un hecho,
   * no un dato a recalcular.
   */
  await Promise.all(
    eligible.map((passenger) =>
      prisma.communicationRecipient.updateMany({
        where: {
          communicationId,
          passengerId: passenger.id,
          status: "PENDIENTE",
        },
        data: { lang: langFor(communication, passenger.preferredLanguage) },
      }),
    ),
  );

  return eligible.length;
}

// -------------------------------- Envío ------------------------------------

export interface SendReport {
  recipients: number;
  sent: number;
  failed: number;
  /** Quedaron filas PENDIENTE: las termina el cron. */
  pending: number;
}

/**
 * Envío inmediato.
 *
 * Materializa los destinatarios y drena hasta `INLINE_BATCH` en el request.
 * Lo que sobra queda PENDIENTE y lo termina el cron: para catorce pasajeros
 * nunca sobra, pero la pantalla no puede depender de eso.
 */
export async function sendCommunicationNow(
  communicationId: string,
): Promise<SendReport> {
  const communication = await requireSendable(communicationId);

  const recipients = await materializeRecipients(
    communication.id,
    communication.tripId,
    communication,
    await selectedIdsOf(communication.id),
  );

  await prisma.communication.update({
    where: { id: communication.id },
    data: { status: "ENVIANDO", scheduledFor: null },
  });

  const drained = await drainCommunication(communication.id, {
    maxEmails: INLINE_BATCH,
    deadline: Date.now() + 8_000,
  });

  return { recipients, ...drained };
}

/** Programa el envío. El cron lo levanta cuando llega la fecha. */
export async function scheduleCommunication(
  communicationId: string,
  scheduledFor: Date,
): Promise<void> {
  const communication = await requireSendable(communicationId);

  if (Number.isNaN(scheduledFor.getTime())) {
    throw new CommunicationError("Esa fecha no es válida.", "PROGRAMACION");
  }
  if (scheduledFor.getTime() <= Date.now()) {
    throw new CommunicationError(
      "La fecha de envío tiene que ser futura.",
      "PROGRAMACION",
    );
  }

  await prisma.communication.update({
    where: { id: communication.id },
    data: { status: "PROGRAMADA", scheduledFor },
  });
}

async function requireSendable(communicationId: string) {
  const communication = await prisma.communication.findUnique({
    where: { id: communicationId },
    select: COMMUNICATION_SELECT,
  });
  if (!communication) throw new ForbiddenError();

  await requireCapability(communication.tripId, "communication:send");

  if (communication.status === "ENVIADA") {
    throw new CommunicationError("Esta comunicación ya se envió.", "ESTADO");
  }
  return communication;
}

async function selectedIdsOf(communicationId: string): Promise<string[]> {
  const rows = await prisma.communicationRecipient.findMany({
    where: { communicationId },
    select: { passengerId: true },
  });
  return rows.map((row) => row.passengerId);
}

/**
 * Fija los destinatarios de una comunicación con audiencia SELECCION.
 *
 * Se guardan como filas PENDIENTE por adelantado para no inventar una tabla
 * nueva: al enviar, `materializeRecipients` las respeta y agrega las que
 * falten. Los ids se validan contra el viaje: uno de otro viaje se descarta.
 */
export async function setSelectedPassengers(
  communicationId: string,
  passengerIds: string[],
): Promise<number> {
  const communication = await requireEditable(communicationId);

  const valid = new Set(
    (await listPassengersForSystemJob(communication.tripId))
      .filter((p) => !p.isCoordinator)
      .map((p) => p.id),
  );
  const clean = passengerIds.filter((id) => valid.has(id));

  await prisma.$transaction([
    prisma.communicationRecipient.deleteMany({
      where: { communicationId, status: "PENDIENTE" },
    }),
    prisma.communicationRecipient.createMany({
      data: clean.map((passengerId) => ({
        communicationId,
        passengerId,
        // Provisorio: se recalcula al materializar, cuando ya se sabe si hay
        // versión en inglés.
        lang: "ES" as const,
      })),
      skipDuplicates: true,
    }),
  ]);

  return clean.length;
}

/** Vuelve a intentar SOLO los destinatarios que fallaron. */
export async function retryFailedRecipients(
  communicationId: string,
): Promise<SendReport> {
  const communication = await prisma.communication.findUnique({
    where: { id: communicationId },
    select: { id: true, tripId: true },
  });
  if (!communication) throw new ForbiddenError();

  await requireCapability(communication.tripId, "communication:send");

  const { count } = await prisma.communicationRecipient.updateMany({
    where: { communicationId, status: "FALLIDO" },
    data: { status: "PENDIENTE", error: null },
  });

  await prisma.communication.update({
    where: { id: communication.id },
    data: { status: "ENVIANDO" },
  });

  const drained = await drainCommunication(communication.id, {
    maxEmails: INLINE_BATCH,
    deadline: Date.now() + 8_000,
  });

  return { recipients: count, ...drained };
}

/**
 * Manda los destinatarios PENDIENTE de una comunicación, hasta agotar el
 * presupuesto.
 *
 * Un fallo individual NO aborta el lote: se marca esa fila como FALLIDO con el
 * error que devolvió el proveedor y se sigue con la siguiente. Trece mails
 * enviados y uno fallido es un resultado; cero mails enviados porque el
 * primero tenía la casilla mal escrita, no.
 */
export async function drainCommunication(
  communicationId: string,
  budget: TaskBudget,
): Promise<{ sent: number; failed: number; pending: number }> {
  const communication = await prisma.communication.findUniqueOrThrow({
    where: { id: communicationId },
    select: COMMUNICATION_SELECT,
  });

  const context = await tripEmailContext(communication.tripId);
  const people = new Map(
    (await listPassengersForSystemJob(communication.tripId)).map((p) => [
      p.id,
      p,
    ]),
  );

  const pending = await prisma.communicationRecipient.findMany({
    where: { communicationId, status: "PENDIENTE" },
    orderBy: { id: "asc" },
    select: { id: true, passengerId: true, lang: true },
  });

  let sent = 0;
  let failed = 0;

  for (const recipient of pending) {
    if (sent + failed >= budget.maxEmails || Date.now() >= budget.deadline) {
      break;
    }

    const passenger = people.get(recipient.passengerId);

    if (!passenger?.email) {
      await markFailed(
        recipient.id,
        "El pasajero no tiene una casilla asociada.",
      );
      failed += 1;
      continue;
    }

    try {
      await sendToRecipient(communication, context, recipient, passenger);
      await prisma.communicationRecipient.update({
        where: { id: recipient.id },
        data: { status: "ENVIADO", sentAt: new Date(), error: null },
      });
      sent += 1;
    } catch (error) {
      // El mensaje del proveedor se guarda TAL CUAL para que el coordinador lo
      // lea en pantalla. Un "algo salió mal" genérico no le sirve a nadie.
      await markFailed(recipient.id, (error as Error).message);
      failed += 1;
    }
  }

  const remaining = await prisma.communicationRecipient.count({
    where: { communicationId, status: "PENDIENTE" },
  });

  // La comunicación se da por ENVIADA cuando no queda nada pendiente, haya
  // fallado o no alguno: FALLIDA se reserva para cuando no salió ni uno.
  if (remaining === 0) {
    const ok = await prisma.communicationRecipient.count({
      where: { communicationId, status: "ENVIADO" },
    });
    await prisma.communication.update({
      where: { id: communicationId },
      data: {
        status: ok > 0 ? "ENVIADA" : "FALLIDA",
        sentAt: new Date(),
      },
    });
  }

  return { sent, failed, pending: remaining };
}

async function markFailed(recipientId: string, message: string): Promise<void> {
  await prisma.communicationRecipient.update({
    where: { id: recipientId },
    data: { status: "FALLIDO", error: message.slice(0, 500) },
  });
}

async function sendToRecipient(
  communication: {
    subjectEs: string;
    bodyEs: string;
    subjectEn: string | null;
    bodyEn: string | null;
  },
  context: TripEmailContext,
  recipient: { lang: "ES" | "EN" },
  passenger: { email: string | null; fullName: string | null },
): Promise<void> {
  const content = contentFor(communication, recipient.lang);
  const rendered = communicationEmail(langOf(recipient.lang), {
    subject: content.subject,
    body: content.body,
    passengerName: passenger.fullName,
    footer: footerFor(context, langOf(recipient.lang)),
  });

  await deliver({
    to: passenger.email!,
    lang: langOf(recipient.lang),
    rendered,
    context,
  });
}

// ------------------------------ Tarea del cron -----------------------------

/**
 * Levanta las comunicaciones programadas cuya fecha llegó y drena las que
 * quedaron a medio mandar.
 *
 * Las dos cosas en la misma tarea a propósito: una comunicación que quedó en
 * ENVIANDO porque se acabó el tiempo del request es exactamente igual de
 * urgente que una programada para hoy.
 */
export async function processScheduledCommunications(
  now: Date,
  budget: TaskBudget,
): Promise<TaskResult> {
  const due = await prisma.communication.findMany({
    where: {
      OR: [
        { status: "PROGRAMADA", scheduledFor: { lte: now } },
        { status: "ENVIANDO" },
      ],
    },
    orderBy: { scheduledFor: "asc" },
    select: {
      id: true,
      tripId: true,
      status: true,
      audience: true,
      includeCancelled: true,
      subjectEn: true,
      bodyEn: true,
    },
  });

  const result: TaskResult = {
    sent: 0,
    skipped: 0,
    failed: 0,
    remaining: false,
  };

  for (const communication of due) {
    if (result.sent >= budget.maxEmails || Date.now() >= budget.deadline) {
      result.remaining = true;
      return result;
    }

    if (communication.status === "PROGRAMADA") {
      try {
        await materializeRecipients(
          communication.id,
          communication.tripId,
          communication,
          await selectedIdsOf(communication.id),
        );
      } catch (error) {
        // Una comunicación sin destinatarios no puede frenar a las demás.
        if (error instanceof CommunicationError) {
          await prisma.communication.update({
            where: { id: communication.id },
            data: { status: "FALLIDA" },
          });
          result.skipped += 1;
          continue;
        }
        throw error;
      }

      await prisma.communication.update({
        where: { id: communication.id },
        data: { status: "ENVIANDO" },
      });
    }

    const drained = await drainCommunication(communication.id, {
      maxEmails: budget.maxEmails - result.sent,
      deadline: budget.deadline,
    });

    result.sent += drained.sent;
    result.failed += drained.failed;
    if (drained.pending > 0) result.remaining = true;
  }

  return result;
}

// --------------------------- Vista del pasajero ----------------------------

export interface PassengerCommunication {
  id: string;
  subject: string;
  body: string;
  sentAt: Date;
}

/**
 * Comunicaciones que efectivamente le llegaron a un pasajero, en SU idioma.
 *
 * Se listan por `CommunicationRecipient` con status ENVIADO, no por
 * `Communication`: lo que importa es lo que le llegó a esta persona, no lo que
 * el coordinador mandó al grupo. Alguien agregado al viaje la semana pasada no
 * tiene por qué ver los avisos de marzo.
 */
export async function listCommunicationsForPassenger(
  passengerId: string,
): Promise<PassengerCommunication[]> {
  await requirePassengerAccess(passengerId, "view");

  const rows = await prisma.communicationRecipient.findMany({
    where: { passengerId, status: "ENVIADO" },
    orderBy: { sentAt: "desc" },
    take: 20,
    select: {
      id: true,
      lang: true,
      sentAt: true,
      communication: {
        select: {
          id: true,
          subjectEs: true,
          bodyEs: true,
          subjectEn: true,
          bodyEn: true,
        },
      },
    },
  });

  return rows.map((row) => {
    const content = contentFor(row.communication, row.lang);
    return {
      id: row.communication.id,
      subject: content.subject,
      body: content.body,
      // `sentAt` no puede ser null en una fila ENVIADO, pero el tipo lo
      // permite: se cae al epoch en vez de romper la pantalla.
      sentAt: row.sentAt ?? new Date(0),
    };
  });
}

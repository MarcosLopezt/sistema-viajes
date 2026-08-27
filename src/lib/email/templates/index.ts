import {
  formatEmailDate,
  renderEmail,
  type EmailBlock,
  type EmailFooter,
  type RenderedEmail,
} from "../layout";
import type { EmailLang } from "../types";

/**
 * Las seis plantillas del sistema.
 *
 * Todas se arman con los mismos bloques y salen por `renderEmail()`, así que
 * el HTML —tablas, estilos inline, 600px— y la versión de texto se resuelven
 * en un solo lugar. Una plantilla nueva no puede olvidarse del texto plano ni
 * inventar su propia maquetación.
 *
 * El TEXTO de cada idioma está acá, no en `src/messages/*.json`. Son dos
 * catálogos distintos a propósito: los de `messages` son de la interfaz y los
 * lee `next-intl` en el cliente; estos los renderiza el servidor —a veces
 * desde el cron, sin request ni locale— y tienen que estar disponibles en los
 * dos idiomas AL MISMO TIEMPO, porque un mismo envío le escribe en español a
 * una pasajera y en inglés a otra.
 */

export type { RenderedEmail };

// ------------------------------- Invitación --------------------------------

export interface InvitationEmailData {
  tripName: string;
  url: string;
  expiresAt: Date;
  coordinatorName?: string | null;
  footer: EmailFooter;
}

const INVITATION = {
  es: {
    subject: (trip: string) => `Te invitamos a ${trip}`,
    heading: "¡Hola!",
    body: (trip: string, by: string | null) =>
      by
        ? `${by} te invita a sumarte al viaje ${trip}.`
        : `Te invitamos a sumarte al viaje ${trip}.`,
    instructions:
      "Entrá al link de abajo para crear tu contraseña y completar tus datos. Son tres pasos cortos y podés terminarlos en otro momento si te queda a mitad.",
    button: "Completar mis datos",
    expiry: (date: string) => `El link vence el ${date}.`,
    ignore:
      "Si no esperabas este mail, podés ignorarlo: sin el link nadie puede usarlo.",
  },
  en: {
    subject: (trip: string) => `You're invited to ${trip}`,
    heading: "Hello!",
    body: (trip: string, by: string | null) =>
      by
        ? `${by} has invited you to join the trip ${trip}.`
        : `You're invited to join the trip ${trip}.`,
    instructions:
      "Use the link below to create your password and fill in your details. It's three short steps, and you can finish later if you don't get through them in one go.",
    button: "Fill in my details",
    expiry: (date: string) => `The link expires on ${date}.`,
    ignore:
      "If you weren't expecting this email you can ignore it: without the link, nobody can use it.",
  },
} as const;

/**
 * Mail de invitación.
 *
 * Lo que no se puede corregir después, y por eso está resuelto acá:
 *
 *  - NUNCA lleva una contraseña. Solo el link con el token.
 *  - El link va también como texto copiable (lo pone `renderEmail`), porque
 *    los clientes de mail rompen botones.
 *  - Dice cuándo vence, para que no lo dejen para dentro de un mes.
 */
export function invitationEmail(
  lang: EmailLang,
  data: InvitationEmailData,
): RenderedEmail {
  const copy = INVITATION[lang];

  return renderEmail({
    lang,
    subject: copy.subject(data.tripName),
    preheader: copy.instructions,
    footer: data.footer,
    blocks: [
      { kind: "heading", text: copy.heading },
      {
        kind: "paragraph",
        text: copy.body(data.tripName, data.coordinatorName ?? null),
      },
      { kind: "paragraph", text: copy.instructions },
      { kind: "button", label: copy.button, url: data.url },
      {
        kind: "paragraph",
        text: copy.expiry(formatEmailDate(data.expiresAt)),
        muted: true,
      },
      { kind: "paragraph", text: copy.ignore, muted: true },
    ],
  });
}

// --------------------------- Recordatorio de pago --------------------------

export interface PaymentReminderData {
  tripName: string;
  passengerName: string | null;
  installmentNumber: number;
  /** Ya formateado con símbolo de moneda por quien llama. */
  amount: string;
  dueDate: string;
  /** Saldo total del plan, formateado. */
  balance: string;
  /** `true` si la cuota ya venció: cambia el tono, no el contenido. */
  overdue: boolean;
  url: string;
  footer: EmailFooter;
}

const REMINDER = {
  es: {
    subjectSoon: (n: number, trip: string) =>
      `Se acerca el vencimiento de la cuota ${n} — ${trip}`,
    subjectOverdue: (n: number, trip: string) =>
      `Cuota ${n} vencida — ${trip}`,
    greeting: (name: string | null) => (name ? `Hola, ${name}.` : "Hola."),
    bodySoon: (date: string) =>
      `Te escribimos para recordarte que tenés una cuota por pagar el ${date}.`,
    bodyOverdue: (date: string) =>
      `La cuota venció el ${date} y todavía no nos figura pagada. Si ya transferiste, subí el comprobante y la revisamos.`,
    amountLabel: "Importe de la cuota",
    rowInstallment: "Cuota",
    rowDue: "Vence",
    rowBalance: "Saldo del plan",
    button: "Subir mi comprobante",
    ignore:
      "Si ya subiste el comprobante y está en revisión, ignorá este mail: te avisamos cuando lo confirmemos.",
  },
  en: {
    subjectSoon: (n: number, trip: string) =>
      `Instalment ${n} is due soon — ${trip}`,
    subjectOverdue: (n: number, trip: string) =>
      `Instalment ${n} is overdue — ${trip}`,
    greeting: (name: string | null) => (name ? `Hello, ${name}.` : "Hello."),
    bodySoon: (date: string) =>
      `Just a reminder that you have an instalment due on ${date}.`,
    bodyOverdue: (date: string) =>
      `The instalment was due on ${date} and we have not recorded it as paid. If you already made the transfer, upload the receipt and we will review it.`,
    amountLabel: "Instalment amount",
    rowInstallment: "Instalment",
    rowDue: "Due",
    rowBalance: "Plan balance",
    button: "Upload my receipt",
    ignore:
      "If you already uploaded a receipt and it is under review, please ignore this email: we will let you know once it is confirmed.",
  },
} as const;

export function paymentReminderEmail(
  lang: EmailLang,
  data: PaymentReminderData,
): RenderedEmail {
  const copy = REMINDER[lang];
  const subject = data.overdue
    ? copy.subjectOverdue(data.installmentNumber, data.tripName)
    : copy.subjectSoon(data.installmentNumber, data.tripName);

  return renderEmail({
    lang,
    subject,
    preheader: subject,
    footer: data.footer,
    blocks: [
      { kind: "paragraph", text: copy.greeting(data.passengerName) },
      {
        kind: "paragraph",
        text: data.overdue
          ? copy.bodyOverdue(data.dueDate)
          : copy.bodySoon(data.dueDate),
      },
      { kind: "highlight", label: copy.amountLabel, value: data.amount },
      {
        kind: "rows",
        rows: [
          {
            label: copy.rowInstallment,
            value: String(data.installmentNumber),
          },
          { label: copy.rowDue, value: data.dueDate },
          { label: copy.rowBalance, value: data.balance },
        ],
      },
      { kind: "button", label: copy.button, url: data.url },
      { kind: "paragraph", text: copy.ignore, muted: true },
    ],
  });
}

// ---------------------------- Pago confirmado ------------------------------

export interface PaymentConfirmedData {
  tripName: string;
  passengerName: string | null;
  /** Lo que declaró el pasajero, en su moneda. */
  declaredAmount: string;
  /** Lo imputado, en la moneda del viaje. `null` si son la misma. */
  imputedAmount: string | null;
  installmentNumber: number | null;
  balance: string;
  url: string;
  footer: EmailFooter;
}

const CONFIRMED = {
  es: {
    subject: (trip: string) => `Recibimos tu pago — ${trip}`,
    greeting: (name: string | null) => (name ? `Hola, ${name}.` : "Hola."),
    body: "Confirmamos tu pago. Gracias.",
    amountLabel: "Pago confirmado",
    rowInstallment: "Imputado a la cuota",
    rowUnallocated: "Sin imputar a una cuota",
    rowImputed: "Equivalente en la moneda del viaje",
    rowBalance: "Saldo que queda",
    button: "Ver mis pagos",
  },
  en: {
    subject: (trip: string) => `We received your payment — ${trip}`,
    greeting: (name: string | null) => (name ? `Hello, ${name}.` : "Hello."),
    body: "Your payment is confirmed. Thank you.",
    amountLabel: "Payment confirmed",
    rowInstallment: "Applied to instalment",
    rowUnallocated: "Not applied to an instalment",
    rowImputed: "Equivalent in the trip currency",
    rowBalance: "Remaining balance",
    button: "View my payments",
  },
} as const;

export function paymentConfirmedEmail(
  lang: EmailLang,
  data: PaymentConfirmedData,
): RenderedEmail {
  const copy = CONFIRMED[lang];
  const rows: { label: string; value: string }[] = [];

  if (data.installmentNumber !== null) {
    rows.push({
      label: copy.rowInstallment,
      value: String(data.installmentNumber),
    });
  } else {
    rows.push({ label: copy.rowUnallocated, value: "—" });
  }
  // El equivalente solo aparece si hubo conversión: mostrar "£100 = £100" es
  // ruido que hace dudar de si algo se convirtió mal.
  if (data.imputedAmount !== null) {
    rows.push({ label: copy.rowImputed, value: data.imputedAmount });
  }
  rows.push({ label: copy.rowBalance, value: data.balance });

  return renderEmail({
    lang,
    subject: copy.subject(data.tripName),
    preheader: copy.body,
    footer: data.footer,
    blocks: [
      { kind: "paragraph", text: copy.greeting(data.passengerName) },
      { kind: "paragraph", text: copy.body },
      {
        kind: "highlight",
        label: copy.amountLabel,
        value: data.declaredAmount,
      },
      { kind: "rows", rows },
      { kind: "button", label: copy.button, url: data.url },
    ],
  });
}

// ----------------------------- Pago rechazado ------------------------------

export interface PaymentRejectedData {
  tripName: string;
  passengerName: string | null;
  declaredAmount: string;
  installmentNumber: number | null;
  /** Motivo que escribió el coordinador. Obligatorio. */
  reason: string;
  url: string;
  footer: EmailFooter;
}

const REJECTED = {
  es: {
    subject: (trip: string) => `No pudimos confirmar tu pago — ${trip}`,
    greeting: (name: string | null) => (name ? `Hola, ${name}.` : "Hola."),
    body: (amount: string) =>
      `Revisamos el comprobante que enviaste por ${amount} y no pudimos confirmarlo.`,
    reasonLabel: "El motivo es este:",
    next: "Podés volver a subir un comprobante desde tu pantalla de pagos. Si algo no está claro, respondé este mail.",
    button: "Subir otro comprobante",
  },
  en: {
    subject: (trip: string) => `We couldn't confirm your payment — ${trip}`,
    greeting: (name: string | null) => (name ? `Hello, ${name}.` : "Hello."),
    body: (amount: string) =>
      `We reviewed the receipt you sent for ${amount} and couldn't confirm it.`,
    reasonLabel: "Here is why:",
    next: "You can upload another receipt from your payments screen. If anything is unclear, just reply to this email.",
    button: "Upload another receipt",
  },
} as const;

/**
 * "Rechazado" a secas no es información: es alguien mirando su plata sin saber
 * si tiene que volver a transferir, mandar otro comprobante o llamar. Por eso
 * el motivo es obligatorio en el tipo y va destacado en su propio bloque.
 */
export function paymentRejectedEmail(
  lang: EmailLang,
  data: PaymentRejectedData,
): RenderedEmail {
  const copy = REJECTED[lang];

  return renderEmail({
    lang,
    subject: copy.subject(data.tripName),
    preheader: copy.reasonLabel,
    footer: data.footer,
    blocks: [
      { kind: "paragraph", text: copy.greeting(data.passengerName) },
      { kind: "paragraph", text: copy.body(data.declaredAmount) },
      { kind: "paragraph", text: copy.reasonLabel },
      { kind: "quote", text: data.reason },
      { kind: "paragraph", text: copy.next },
      { kind: "button", label: copy.button, url: data.url },
    ],
  });
}

// --------------------------- Alerta de pasaporte ---------------------------

export interface PassportAlertData {
  tripName: string;
  passengerName: string | null;
  level: "BLOQUEANTE" | "ADVERTENCIA";
  /** Vencimiento del pasaporte, o null si no lo cargó. */
  expiryDate: string | null;
  /** Vencimiento mínimo que le permite viajar. */
  minimumDate: string;
  tripEndDate: string;
  url: string;
  footer: EmailFooter;
}

const PASSPORT = {
  es: {
    subjectBlocking: (trip: string) =>
      `Tu pasaporte no cumple los requisitos de ${trip}`,
    subjectWarning: (trip: string) => `Revisá tu pasaporte — ${trip}`,
    greeting: (name: string | null) => (name ? `Hola, ${name}.` : "Hola."),
    bodyBlocking:
      "Tu pasaporte no cumple con lo que el viaje necesita, así que todavía no podemos confirmarte. Es el único punto pendiente y se resuelve renovándolo.",
    bodyWarning:
      "Tu pasaporte cumple, pero por poco. Conviene que empieces el trámite de renovación ahora: los turnos suelen tardar.",
    rowExpiry: "Tu pasaporte vence",
    rowNoExpiry: "Todavía no cargaste el vencimiento",
    rowMinimum: "Tiene que ser válido al menos hasta",
    rowTripEnd: "El viaje vuelve el",
    button: "Ver mis datos",
  },
  en: {
    subjectBlocking: (trip: string) =>
      `Your passport doesn't meet the requirements for ${trip}`,
    subjectWarning: (trip: string) => `Please check your passport — ${trip}`,
    greeting: (name: string | null) => (name ? `Hello, ${name}.` : "Hello."),
    bodyBlocking:
      "Your passport doesn't meet what the trip requires, so we can't confirm your place yet. It's the only outstanding item, and renewing it solves it.",
    bodyWarning:
      "Your passport qualifies, but only just. It's worth starting the renewal now: appointments tend to take a while.",
    rowExpiry: "Your passport expires",
    rowNoExpiry: "You haven't entered the expiry date yet",
    rowMinimum: "It must be valid at least until",
    rowTripEnd: "The trip returns on",
    button: "View my details",
  },
} as const;

export function passportAlertEmail(
  lang: EmailLang,
  data: PassportAlertData,
): RenderedEmail {
  const copy = PASSPORT[lang];
  const blocking = data.level === "BLOQUEANTE";

  return renderEmail({
    lang,
    subject: blocking
      ? copy.subjectBlocking(data.tripName)
      : copy.subjectWarning(data.tripName),
    preheader: blocking ? copy.bodyBlocking : copy.bodyWarning,
    footer: data.footer,
    blocks: [
      { kind: "paragraph", text: copy.greeting(data.passengerName) },
      {
        kind: "paragraph",
        text: blocking ? copy.bodyBlocking : copy.bodyWarning,
      },
      {
        kind: "rows",
        rows: [
          data.expiryDate
            ? { label: copy.rowExpiry, value: data.expiryDate }
            : { label: copy.rowNoExpiry, value: "—" },
          { label: copy.rowMinimum, value: data.minimumDate },
          { label: copy.rowTripEnd, value: data.tripEndDate },
        ],
      },
      { kind: "button", label: copy.button, url: data.url },
    ],
  });
}

// --------------------- Comunicación del coordinador ------------------------

export interface CommunicationEmailData {
  /** Asunto tal como lo escribió el coordinador. */
  subject: string;
  /** Cuerpo tal como lo escribió. Texto plano; los saltos se respetan. */
  body: string;
  passengerName: string | null;
  footer: EmailFooter;
}

const COMMUNICATION = {
  es: { greeting: (name: string | null) => (name ? `Hola, ${name}.` : "Hola.") },
  en: {
    greeting: (name: string | null) => (name ? `Hello, ${name}.` : "Hello."),
  },
} as const;

/**
 * Mail que escribe el coordinador.
 *
 * El asunto y el cuerpo son suyos y se muestran tal cual. El cuerpo pasa por
 * `escapeHtml` en el layout: nunca se interpreta como HTML, ni siquiera si
 * quien escribe lo pega desde otro lado. Un editor de mails que ejecuta el
 * marcado que le pegan es un XSS esperando a pasar, y acá el destinatario ni
 * siquiera es quien escribió.
 */
export function communicationEmail(
  lang: EmailLang,
  data: CommunicationEmailData,
): RenderedEmail {
  return renderEmail({
    lang,
    subject: data.subject,
    preheader: data.body.slice(0, 140),
    footer: data.footer,
    blocks: [
      { kind: "paragraph", text: COMMUNICATION[lang].greeting(data.passengerName) },
      { kind: "body", text: data.body },
    ],
  });
}

/** Todas las plantillas, para el índice de la vista previa y los tests. */
export const TEMPLATES = {
  invitation: invitationEmail,
  paymentReminder: paymentReminderEmail,
  paymentConfirmed: paymentConfirmedEmail,
  paymentRejected: paymentRejectedEmail,
  passportAlert: passportAlertEmail,
  communication: communicationEmail,
} as const;

export type TemplateName = keyof typeof TEMPLATES;

export type { EmailBlock, EmailFooter };

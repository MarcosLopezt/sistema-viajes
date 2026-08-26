import type { EmailLang } from "../types";

/**
 * Mail de invitación.
 *
 * Plantilla mínima a propósito: el diseño de las plantillas es de la fase 5.
 * Lo que sí está resuelto acá es lo que no se puede corregir después:
 *
 *  - NUNCA lleva una contraseña. Solo el link con el token.
 *  - El link va también como texto plano visible, porque los clientes de mail
 *    rompen botones y la persona necesita poder copiarlo a mano.
 *  - Dice cuándo vence, para que no lo deje para dentro de un mes.
 *
 * El idioma sale de `Person.preferredLanguage` de quien recibe, no del idioma
 * en el que está navegando el coordinador que lo dispara.
 */

export interface InvitationEmailData {
  tripName: string;
  url: string;
  expiresAt: Date;
  /** Quién invita. Ayuda a que no parezca spam. */
  coordinatorName?: string | null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(date: Date, lang: EmailLang): string {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = date.getUTCFullYear();
  // dd/mm/aaaa en los dos idiomas: el público es rioplatense y el formato
  // mm/dd de en-US sería una fuente silenciosa de errores de lectura.
  return lang === "es"
    ? `${day}/${month}/${year}`
    : `${day}/${month}/${year}`;
}

const COPY = {
  es: {
    subject: (trip: string) => `Te invitamos a ${trip}`,
    greeting: "¡Hola!",
    body: (trip: string, by: string | null) =>
      by
        ? `${by} te invita a sumarte al viaje <strong>${trip}</strong>.`
        : `Te invitamos a sumarte al viaje <strong>${trip}</strong>.`,
    instructions:
      "Entrá al link de abajo para crear tu contraseña y completar tus datos. Son tres pasos cortos y podés terminarlos en otro momento si te queda a mitad.",
    button: "Completar mis datos",
    fallback: "Si el botón no funciona, copiá y pegá esta dirección:",
    expiry: (date: string) => `El link vence el ${date}.`,
    ignore:
      "Si no esperabas este mail, podés ignorarlo: sin el link nadie puede usarlo.",
  },
  en: {
    subject: (trip: string) => `You're invited to ${trip}`,
    greeting: "Hello!",
    body: (trip: string, by: string | null) =>
      by
        ? `${by} has invited you to join the trip <strong>${trip}</strong>.`
        : `You're invited to join the trip <strong>${trip}</strong>.`,
    instructions:
      "Use the link below to create your password and fill in your details. It's three short steps, and you can finish later if you don't get through them in one go.",
    button: "Fill in my details",
    fallback: "If the button doesn't work, copy and paste this address:",
    expiry: (date: string) => `The link expires on ${date}.`,
    ignore:
      "If you weren't expecting this email you can ignore it: without the link, nobody can use it.",
  },
} as const;

export function invitationEmail(
  lang: EmailLang,
  data: InvitationEmailData,
): { subject: string; html: string } {
  const copy = COPY[lang];
  const trip = escapeHtml(data.tripName);
  const by = data.coordinatorName ? escapeHtml(data.coordinatorName) : null;
  const url = escapeHtml(data.url);

  const html = `<!doctype html>
<html lang="${lang}">
  <body style="margin:0;padding:24px;background:#f6f6f6;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:16px;line-height:1.6;color:#1a1a1a;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
      <p style="margin:0 0 16px;">${copy.greeting}</p>
      <p style="margin:0 0 16px;">${copy.body(trip, by)}</p>
      <p style="margin:0 0 24px;">${copy.instructions}</p>

      <p style="margin:0 0 24px;">
        <a href="${url}"
           style="display:inline-block;padding:14px 24px;background:#1a1a1a;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">
          ${copy.button}
        </a>
      </p>

      <p style="margin:0 0 8px;color:#666;font-size:14px;">${copy.fallback}</p>
      <p style="margin:0 0 24px;word-break:break-all;font-size:14px;">
        <a href="${url}" style="color:#1a1a1a;">${url}</a>
      </p>

      <p style="margin:0 0 8px;color:#666;font-size:14px;">
        ${copy.expiry(formatDate(data.expiresAt, lang))}
      </p>
      <p style="margin:0;color:#666;font-size:14px;">${copy.ignore}</p>
    </div>
  </body>
</html>`;

  return { subject: copy.subject(data.tripName), html };
}

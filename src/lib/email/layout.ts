import type { EmailLang } from "./types";

/**
 * Esqueleto común de todos los mails del sistema.
 *
 * ── Por qué el HTML es feo a propósito ────────────────────────────────────
 *
 * Los clientes de mail no son navegadores. Outlook de escritorio renderiza con
 * el motor de Word; Gmail borra la etiqueta `<style>` entera en la vista web
 * de algunos clientes; muchos ignoran `flex`, `grid`, `border-radius` y las
 * variables CSS. Un mail "moderno" se ve perfecto en el navegador de quien lo
 * escribió y roto en la mitad de las casillas que lo reciben.
 *
 * Entonces, y sin excepciones:
 *
 *   - Maquetación con `<table>`, no con divs.
 *   - Estilos INLINE en cada elemento. Ninguna clase, ningún `<style>`.
 *   - Ancho máximo 600px, el que entra en todos los paneles de vista previa.
 *   - Colores en hex de 6 dígitos, nada de `oklch` ni `rgb()` moderno.
 *   - Nada de `border-radius` en lo que tenga que verse bien sí o sí: si un
 *     cliente lo ignora, se ve un rectángulo, no un botón roto.
 *
 * ── Texto plano ──────────────────────────────────────────────────────────
 *
 * TODOS los mails llevan versión de texto. No es una cortesía: un mail sin
 * `text/plain` puntúa peor en los filtros de spam, y es lo que ven los
 * lectores de pantalla y los clientes configurados en modo texto. Se genera
 * de los mismos bloques que el HTML, así que no puede quedar desactualizado
 * respecto del contenido — que es lo que pasa cuando se escribe a mano.
 */

// --------------------------------- Bloques ---------------------------------

export type EmailBlock =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string; muted?: boolean }
  /** Resalta un dato: un importe, una fecha. */
  | { kind: "highlight"; label: string; value: string }
  /** Filas etiqueta/valor. Para el detalle de una cuota o un pago. */
  | { kind: "rows"; rows: { label: string; value: string }[] }
  /** Texto que escribió una persona. Se muestra tal cual, entrecomillado. */
  | { kind: "quote"; text: string }
  | { kind: "button"; label: string; url: string }
  /** Texto libre del coordinador: los saltos de línea se respetan. */
  | { kind: "body"; text: string };

export interface EmailFooter {
  tripName: string;
  /** A quién responder. Si es null, el pie solo identifica el viaje. */
  replyToName?: string | null;
  replyToEmail?: string | null;
  /**
   * La firma de la escuela ("En la Lux de Alba, Laura y Lorena").
   *
   * Es DATO: la escriben las coordinadoras en el viaje, no vive en el código
   * ni en el catálogo de traducciones. Va acá —en el pie compartido— y no en
   * cada plantilla, porque así las SEIS la llevan por construcción: una firma
   * que hay que acordarse de pasar en cada mail es un mail sin firmar
   * esperando a ocurrir, y dos voces en el mismo sistema.
   *
   * Si es null el pie sale como salía antes. Un viaje sin firma cargada no
   * rompe nada, solo no firma.
   */
  signature?: string | null;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

// -------------------------------- Escapes ----------------------------------

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Escapa una URL para meterla en un `href`.
 *
 * Además de escapar, RECHAZA todo lo que no sea http/https. Sin esto, un
 * `javascript:` en un campo que termine en un link sería un vector de
 * inyección; los clientes de mail modernos lo bloquean, pero no todos, y no
 * es algo que convenga delegar.
 */
export function safeUrl(value: string): string {
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return "#";
  return escapeHtml(trimmed);
}

/** dd/mm/aaaa en los dos idiomas: el público es rioplatense. */
export function formatEmailDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(`${date}T00:00:00.000Z`) : date;
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${d.getUTCFullYear()}`;
}

// --------------------------------- Paleta ----------------------------------

const INK = "#1a1a1a";
const MUTED = "#5f5f5f";
const RULE = "#e2e2e2";
const PAPER = "#ffffff";
const CANVAS = "#f4f4f5";

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const FOOTER_COPY = {
  es: {
    about: (trip: string) => `Este mail es sobre el viaje ${trip}.`,
    replyTo: (who: string) => `Si necesitás algo, respondé a ${who}.`,
    automatic: "Este es un mail automático del sistema de viajes.",
  },
  en: {
    about: (trip: string) => `This email is about the trip ${trip}.`,
    replyTo: (who: string) => `If you need anything, reply to ${who}.`,
    automatic: "This is an automated email from the trips system.",
  },
} as const;

// ------------------------------ Render HTML --------------------------------

function renderBlockHtml(block: EmailBlock): string {
  switch (block.kind) {
    case "heading":
      return `<tr><td style="padding:0 0 16px;font-family:${FONT};font-size:20px;line-height:1.35;font-weight:bold;color:${INK};">${escapeHtml(block.text)}</td></tr>`;

    case "paragraph":
      return `<tr><td style="padding:0 0 16px;font-family:${FONT};font-size:16px;line-height:1.6;color:${block.muted ? MUTED : INK};">${escapeHtml(block.text)}</td></tr>`;

    case "body":
      // Texto que escribió el coordinador. Se escapa y los saltos de línea se
      // convierten en <br>: nunca se interpreta HTML de un campo de usuario.
      return `<tr><td style="padding:0 0 16px;font-family:${FONT};font-size:16px;line-height:1.6;color:${INK};">${escapeHtml(
        block.text,
      ).replace(/\r?\n/g, "<br />")}</td></tr>`;

    case "highlight":
      return `<tr><td style="padding:0 0 20px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${CANVAS};">
          <tr><td style="padding:16px 20px;font-family:${FONT};">
            <div style="font-size:14px;color:${MUTED};padding-bottom:4px;">${escapeHtml(block.label)}</div>
            <div style="font-size:24px;font-weight:bold;color:${INK};">${escapeHtml(block.value)}</div>
          </td></tr>
        </table>
      </td></tr>`;

    case "rows":
      return `<tr><td style="padding:0 0 20px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="font-family:${FONT};font-size:15px;">
          ${block.rows
            .map(
              (row) =>
                `<tr>
                  <td style="padding:8px 0;border-bottom:1px solid ${RULE};color:${MUTED};">${escapeHtml(row.label)}</td>
                  <td style="padding:8px 0;border-bottom:1px solid ${RULE};color:${INK};text-align:right;font-weight:bold;">${escapeHtml(row.value)}</td>
                </tr>`,
            )
            .join("")}
        </table>
      </td></tr>`;

    case "quote":
      return `<tr><td style="padding:0 0 20px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${CANVAS};border-left:4px solid ${MUTED};">
          <tr><td style="padding:14px 18px;font-family:${FONT};font-size:15px;line-height:1.6;color:${INK};">${escapeHtml(
            block.text,
          ).replace(/\r?\n/g, "<br />")}</td></tr>
        </table>
      </td></tr>`;

    case "button": {
      const url = safeUrl(block.url);
      // El link va DOS veces: como botón y como texto copiable. Los clientes
      // de mail rompen botones con frecuencia, y quien recibe el mail tiene
      // que poder llegar igual.
      return `<tr><td style="padding:0 0 12px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="background:${INK};">
            <a href="${url}" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:16px;font-weight:bold;color:${PAPER};text-decoration:none;">${escapeHtml(block.label)}</a>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:0 0 20px;font-family:${FONT};font-size:13px;line-height:1.5;color:${MUTED};word-break:break-all;">
        <a href="${url}" style="color:${MUTED};">${url}</a>
      </td></tr>`;
    }
  }
}

function renderBlockText(block: EmailBlock): string {
  switch (block.kind) {
    case "heading":
      return `${block.text}\n${"=".repeat(Math.min(block.text.length, 60))}`;
    case "paragraph":
    case "body":
      return block.text;
    case "highlight":
      return `${block.label}: ${block.value}`;
    case "rows":
      return block.rows.map((row) => `  ${row.label}: ${row.value}`).join("\n");
    case "quote":
      return block.text
        .split(/\r?\n/)
        .map((line) => `> ${line}`)
        .join("\n");
    case "button":
      return `${block.label}:\n${block.url}`;
  }
}

// -------------------------------- Ensamblado -------------------------------

export interface RenderEmailInput {
  lang: EmailLang;
  subject: string;
  /** Encabezado del cuerpo. Suele repetir el asunto y está bien que lo haga. */
  preheader?: string;
  blocks: EmailBlock[];
  footer: EmailFooter;
}

export function renderEmail(input: RenderEmailInput): RenderedEmail {
  const { lang, subject, blocks, footer } = input;
  const copy = FOOTER_COPY[lang];

  const replyTo =
    footer.replyToEmail !== null && footer.replyToEmail !== undefined
      ? [footer.replyToName, footer.replyToEmail].filter(Boolean).join(" · ")
      : null;

  // La firma va PRIMERA y separada del resto: es la voz de la escuela
  // despidiéndose, no un dato de contacto. Lo que sigue —de qué viaje es esto,
  // a quién responder, que es automático— es información de servicio.
  const signature = footer.signature?.trim();

  const footerLines = [
    ...(signature ? [signature] : []),
    copy.about(footer.tripName),
    ...(replyTo ? [copy.replyTo(replyTo)] : []),
    copy.automatic,
  ];

  const html = `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${CANVAS};">
${
  input.preheader
    ? // Preheader: el resumen que muestra la bandeja al lado del asunto. Va
      // oculto, porque si no se lo pone el cliente muestra las primeras
      // palabras del HTML, que suelen ser basura.
      `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(input.preheader)}</div>`
    : ""
}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${CANVAS};">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:100%;background:${PAPER};">
        <tr>
          <td style="padding:32px 28px 8px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              ${blocks.map(renderBlockHtml).join("\n")}
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 28px 28px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr><td style="border-top:1px solid ${RULE};padding-top:16px;font-family:${FONT};font-size:13px;line-height:1.6;color:${MUTED};">
                ${footerLines.map(escapeHtml).join("<br />")}
              </td></tr>
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  const text = [
    ...blocks.map(renderBlockText),
    "",
    "—".repeat(30),
    ...footerLines,
  ]
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { subject, html, text };
}

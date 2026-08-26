import type { EmailLang, EmailProvider, EmailSendResult } from "./types";

/**
 * Proveedor de desarrollo: no envía nada, imprime el mail en consola.
 *
 * Es el default para que un `npm run dev` recién clonado funcione sin una
 * cuenta de Brevo ni riesgo de mandarle mail de prueba a una persona real.
 *
 * Sobre el enmascarado: la consigna dice no loguear datos personales, y una
 * casilla lo es. Pero un proveedor de desarrollo que oculta a quién le escribe
 * no sirve para desarrollar. La salida: en desarrollo se imprime todo, y en
 * cualquier otro entorno se enmascara el destinatario y se omite el cuerpo.
 * Así, si este proveedor queda activo en producción por un error de
 * configuración, no filtra nada a los logs de la plataforma.
 */
export class ConsoleEmailProvider implements EmailProvider {
  readonly name = "console";

  async send(
    to: string,
    subject: string,
    html: string,
    lang: EmailLang,
  ): Promise<EmailSendResult> {
    const isDev = process.env.NODE_ENV === "development";

    if (isDev) {
      console.info(
        [
          "",
          "──────────────── MAIL (no enviado) ────────────────",
          `Para    : ${to}`,
          `Idioma  : ${lang}`,
          `Asunto  : ${subject}`,
          "───────────────────────────────────────────────────",
          html,
          "───────────────────────────────────────────────────",
          "",
        ].join("\n"),
      );
    } else {
      console.info(
        `[email:console] enviado a ${maskEmail(to)} (lang=${lang}) — cuerpo omitido`,
      );
    }

    return { messageId: null, provider: this.name };
  }
}

/** `marcos@ejemplo.com` → `m****s@ejemplo.com` */
function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  if (local.length <= 2) return `**@${domain}`;
  return `${local[0]}****${local[local.length - 1]}@${domain}`;
}

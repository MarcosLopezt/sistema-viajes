import type { EmailMessage, EmailProvider, EmailSendResult } from "./types";

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

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const isDev = process.env.NODE_ENV === "development";

    if (isDev) {
      // Se imprime la versión de TEXTO, no el HTML: en una terminal, cien
      // líneas de tablas con estilos inline tapan el contenido, que es
      // justamente lo que uno está tratando de leer. El HTML se mira en la
      // vista previa de la pantalla de comunicaciones, que para eso está.
      console.info(
        [
          "",
          "──────────────── MAIL (no enviado) ────────────────",
          `Para        : ${message.to}`,
          `Idioma      : ${message.lang}`,
          ...(message.replyTo
            ? [`Responder a : ${message.replyTo.email}`]
            : []),
          `Asunto      : ${message.subject}`,
          "───────────────────────────────────────────────────",
          message.text,
          "───────────────────────────────────────────────────",
          "",
        ].join("\n"),
      );
    } else {
      console.info(
        `[email:console] enviado a ${maskEmail(message.to)} (lang=${message.lang}) — cuerpo omitido`,
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

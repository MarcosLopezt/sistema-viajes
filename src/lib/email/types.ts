export type EmailLang = "es" | "en";

export interface EmailSendResult {
  /** Id que devuelve el proveedor. Sirve para rastrear el envío en su panel. */
  messageId: string | null;
  provider: string;
}

/**
 * Toda salida de mail del sistema pasa por acá.
 *
 * La firma es `send(to, subject, html, lang)`: el idioma es un parámetro de
 * primer nivel y no un detalle del cuerpo, porque el proveedor lo necesita
 * para las cabeceras y porque obliga a que quien llama haya resuelto en qué
 * idioma escribe. El idioma sale siempre de `Person.preferredLanguage`, nunca
 * del locale de la URL de quien dispara el envío: el coordinador puede estar
 * navegando en español y el destinatario leer en inglés.
 */
export interface EmailProvider {
  readonly name: string;
  send(
    to: string,
    subject: string,
    html: string,
    lang: EmailLang,
  ): Promise<EmailSendResult>;
}

export class EmailSendError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = "EmailSendError";
  }
}

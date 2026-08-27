export type EmailLang = "es" | "en";

export interface EmailSendResult {
  /** Id que devuelve el proveedor. Sirve para rastrear el envío en su panel. */
  messageId: string | null;
  provider: string;
}

/**
 * Un mail listo para salir.
 *
 * `text` no es opcional. Un mail sin `text/plain` puntúa peor en los filtros
 * de spam y es lo que ven los lectores de pantalla y los clientes en modo
 * texto; hacerlo obligatorio en el tipo es la única forma de que nadie se
 * olvide. Lo genera `renderEmail()` a partir de los mismos bloques que el
 * HTML, así que no puede quedar desincronizado.
 *
 * `lang` es un parámetro de primer nivel y no un detalle del cuerpo: el
 * proveedor lo necesita para las cabeceras, y tenerlo acá obliga a que quien
 * llama haya resuelto en qué idioma escribe. Sale siempre de
 * `Person.preferredLanguage` del destinatario, nunca del locale de la URL de
 * quien dispara el envío: el coordinador puede estar navegando en español y
 * el destinatario leer en inglés.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  lang: EmailLang;
  /** A quién contesta el destinatario si aprieta "responder". */
  replyTo?: { name?: string | null; email: string } | null;
}

/** Toda salida de mail del sistema pasa por acá. */
export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<EmailSendResult>;
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

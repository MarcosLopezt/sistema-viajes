import {
  EmailSendError,
  type EmailLang,
  type EmailProvider,
  type EmailSendResult,
} from "./types";

const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";

/**
 * Adaptador de Brevo (API REST transaccional, free tier 300 mails/día).
 *
 * El límite diario es la razón por la que los envíos masivos no salen de un
 * request: se encolan como filas de CommunicationRecipient y las procesa el
 * cron por lotes. Este adaptador manda de a un mail y no sabe nada de eso.
 */
export class BrevoEmailProvider implements EmailProvider {
  readonly name = "brevo";

  constructor(
    private readonly apiKey: string,
    private readonly fromName: string,
    private readonly fromAddress: string,
  ) {}

  async send(
    to: string,
    subject: string,
    html: string,
    lang: EmailLang,
  ): Promise<EmailSendResult> {
    let response: Response;

    try {
      response = await fetch(BREVO_ENDPOINT, {
        method: "POST",
        headers: {
          "api-key": this.apiKey,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          sender: { name: this.fromName, email: this.fromAddress },
          to: [{ email: to }],
          subject,
          htmlContent: html,
          // Ayuda a los clientes de mail a elegir diccionario y dirección de
          // texto, y deja el idioma trazable en el panel de Brevo.
          headers: { "Content-Language": lang },
        }),
      });
    } catch (cause) {
      throw new EmailSendError(
        `No se pudo contactar a Brevo: ${(cause as Error).message}`,
        this.name,
      );
    }

    if (!response.ok) {
      // El cuerpo del error de Brevo puede repetir el destinatario, así que no
      // se incluye en el mensaje: quedaría en los logs de la plataforma.
      throw new EmailSendError(
        `Brevo rechazó el envío (HTTP ${response.status})`,
        this.name,
        response.status,
      );
    }

    const payload = (await response.json()) as { messageId?: string };
    return { messageId: payload.messageId ?? null, provider: this.name };
  }
}

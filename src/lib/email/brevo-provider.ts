import {
  EmailSendError,
  type EmailMessage,
  type EmailProvider,
  type EmailSendResult,
} from "./types";

const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";

/** Cuánto esperamos a Brevo antes de dar el envío por fallido. */
const TIMEOUT_MS = 10_000;

/**
 * Adaptador de Brevo (API REST transaccional, free tier 300 mails/día).
 *
 * El límite diario es la razón por la que los envíos masivos no salen de un
 * request: se encolan como filas de `CommunicationRecipient` y las procesa el
 * cron por lotes. Este adaptador manda de a un mail y no sabe nada de eso.
 *
 * ── El error tiene que ser legible ────────────────────────────────────────
 *
 * Cuando Brevo rechaza un envío, el mensaje que arma este adaptador termina
 * guardado en `CommunicationRecipient.error` y el coordinador lo lee en
 * pantalla. Por eso se extrae el `message` que devuelve la API en vez de
 * quedarse con "HTTP 400": la diferencia entre "el dominio del remitente no
 * está verificado" y un número es la diferencia entre poder arreglarlo y
 * abrir un ticket.
 *
 * Lo que NO se incluye nunca es el destinatario, aunque Brevo lo repita en su
 * respuesta: ese texto va a la base y a los logs, y una casilla es un dato
 * personal.
 */
export class BrevoEmailProvider implements EmailProvider {
  readonly name = "brevo";

  constructor(
    private readonly apiKey: string,
    private readonly fromName: string,
    private readonly fromAddress: string,
  ) {}

  async send(message: EmailMessage): Promise<EmailSendResult> {
    let response: Response;

    try {
      response = await fetch(BREVO_ENDPOINT, {
        method: "POST",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          "api-key": this.apiKey,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          sender: { name: this.fromName, email: this.fromAddress },
          to: [{ email: message.to }],
          ...(message.replyTo
            ? {
                replyTo: {
                  email: message.replyTo.email,
                  ...(message.replyTo.name
                    ? { name: message.replyTo.name }
                    : {}),
                },
              }
            : {}),
          subject: message.subject,
          htmlContent: message.html,
          textContent: message.text,
          // Ayuda a los clientes de mail a elegir diccionario y deja el idioma
          // trazable en el panel de Brevo.
          headers: { "Content-Language": message.lang },
        }),
      });
    } catch (cause) {
      const reason =
        (cause as Error).name === "TimeoutError"
          ? `no respondió en ${TIMEOUT_MS / 1000} s`
          : (cause as Error).message;
      throw new EmailSendError(
        `No se pudo contactar a Brevo: ${reason}`,
        this.name,
      );
    }

    if (!response.ok) {
      throw new EmailSendError(
        `Brevo rechazó el envío (HTTP ${response.status}): ${await describeError(
          response,
          message.to,
        )}`,
        this.name,
        response.status,
      );
    }

    const payload = (await response.json().catch(() => ({}))) as {
      messageId?: string;
    };
    return { messageId: payload.messageId ?? null, provider: this.name };
  }
}

/**
 * Saca de la respuesta de error un texto que le sirva a una persona.
 *
 * Brevo contesta `{ code, message }`. Si el mensaje menciona la casilla del
 * destinatario, se la reemplaza: el texto se guarda en la base y se muestra
 * en pantalla, y ahí no va un mail ajeno.
 */
async function describeError(
  response: Response,
  recipient: string,
): Promise<string> {
  try {
    const payload = (await response.json()) as {
      code?: string;
      message?: string;
    };
    const detail = payload.message ?? payload.code ?? "sin detalle";
    return detail.split(recipient).join("el destinatario");
  } catch {
    return "sin detalle";
  }
}

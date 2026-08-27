import "dotenv/config";
import { getEmailProvider, EmailSendError } from "../src/lib/email";
import {
  communicationEmail,
  invitationEmail,
  passportAlertEmail,
  paymentConfirmedEmail,
  paymentReminderEmail,
  paymentRejectedEmail,
} from "../src/lib/email/templates";

/**
 * Manda una plantilla de verdad a una casilla de verdad.
 *
 * Existe para lo único que no se puede verificar con un test: que el mail se
 * VEA bien en un cliente de mail real. Las plantillas se testean —tienen texto
 * plano, no usan CSS moderno, escapan lo que escribe una persona— pero ningún
 * test dice si el botón se corta en Outlook.
 *
 *   npm run email:test -- vos@tu-casilla.com
 *   npm run email:test -- vos@tu-casilla.com recordatorio
 *
 * Con EMAIL_PROVIDER=console (el default) imprime en consola sin enviar. Para
 * probar Brevo de verdad:
 *
 *   EMAIL_PROVIDER=brevo BREVO_API_KEY=xkeysib-... \
 *   EMAIL_FROM_ADDRESS=una-casilla-verificada@tu-dominio.com \
 *   npm run email:test -- vos@tu-casilla.com
 *
 * El remitente TIENE que estar verificado en Brevo. Si no lo está, la API
 * responde 400 y el mensaje de error lo dice; ese texto es el mismo que
 * terminaría en `CommunicationRecipient.error` y que el coordinador vería en
 * pantalla.
 */

const FOOTER = {
  tripName: "Londres, París y Roma — mayo 2027",
  replyToName: "Coordinación",
  replyToEmail: "coordinador@ejemplo.test",
};

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

const TEMPLATES = {
  invitacion: () =>
    invitationEmail("es", {
      tripName: FOOTER.tripName,
      url: `${BASE}/es/invitacion/token-de-ejemplo`,
      expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      coordinatorName: "Coordinación",
      footer: FOOTER,
    }),
  recordatorio: () =>
    paymentReminderEmail("es", {
      tripName: FOOTER.tripName,
      passengerName: "Ana",
      installmentNumber: 2,
      amount: "£ 1.330,00",
      dueDate: "15/09/2026",
      balance: "£ 2.660,00",
      overdue: false,
      url: `${BASE}/es/mis-pagos`,
      footer: FOOTER,
    }),
  vencida: () =>
    paymentReminderEmail("es", {
      tripName: FOOTER.tripName,
      passengerName: "Ana",
      installmentNumber: 2,
      amount: "£ 1.330,00",
      dueDate: "15/08/2026",
      balance: "£ 2.660,00",
      overdue: true,
      url: `${BASE}/es/mis-pagos`,
      footer: FOOTER,
    }),
  confirmado: () =>
    paymentConfirmedEmail("es", {
      tripName: FOOTER.tripName,
      passengerName: "Ana",
      declaredAmount: "€ 2.330,00",
      imputedAmount: "£ 2.012,50",
      installmentNumber: 1,
      balance: "£ 1.977,50",
      url: `${BASE}/es/mis-pagos`,
      footer: FOOTER,
    }),
  rechazado: () =>
    paymentRejectedEmail("es", {
      tripName: FOOTER.tripName,
      passengerName: "Ana",
      declaredAmount: "£ 1.330,00",
      installmentNumber: 1,
      reason:
        "El comprobante está cortado y no se lee el importe. ¿Podés sacarle otra foto que se vea entero?",
      url: `${BASE}/es/mis-pagos`,
      footer: FOOTER,
    }),
  pasaporte: () =>
    passportAlertEmail("es", {
      tripName: FOOTER.tripName,
      passengerName: "Carla",
      level: "BLOQUEANTE",
      expiryDate: "01/03/2027",
      minimumDate: "24/08/2027",
      tripEndDate: "24/05/2027",
      url: `${BASE}/es/mis-datos`,
      footer: FOOTER,
    }),
  comunicacion: () =>
    communicationEmail("es", {
      subject: "Últimos detalles antes de salir",
      body: "Hola a todos.\n\nNos encontramos el jueves 8 a las 6 de la mañana en el aeropuerto, en el mostrador de la aerolínea.\n\nLleven el pasaporte a mano y la impresión del seguro. Cualquier cosa, respondan este mail.",
      passengerName: "Ana",
      footer: FOOTER,
    }),
} as const;

type TemplateKey = keyof typeof TEMPLATES;

async function main(): Promise<void> {
  const [to, requested] = process.argv.slice(2);

  if (!to || !to.includes("@")) {
    console.error(
      [
        "",
        "Falta la casilla de destino.",
        "",
        "  npm run email:test -- vos@tu-casilla.com [plantilla] [--texto]",
        "",
        `Plantillas: ${Object.keys(TEMPLATES).join(", ")}`,
        "",
      ].join("\n"),
    );
    process.exit(1);
  }

  const keys = (
    requested ? [requested] : Object.keys(TEMPLATES)
  ) as TemplateKey[];

  for (const key of keys) {
    const template = TEMPLATES[key];
    if (!template) {
      console.error(
        `No existe la plantilla "${key}". Opciones: ${Object.keys(TEMPLATES).join(", ")}`,
      );
      process.exit(1);
    }
  }

  const provider = getEmailProvider();
  const verbose = process.argv.includes("--texto");

  console.info(`\nProveedor: ${provider.name}\nDestino  : ${to}\n`);

  for (const key of keys) {
    const rendered = TEMPLATES[key]();

    // Con `--texto` se imprime la versión de texto plano acá mismo. El
    // proveedor de consola la oculta fuera de desarrollo a propósito —para no
    // filtrar cuerpos a los logs de la plataforma— pero este script se invoca
    // a mano y con una casilla explícita: acá mostrarla es el punto.
    if (verbose) {
      console.info(
        `\n─── ${key} ───\n${rendered.subject}\n\n${rendered.text}\n`,
      );
    }

    try {
      const result = await provider.send({
        to,
        subject: `[${key}] ${rendered.subject}`,
        html: rendered.html,
        text: rendered.text,
        lang: "es",
        replyTo: { name: FOOTER.replyToName, email: FOOTER.replyToEmail },
      });
      console.info(`  ✓ ${key}${result.messageId ? ` · ${result.messageId}` : ""}`);
    } catch (error) {
      // El mismo texto que vería el coordinador en pantalla si esto fallara
      // durante un envío real.
      const detail =
        error instanceof EmailSendError
          ? error.message
          : (error as Error).message;
      console.error(`  ✗ ${key}: ${detail}`);
      process.exitCode = 1;
    }
  }

  console.info("");
}

void main();

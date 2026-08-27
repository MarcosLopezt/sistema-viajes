import "server-only";

import { prisma } from "@/lib/db/prisma";
import { getEmailProvider, type EmailLang, type EmailMessage } from "@/lib/email";
import type { EmailFooter } from "@/lib/email/layout";

/**
 * La salida de mails del sistema, con el contexto ya resuelto.
 *
 * Toda plantilla necesita tres cosas que no vienen del caso puntual: la URL
 * pública de la app para armar los links, el pie que identifica el viaje, y a
 * quién responde el destinatario. Resolverlas en cada llamador significaría
 * seis lugares donde olvidarse del `replyTo`, y un mail automático al que no
 * se le puede contestar es una vía muerta.
 *
 * Este módulo NO decide permisos: eso ya pasó antes de llegar acá.
 */

/** Idioma del destinatario. Nunca el locale de quien dispara el envío. */
export function langOf(preferred: "ES" | "EN"): EmailLang {
  return preferred === "EN" ? "en" : "es";
}

/**
 * URL pública de la app, sin barra final.
 *
 * Si falta, los mails saldrían con links a "undefined/mis-pagos". Se falla
 * temprano y con un mensaje accionable en vez de mandar el mail roto.
 */
export function appBaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_APP_URL;
  if (!url) {
    throw new Error(
      "Falta NEXT_PUBLIC_APP_URL: los mails llevan links a la app. Ver .env.example.",
    );
  }
  return url.replace(/\/+$/, "");
}

/** Link a una pantalla, en el idioma del destinatario. */
export function appUrl(path: string, lang: EmailLang): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${appBaseUrl()}/${lang}${clean}`;
}

export interface TripEmailContext {
  tripId: string;
  tripName: string;
  /** A quién contesta el pasajero si aprieta "responder". */
  replyTo: { name: string | null; email: string } | null;
}

/**
 * Contexto de mail de un viaje: su nombre y a quién responder.
 *
 * El "responder a" es el primer coordinador del viaje, o `EMAIL_REPLY_TO` si
 * está configurado. Que sea una persona y no `no-reply@` es deliberado: quien
 * recibe "tu pago fue rechazado" tiene una pregunta, y la va a hacer
 * apretando responder.
 */
export async function tripEmailContext(
  tripId: string,
): Promise<TripEmailContext> {
  const trip = await prisma.trip.findUniqueOrThrow({
    where: { id: tripId },
    select: {
      id: true,
      name: true,
      members: {
        where: { role: "COORDINADOR" },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: {
          user: {
            select: { email: true, person: { select: { fullName: true } } },
          },
        },
      },
    },
  });

  const override = process.env.EMAIL_REPLY_TO;
  const coordinator = trip.members[0]?.user;

  const replyTo = override
    ? { name: null, email: override }
    : coordinator
      ? { name: coordinator.person?.fullName ?? null, email: coordinator.email }
      : null;

  return { tripId: trip.id, tripName: trip.name, replyTo };
}

export function footerFor(context: TripEmailContext): EmailFooter {
  return {
    tripName: context.tripName,
    replyToName: context.replyTo?.name ?? null,
    replyToEmail: context.replyTo?.email ?? null,
  };
}

export interface DeliverInput {
  to: string;
  lang: EmailLang;
  rendered: { subject: string; html: string; text: string };
  context: TripEmailContext;
}

/** Manda el mail por el proveedor configurado. Propaga el error tal cual. */
export async function deliver(input: DeliverInput) {
  const message: EmailMessage = {
    to: input.to,
    subject: input.rendered.subject,
    html: input.rendered.html,
    text: input.rendered.text,
    lang: input.lang,
    replyTo: input.context.replyTo,
  };

  return getEmailProvider().send(message);
}

/**
 * Manda el mail y se traga el error, devolviendo si salió.
 *
 * Para los avisos que acompañan una acción que YA ocurrió: confirmar un pago
 * no puede fallar porque el proveedor de mail esté caído. El pago está
 * confirmado; el mail se reintenta o se avisa a mano.
 */
export async function tryDeliver(input: DeliverInput): Promise<boolean> {
  try {
    await deliver(input);
    return true;
  } catch (error) {
    // Nunca el destinatario: es un dato personal y esto va a los logs.
    console.error(
      `[notificaciones] no se pudo enviar "${input.rendered.subject}": ${(error as Error).message}`,
    );
    return false;
  }
}

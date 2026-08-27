"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ForbiddenError, UnauthorizedError } from "@/lib/auth/errors";
import { EmailSendError } from "@/lib/email";
import {
  CommunicationError,
  createCommunication,
  deleteCommunication,
  previewCommunication,
  retryFailedRecipients,
  scheduleCommunication,
  sendCommunicationNow,
  sendTestEmail,
  setSelectedPassengers,
  updateCommunication,
  type CommunicationPreview,
  type SendReport,
} from "@/lib/services/communications";
import {
  communicationDraftSchema,
  scheduleSchema,
} from "@/lib/validation/communication";

/**
 * Acciones del coordinador sobre comunicaciones.
 *
 * Cáscaras finas: validan la forma del input y traducen errores. La
 * autorización vive en el servicio, que exige `communication:send` sobre el
 * viaje resuelto desde la comunicación.
 */

export type ActionResult<T = void> =
  | ({ ok: true } & (T extends void ? { data?: undefined } : { data: T }))
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

function failure(error: string, fieldErrors?: Record<string, string[]>) {
  return { ok: false as const, error, ...(fieldErrors ? { fieldErrors } : {}) };
}

async function run<T>(operation: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await operation();
    return { ok: true, data } as ActionResult<T>;
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof UnauthorizedError) {
      throw error;
    }
    // El error del proveedor se muestra tal cual: "el dominio del remitente no
    // está verificado" es accionable, "algo salió mal" no.
    if (
      error instanceof CommunicationError ||
      error instanceof EmailSendError
    ) {
      return failure(error.message);
    }
    console.error("[comunicaciones] acción fallida", (error as Error).message);
    return failure("No se pudo completar la acción. Probá de nuevo.");
  }
}

function revalidate(tripId: string, communicationId?: string): void {
  revalidatePath(`/[locale]/viajes/${tripId}/comunicaciones`, "page");
  revalidatePath(`/[locale]/viajes/${tripId}`, "page");
  if (communicationId) {
    revalidatePath(
      `/[locale]/viajes/${tripId}/comunicaciones/${communicationId}`,
      "page",
    );
  }
}

// ------------------------------ Borrador -----------------------------------

export async function createCommunicationAction(
  tripId: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = communicationDraftSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors as Record<
      string,
      string[]
    >;
    return failure(
      Object.values(fieldErrors).flat()[0] ?? "Revisá el asunto y el mensaje.",
      fieldErrors,
    );
  }

  const result = await run(() => createCommunication(tripId, parsed.data));
  if (result.ok) revalidate(tripId);
  return result;
}

export async function updateCommunicationAction(
  tripId: string,
  communicationId: string,
  input: unknown,
): Promise<ActionResult> {
  const parsed = communicationDraftSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors as Record<
      string,
      string[]
    >;
    return failure(
      Object.values(fieldErrors).flat()[0] ?? "Revisá el asunto y el mensaje.",
      fieldErrors,
    );
  }

  const result = await run(async () => {
    await updateCommunication(communicationId, parsed.data);
    if (parsed.data.audience === "SELECCION") {
      await setSelectedPassengers(communicationId, parsed.data.passengerIds);
    }
  });

  if (result.ok) revalidate(tripId, communicationId);
  return result;
}

export async function deleteCommunicationAction(
  tripId: string,
  communicationId: string,
): Promise<ActionResult> {
  const result = await run(() => deleteCommunication(communicationId));
  if (result.ok) revalidate(tripId);
  return result;
}

// --------------------------- Antes de enviar -------------------------------

/** Vista previa. Se renderiza con las mismas funciones que el envío real. */
export async function previewCommunicationAction(
  communicationId: string,
): Promise<ActionResult<CommunicationPreview[]>> {
  return run(() => previewCommunication(communicationId));
}

/**
 * Prueba a la casilla del propio coordinador.
 *
 * El destinatario NO viene del cliente: sale de la sesión. Si se pudiera
 * elegir, esto sería un relay abierto con el remitente del viaje.
 */
export async function sendTestEmailAction(
  communicationId: string,
  lang: unknown,
): Promise<ActionResult<{ to: string }>> {
  const parsed = z.enum(["ES", "EN"]).safeParse(lang);
  if (!parsed.success) return failure("Idioma inválido.");

  return run(() => sendTestEmail(communicationId, parsed.data));
}

// -------------------------------- Envío ------------------------------------

export async function sendNowAction(
  tripId: string,
  communicationId: string,
): Promise<ActionResult<SendReport>> {
  const result = await run(() => sendCommunicationNow(communicationId));
  if (result.ok) revalidate(tripId, communicationId);
  return result;
}

export async function scheduleAction(
  tripId: string,
  communicationId: string,
  input: unknown,
): Promise<ActionResult> {
  const parsed = scheduleSchema.safeParse(input);
  if (!parsed.success) {
    return failure(
      parsed.error.issues[0]?.message ?? "Revisá la fecha y la hora.",
    );
  }

  const result = await run(() =>
    // El `<input type="datetime">` del navegador emite hora local del
    // coordinador; se interpreta como tal y se guarda el instante. El cron
    // compara instantes, no días, así que acá no interviene `Trip.timezone`.
    scheduleCommunication(
      communicationId,
      new Date(`${parsed.data.date}T${parsed.data.time}:00`),
    ),
  );

  if (result.ok) revalidate(tripId, communicationId);
  return result;
}

export async function retryFailedAction(
  tripId: string,
  communicationId: string,
): Promise<ActionResult<SendReport>> {
  const result = await run(() => retryFailedRecipients(communicationId));
  if (result.ok) revalidate(tripId, communicationId);
  return result;
}

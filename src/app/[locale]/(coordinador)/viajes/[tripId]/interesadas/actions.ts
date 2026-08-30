"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ForbiddenError, UnauthorizedError } from "@/lib/auth/errors";
import {
  convertInterestToPassenger,
  InterestError,
  setInterestNotes,
  setInterestStatus,
  setMeetingDone,
} from "@/lib/services/interest";

/**
 * Server Actions del embudo de interesadas.
 *
 * Cáscaras finas. Ninguna recibe un `tripId` del cliente: el servicio lo
 * resuelve a partir del `interestId` y después verifica la capability contra
 * ESE viaje. Es el mismo criterio que usa `requirePassengerAccess()`, y elimina
 * de raíz el poder pedir una interesada de un viaje pasando el id de otro.
 */

export type ActionResult =
  | { ok: true }
  | { ok: false; error: string };

const statusSchema = z.enum(["REGISTRADA", "EN_CONVERSACION", "DESCARTADA"]);
const roomTypeSchema = z.enum(["DOBLE", "SINGLE"]);

/** Traduce las excepciones conocidas a un resultado; deja pasar el resto. */
async function run(fn: () => Promise<unknown>): Promise<ActionResult> {
  try {
    await fn();
    return { ok: true };
  } catch (error) {
    if (error instanceof InterestError) {
      return { ok: false, error: error.message };
    }
    if (error instanceof ForbiddenError || error instanceof UnauthorizedError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}

function revalidate(tripId: string): void {
  revalidatePath(`/[locale]/viajes/${tripId}/interesadas`, "page");
  // La conversión crea un Passenger: el listado de pasajeras también cambió.
  revalidatePath(`/[locale]/viajes/${tripId}/pasajeros`, "page");
}

export async function setInterestStatusAction(
  interestId: string,
  tripId: string,
  status: unknown,
): Promise<ActionResult> {
  const parsed = statusSchema.safeParse(status);
  if (!parsed.success) return { ok: false, error: "Estado inválido." };

  const result = await run(() => setInterestStatus(interestId, parsed.data));
  if (result.ok) revalidate(tripId);
  return result;
}

export async function setMeetingDoneAction(
  interestId: string,
  tripId: string,
  done: boolean,
): Promise<ActionResult> {
  const result = await run(() => setMeetingDone(interestId, done));
  if (result.ok) revalidate(tripId);
  return result;
}

export async function setInterestNotesAction(
  interestId: string,
  tripId: string,
  notes: string,
): Promise<ActionResult> {
  if (notes.length > 2000) {
    return { ok: false, error: "La nota es demasiado larga." };
  }
  const result = await run(() => setInterestNotes(interestId, notes));
  if (result.ok) revalidate(tripId);
  return result;
}

/**
 * Convierte una interesada en pasajera.
 *
 * El `tripId` que llega acá se usa SOLO para revalidar la ruta. La
 * autorización la resuelve el servicio desde el `interestId`, así que mandar
 * el de otro viaje no sirve para nada.
 */
export async function convertInterestAction(
  interestId: string,
  tripId: string,
  roomType: unknown,
): Promise<ActionResult> {
  const parsed = roomTypeSchema.safeParse(roomType);
  if (!parsed.success) {
    return { ok: false, error: "Elegí el tipo de habitación." };
  }

  const result = await run(() =>
    convertInterestToPassenger(interestId, parsed.data),
  );
  if (result.ok) revalidate(tripId);
  return result;
}

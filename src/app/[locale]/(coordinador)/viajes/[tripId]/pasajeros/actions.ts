"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { z } from "zod";
import { ForbiddenError, UnauthorizedError } from "@/lib/auth/errors";
import { invitationEmail } from "@/lib/email/templates";
import {
  footerFor,
  tripEmailContext,
  tryDeliver,
} from "@/lib/services/notifications";
import {
  createInvitation,
  InvitationError,
  resendInvitation,
  revokeInvitation,
} from "@/lib/services/invitations";
import {
  assignRoom,
  cancelPassenger,
  confirmPassenger,
  createRoom,
  PassengerStateError,
  setPassengerPaymentInstructions,
  setPassengerPriceOverride,
  updatePersonByCoordinator,
} from "@/lib/services/passengers";
import { personDraftSchema } from "@/lib/validation/person";

/**
 * Acciones del coordinador sobre pasajeros, invitaciones y habitaciones.
 *
 * Cáscaras finas sobre los servicios: validan la forma del input y traducen
 * los errores de negocio a un resultado. Ninguna decide permisos.
 */

export type ActionResult<T = void> =
  | ({ ok: true } & (T extends void ? { data?: undefined } : { data: T }))
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

function failure(error: string, fieldErrors?: Record<string, string[]>) {
  return { ok: false as const, error, ...(fieldErrors ? { fieldErrors } : {}) };
}

/**
 * ForbiddenError y UnauthorizedError se relanzan para que la página responda
 * 404: devolverlas como texto le confirmaría a quien prueba ids que el
 * recurso existe. Los errores de negocio sí vuelven como mensaje.
 */
async function run<T>(operation: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await operation();
    return { ok: true, data } as ActionResult<T>;
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof UnauthorizedError) {
      throw error;
    }
    if (
      error instanceof InvitationError ||
      error instanceof PassengerStateError
    ) {
      return failure(error.message);
    }
    console.error("[pasajeros] acción fallida", (error as Error).message);
    return failure("No se pudo completar la acción. Probá de nuevo.");
  }
}

function revalidate(tripId: string): void {
  revalidatePath(`/[locale]/viajes/${tripId}/pasajeros`, "page");
  revalidatePath(`/[locale]/viajes/${tripId}`, "page");
}

// --------------------------- Invitaciones ----------------------------------

const inviteSchema = z.object({
  email: z.email("Escribí un email válido, con arroba."),
  roomType: z.enum(["DOBLE", "SINGLE"]),
});

export interface InvitationCreated {
  email: string;
  url: string;
  expiresAt: string;
  /** false si el mail no salió: el link igual sirve para mandar a mano. */
  emailSent: boolean;
}

/**
 * Crea la invitación y manda el mail.
 *
 * El link vuelve SIEMPRE, salga o no el mail. En la práctica la vía principal
 * va a ser copiarlo y mandarlo por WhatsApp, así que un fallo del proveedor de
 * mail no puede dejar al coordinador sin nada.
 */
export async function inviteAction(
  tripId: string,
  input: unknown,
): Promise<ActionResult<InvitationCreated>> {
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) {
    const flattened = parsed.error.flatten();
    const fieldErrors = flattened.fieldErrors as Record<string, string[]>;
    return failure(
      Object.values(fieldErrors).flat()[0] ?? "Revisá los datos.",
      fieldErrors,
    );
  }

  const locale = await getLocale();

  const created = await run(() =>
    createInvitation(tripId, parsed.data.email, parsed.data.roomType, locale),
  );
  if (!created.ok) return created;

  const emailSent = await deliverInvitation(
    tripId,
    created.data.email,
    created.data.url,
    created.data.expiresAt,
    locale,
  );

  revalidate(tripId);

  return {
    ok: true,
    data: {
      email: created.data.email,
      url: created.data.url,
      expiresAt: created.data.expiresAt.toISOString(),
      emailSent,
    },
  };
}

export async function resendInvitationAction(
  tripId: string,
  invitationId: string,
): Promise<ActionResult<InvitationCreated>> {
  const locale = await getLocale();

  const created = await run(() => resendInvitation(invitationId, locale));
  if (!created.ok) return created;

  const emailSent = await deliverInvitation(
    tripId,
    created.data.email,
    created.data.url,
    created.data.expiresAt,
    locale,
  );

  revalidate(tripId);

  return {
    ok: true,
    data: {
      email: created.data.email,
      url: created.data.url,
      expiresAt: created.data.expiresAt.toISOString(),
      emailSent,
    },
  };
}

export async function revokeInvitationAction(
  tripId: string,
  invitationId: string,
): Promise<ActionResult> {
  const result = await run(() => revokeInvitation(invitationId));
  if (result.ok) revalidate(tripId);
  return result;
}

/**
 * Envía el mail de invitación. Nunca hace fallar la acción: si el proveedor
 * está caído, el coordinador todavía tiene el link para copiar.
 */
async function deliverInvitation(
  tripId: string,
  email: string,
  url: string,
  expiresAt: Date,
  locale: string,
): Promise<boolean> {
  try {
    const context = await tripEmailContext(tripId);

    // Único mail del sistema en el que el idioma NO sale de
    // `Person.preferredLanguage`: todavía no hay Person. Se usa el locale en
    // el que está navegando el coordinador, que es la mejor pista disponible,
    // y el pasajero elige el suyo en el primer paso del registro.
    const lang = locale === "en" ? "en" : "es";

    const rendered = invitationEmail(lang, {
      tripName: context.tripName,
      url,
      expiresAt,
      coordinatorName: context.replyTo?.name ?? null,
      footer: footerFor(context, lang),
    });

    return tryDeliver({ to: email, lang, rendered, context });
  } catch (error) {
    // No se loguea el destinatario: es un dato personal.
    console.error(
      "[pasajeros] no se pudo enviar la invitación",
      (error as Error).message,
    );
    return false;
  }
}

// ---------------------------- Pasajeros ------------------------------------

export async function confirmPassengerAction(
  tripId: string,
  passengerId: string,
): Promise<ActionResult> {
  const result = await run(() => confirmPassenger(passengerId));
  if (result.ok) revalidate(tripId);
  return result;
}

export async function cancelPassengerAction(
  tripId: string,
  passengerId: string,
): Promise<ActionResult> {
  const result = await run(() => cancelPassenger(passengerId));
  if (result.ok) revalidate(tripId);
  return result;
}

/**
 * Edición de los datos de un pasajero por el coordinador.
 *
 * Usa el schema de DRAFT, no el estricto: el coordinador suele corregir un
 * campo suelto de una ficha que todavía está incompleta, y exigirle que
 * complete todo lo demás para poder arreglar un número de pasaporte mal
 * tipeado no tendría sentido.
 */
export async function updatePassengerDataAction(
  tripId: string,
  passengerId: string,
  input: unknown,
): Promise<ActionResult<number>> {
  const parsed = personDraftSchema.safeParse(input);
  if (!parsed.success) return failure("Revisá los datos cargados.");

  const result = await run(() =>
    updatePersonByCoordinator(passengerId, parsed.data),
  );
  if (result.ok) revalidate(tripId);
  return result;
}

const priceOverrideSchema = z.object({
  priceOverride: z
    .string()
    .trim()
    .regex(/^\d{1,10}(\.\d{1,2})?$/, "Escribí un importe válido.")
    .nullable(),
  reason: z.string().trim().max(300).nullable(),
});

export async function setPriceOverrideAction(
  tripId: string,
  passengerId: string,
  input: unknown,
): Promise<ActionResult> {
  const parsed = priceOverrideSchema.safeParse(input);
  if (!parsed.success) {
    return failure(
      parsed.error.flatten().fieldErrors["priceOverride"]?.[0] ??
        "Revisá el importe.",
    );
  }

  const result = await run(() =>
    setPassengerPriceOverride(
      passengerId,
      parsed.data.priceOverride,
      parsed.data.reason,
    ),
  );
  if (result.ok) revalidate(tripId);
  return result;
}

// --------------------------- Habitaciones ----------------------------------

export async function createRoomAction(
  tripId: string,
  label: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = z
    .string()
    .trim()
    .min(1, "Poné un nombre o número de habitación.")
    .max(40)
    .safeParse(label);

  if (!parsed.success) {
    return failure(parsed.error.issues[0]?.message ?? "Revisá el nombre.");
  }

  const result = await run(() => createRoom(tripId, parsed.data));
  if (result.ok) revalidate(tripId);
  return result;
}

export async function assignRoomAction(
  tripId: string,
  passengerId: string,
  roomId: string | null,
): Promise<ActionResult> {
  const result = await run(() => assignRoom(passengerId, roomId));
  if (result.ok) revalidate(tripId);
  return result;
}

/**
 * Guarda las instrucciones de pago propias de una pasajera.
 *
 * `null` borra el override y devuelve la ficha al texto del viaje. Es
 * deliberadamente el mismo valor que "el campo quedó vacío": vacío significa
 * "usa el del viaje", no "no hay dónde pagar".
 */
export async function savePaymentInstructionsAction(
  passengerId: string,
  tripId: string,
  instructions: string | null,
): Promise<ActionResult> {
  if (instructions !== null && instructions.length > 3000) {
    return { ok: false, error: "Las instrucciones son demasiado largas." };
  }

  const result = await run(() =>
    setPassengerPaymentInstructions(passengerId, instructions),
  );
  if (result.ok) revalidate(tripId);
  return result;
}

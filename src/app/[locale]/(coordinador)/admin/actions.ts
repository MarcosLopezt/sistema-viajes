"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ForbiddenError, UnauthorizedError } from "@/lib/auth/errors";
import {
  assignTripMember,
  removeTripMember,
  setGlobalRole,
} from "@/lib/services/admin";

/**
 * Acciones del panel de administración.
 *
 * Cáscaras finas, como el resto: validan la forma del input y traducen
 * errores. La autorización entera vive en lib/services/admin.ts, donde cada
 * función abre con requireAdmin().
 */

export type ActionResult =
  | { ok: true }
  | { ok: false; error: string };

function failure(error: string): ActionResult {
  return { ok: false, error };
}

async function run(operation: () => Promise<void>): Promise<ActionResult> {
  try {
    await operation();
    return { ok: true };
  } catch (error) {
    // Se relanzan para que la página responda 404 en vez de confirmar que el
    // recurso existe. Mismo criterio que el resto de las acciones.
    if (error instanceof UnauthorizedError) throw error;
    if (error instanceof ForbiddenError) {
      // ForbiddenError acá sí lleva mensaje útil ("no podés cambiar tu propio
      // rol"): quien llegó hasta este panel ya es admin.
      return failure(error.message);
    }
    console.error("[admin] acción fallida", (error as Error).message);
    return failure("No se pudo completar la acción. Probá de nuevo.");
  }
}

function revalidate(): void {
  revalidatePath("/[locale]/admin", "page");
}

const uuid = z.uuid();

const roleSchema = z.object({
  userId: uuid,
  role: z.enum(["ADMIN", "USER"]),
});

export async function setGlobalRoleAction(input: unknown): Promise<ActionResult> {
  const parsed = roleSchema.safeParse(input);
  if (!parsed.success) return failure("Datos inválidos.");

  const result = await run(() =>
    setGlobalRole(parsed.data.userId, parsed.data.role),
  );
  if (result.ok) revalidate();
  return result;
}

const membershipSchema = z.object({
  tripId: uuid,
  userId: uuid,
  role: z.enum(["COORDINADOR", "PASAJERO"]),
});

export async function assignTripMemberAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = membershipSchema.safeParse(input);
  if (!parsed.success) return failure("Elegí un viaje y un rol.");

  const result = await run(() =>
    assignTripMember(parsed.data.tripId, parsed.data.userId, parsed.data.role),
  );
  if (result.ok) revalidate();
  return result;
}

const removalSchema = z.object({ tripId: uuid, userId: uuid });

export async function removeTripMemberAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = removalSchema.safeParse(input);
  if (!parsed.success) return failure("Datos inválidos.");

  const result = await run(() =>
    removeTripMember(parsed.data.tripId, parsed.data.userId),
  );
  if (result.ok) revalidate();
  return result;
}

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getLocale } from "next-intl/server";
import { ForbiddenError, UnauthorizedError } from "@/lib/auth/errors";
import { DepositError, submitDeposit } from "@/lib/services/deposits";
import {
  createSignedUploadForInterest,
  StorageError,
} from "@/lib/services/storage";
import { submitDepositSchema } from "@/lib/validation/deposit";

/**
 * Acciones de la interesada sobre su propia seña.
 *
 * Cáscaras finas, y con una particularidad que las hace más simples que las
 * del pasajero: **ninguna recibe un identificador**. Ni interestId, ni tripId,
 * ni personId. El servicio los resuelve enteros desde la sesión con
 * `requireInterestAccess()`, así que acá no hay nada que validar contra el
 * viewer — no hay forma de nombrar a otra persona.
 */

export type ActionResult<T = void> =
  | ({ ok: true } & (T extends void ? { data?: undefined } : { data: T }))
  | { ok: false; error: string };

function failure(error: string) {
  return { ok: false as const, error };
}

async function run<T>(operation: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await operation();
    return { ok: true, data } as ActionResult<T>;
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof UnauthorizedError) {
      throw error;
    }
    if (error instanceof StorageError || error instanceof DepositError) {
      return failure(error.message);
    }
    // El input trae el comprobante y el texto aceptado: no se loguea.
    console.error(
      "[mi-viaje] acción fallida",
      error instanceof Error ? error.message : "error desconocido",
    );
    return failure("No se pudo guardar. Probá de nuevo en un momento.");
  }
}

const uploadRequestSchema = z.object({
  contentType: z.string().min(1).max(120),
  size: z.number().int().positive(),
});

/**
 * Autoriza la subida del comprobante y devuelve la URL firmada.
 *
 * El archivo va DIRECTO del navegador al bucket. Lo que el cliente declara acá
 * —tipo y tamaño— se vuelve a verificar contra el objeto real en
 * `submitDeposit`, así que esto no es la validación sino apenas el permiso.
 */
export async function requestDepositUploadAction(
  input: unknown,
): Promise<ActionResult<{ path: string; token: string; bucket: string }>> {
  const parsed = uploadRequestSchema.safeParse(input);
  if (!parsed.success) return failure("No pudimos preparar la subida.");

  return run(() =>
    createSignedUploadForInterest(
      "comprobante-pago",
      parsed.data.contentType,
      parsed.data.size,
    ),
  );
}

/**
 * Guarda el comprobante y la aceptación de la condición, en un solo acto.
 *
 * El `acceptedTermsText` viaja desde el cliente y el servidor NO le cree: lo
 * compara contra el texto vigente del viaje. Está en el input para poder
 * detectar el caso en que las coordinadoras editaron la condición mientras
 * ella tenía el formulario abierto.
 */
export async function submitDepositAction(
  input: unknown,
): Promise<ActionResult<{ depositId: string }>> {
  const parsed = submitDepositSchema.safeParse(input);

  if (!parsed.success) {
    const first = Object.values(
      parsed.error.flatten().fieldErrors as Record<string, string[]>,
    )[0]?.[0];
    return failure(first ?? "Revisá los datos del formulario.");
  }

  const locale = await getLocale();

  const result = await run(() => submitDeposit(parsed.data, locale));
  if (result.ok) revalidatePath("/[locale]/mi-viaje", "page");
  return result;
}

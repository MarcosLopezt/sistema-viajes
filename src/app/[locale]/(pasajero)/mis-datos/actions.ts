"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ForbiddenError, UnauthorizedError } from "@/lib/auth/errors";
import {
  attachMedicalFile,
  finalizeRegistration,
  PassengerStateError,
  savePersonDraft,
  setPassengerRoomType,
} from "@/lib/services/passengers";
import {
  createSignedDownloadUrl,
  createSignedUpload,
  StorageError,
} from "@/lib/services/storage";
import { personDraftSchema, personStrictSchema } from "@/lib/validation/person";

/**
 * Acciones del pasajero sobre sus propios datos.
 *
 * Ninguna recibe un identificador de identidad del cliente: el `passengerId`
 * que llega es el del RECURSO, y `requirePassengerAccess` —dentro del
 * servicio— lo valida contra la sesión.
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
    if (error instanceof StorageError || error instanceof PassengerStateError) {
      return failure(error.message);
    }
    console.error("[mis-datos] acción fallida", (error as Error).message);
    return failure("No se pudo guardar. Probá de nuevo en un momento.");
  }
}

// --------------------------- Autoguardado ----------------------------------

/**
 * Autoguardado. Usa `personDraftSchema`, que acepta datos parciales,
 * incompletos y mal formados.
 *
 * Esto NO es un descuido: es la diferencia entre un formulario que se puede
 * abandonar a la mitad y uno que hace perder todo. Si acá se usara el schema
 * estricto, escribir "ana@" en el campo de mail haría fallar el guardado del
 * paso entero, en silencio, y al volver no estaría nada.
 *
 * La validación de verdad corre en `finishRegistrationAction`.
 */
export async function saveDraftAction(
  passengerId: string,
  input: unknown,
): Promise<ActionResult> {
  const parsed = personDraftSchema.safeParse(input);

  // Ni siquiera esto debería fallar: el draft solo recorta y acota longitudes.
  // Si falla es que llegó algo que no es un objeto de datos personales.
  if (!parsed.success) {
    return failure("No pudimos guardar lo que cargaste. Probá de nuevo.");
  }

  const result = await run(() => savePersonDraft(passengerId, parsed.data));
  if (result.ok) revalidatePath("/[locale]/mis-datos", "page");
  return result;
}

/**
 * Finaliza el registro. ACÁ SÍ corre la validación estricta.
 *
 * Devuelve los errores por campo para que el formulario pueda mandar al
 * pasajero al paso donde falta algo, con el mensaje al lado del campo.
 */
export async function finishRegistrationAction(
  passengerId: string,
  input: unknown,
): Promise<ActionResult> {
  const parsed = personStrictSchema.safeParse(input);

  if (!parsed.success) {
    const flattened = parsed.error.flatten();
    const fieldErrors = flattened.fieldErrors as Record<string, string[]>;
    return failure(
      Object.values(fieldErrors).flat()[0] ?? "Todavía faltan datos.",
      fieldErrors,
    );
  }

  const result = await run(() => finalizeRegistration(passengerId));
  if (result.ok) {
    revalidatePath("/[locale]/mis-datos", "page");
    revalidatePath("/[locale]/inicio", "page");
  }
  return result;
}

// --------------------------- Tipo de habitación -----------------------------

const roomTypeSchema = z.enum(["DOBLE", "SINGLE"]);

/**
 * Elige o cambia el tipo de habitación. Antes de CONFIRMADO es suyo para
 * tocar; después, `setPassengerRoomType` la rechaza — a partir de ahí es
 * exclusivo de la coordinadora, desde la ficha.
 */
export async function setRoomTypeAction(
  passengerId: string,
  roomType: unknown,
): Promise<ActionResult> {
  const parsed = roomTypeSchema.safeParse(roomType);
  if (!parsed.success) return failure("Elegí el tipo de habitación.");

  const result = await run(() => setPassengerRoomType(passengerId, parsed.data));
  if (result.ok) revalidatePath("/[locale]/mis-datos", "page");
  return result;
}

// ------------------------------ Archivos -----------------------------------

const uploadRequestSchema = z.object({
  contentType: z.string().min(1),
  size: z.number().int().positive(),
});

/**
 * Autoriza una subida y devuelve el token firmado.
 *
 * El navegador sube DIRECTO al bucket con este token: el archivo no pasa por
 * el servidor, que en Vercel chocaría con el límite de body y el timeout.
 */
export async function requestUploadAction(
  passengerId: string,
  input: unknown,
): Promise<ActionResult<{ path: string; token: string; bucket: string }>> {
  const parsed = uploadRequestSchema.safeParse(input);
  if (!parsed.success) return failure("Archivo inválido.");

  return run(() =>
    createSignedUpload(
      passengerId,
      "cobertura-medica",
      parsed.data.contentType,
      parsed.data.size,
    ),
  );
}

/**
 * Confirma la subida y guarda la path.
 *
 * `attachMedicalFile` consulta el objeto real en el bucket para verificar
 * tipo y tamaño: lo que declaró el cliente al pedir el token no alcanza.
 */
export async function confirmUploadAction(
  passengerId: string,
  path: unknown,
): Promise<ActionResult> {
  const parsed = z.string().min(1).max(500).safeParse(path);
  if (!parsed.success) return failure("Archivo inválido.");

  const result = await run(() =>
    attachMedicalFile(passengerId, parsed.data),
  );
  if (result.ok) revalidatePath("/[locale]/mis-datos", "page");
  return result;
}

/** URL temporal para ver el archivo cargado. Vence en un minuto. */
export async function getFileUrlAction(
  passengerId: string,
  path: unknown,
): Promise<ActionResult<string>> {
  const parsed = z.string().min(1).max(500).safeParse(path);
  if (!parsed.success) return failure("Archivo inválido.");

  return run(() => createSignedDownloadUrl(passengerId, parsed.data));
}

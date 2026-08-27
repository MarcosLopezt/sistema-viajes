"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ForbiddenError, UnauthorizedError } from "@/lib/auth/errors";
import { declarePayment, PaymentError } from "@/lib/services/payments";
import { createSignedUpload, StorageError } from "@/lib/services/storage";
import { declarePaymentSchema } from "@/lib/validation/payment";

/**
 * Acciones del pasajero sobre sus propios pagos.
 *
 * Cáscara fina: valida la forma del input y traduce errores. La autorización
 * está en el servicio, y el `passengerId` que llega es el del RECURSO —el
 * viewer sale de la sesión, nunca del cliente—.
 */

export type ActionResult<T = void> =
  | ({ ok: true } & (T extends void ? { data?: undefined } : { data: T }))
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

function failure(error: string, fieldErrors?: Record<string, string[]>) {
  return { ok: false as const, error, ...(fieldErrors ? { fieldErrors } : {}) };
}

/**
 * Las de autorización se relanzan para que la página responda 404: devolverlas
 * como texto le confirmaría a quien prueba ids que el recurso existe.
 */
async function run<T>(operation: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await operation();
    return { ok: true, data } as ActionResult<T>;
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof UnauthorizedError) {
      throw error;
    }
    if (error instanceof PaymentError || error instanceof StorageError) {
      return failure(error.message);
    }
    console.error("[mis-pagos] acción fallida", (error as Error).message);
    return failure("No se pudo enviar el comprobante. Probá de nuevo.");
  }
}

const uploadRequestSchema = z.object({
  contentType: z.string().min(1),
  size: z.number().int().positive(),
});

/**
 * Autoriza la subida del comprobante y devuelve el token firmado.
 *
 * Mismo circuito que el certificado médico de la fase 3: el archivo va DIRECTO
 * del navegador al bucket. El servidor decide la path (el cliente no elige
 * dónde escribe) y verifica el objeto real después de subido.
 */
export async function requestProofUploadAction(
  passengerId: string,
  input: unknown,
): Promise<ActionResult<{ path: string; token: string; bucket: string }>> {
  const parsed = uploadRequestSchema.safeParse(input);
  if (!parsed.success) return failure("Archivo inválido.");

  return run(() =>
    createSignedUpload(
      passengerId,
      "comprobante-pago",
      parsed.data.contentType,
      parsed.data.size,
    ),
  );
}

/** Informa la transferencia. El estado inicial del pago es EN_REVISION. */
export async function declarePaymentAction(
  passengerId: string,
  input: unknown,
): Promise<ActionResult<{ paymentId: string }>> {
  const parsed = declarePaymentSchema.safeParse(input);

  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors as Record<
      string,
      string[]
    >;
    return failure(
      Object.values(fieldErrors).flat()[0] ?? "Revisá los datos del pago.",
      fieldErrors,
    );
  }

  const result = await run(() => declarePayment(passengerId, parsed.data));

  if (result.ok) {
    revalidatePath("/[locale]/mis-pagos", "page");
    revalidatePath("/[locale]/inicio", "page");
  }
  return result;
}

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ForbiddenError, UnauthorizedError } from "@/lib/auth/errors";
import { PaymentPlanError } from "@/lib/domain/payments";
import {
  confirmPayment,
  generatePaymentPlan,
  previewPaymentPlan,
  registerRefund,
  rejectPayment,
  revertPayment,
  PaymentError,
  type PlanPreview,
  type ReviewOutcome,
} from "@/lib/services/payments";
import {
  confirmPaymentSchema,
  paymentPlanSchema,
  refundSchema,
  rejectPaymentSchema,
  revertPaymentSchema,
} from "@/lib/validation/payment";

/**
 * Acciones del coordinador sobre pagos.
 *
 * Cáscaras finas: validan la forma del input y traducen los errores de
 * negocio. Ninguna decide permisos ni calcula plata — eso vive en el servicio
 * y en el dominio.
 */

export type ActionResult<T = void> =
  | ({ ok: true } & (T extends void ? { data?: undefined } : { data: T }))
  | {
      ok: false;
      error: string;
      /** Discrimina el caso "ya existe un plan" para pedir confirmación. */
      reason?: string;
      installmentsAtRisk?: number;
    };

function failure(
  error: string,
  extra?: { reason?: string; installmentsAtRisk?: number },
) {
  return { ok: false as const, error, ...extra };
}

async function run<T>(operation: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await operation();
    return { ok: true, data } as ActionResult<T>;
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof UnauthorizedError) {
      throw error;
    }
    if (error instanceof PaymentError) {
      return failure(error.message, {
        reason: error.reason,
        ...(error.installmentsAtRisk !== undefined
          ? { installmentsAtRisk: error.installmentsAtRisk }
          : {}),
      });
    }
    if (error instanceof PaymentPlanError) {
      return failure(error.message, { reason: error.reason });
    }
    console.error("[pagos] acción fallida", (error as Error).message);
    return failure("No se pudo completar la acción. Probá de nuevo.");
  }
}

function revalidate(tripId: string, passengerId?: string): void {
  revalidatePath(`/[locale]/viajes/${tripId}/pagos`, "page");
  revalidatePath(`/[locale]/viajes/${tripId}`, "page");
  if (passengerId) {
    revalidatePath(`/[locale]/viajes/${tripId}/pagos/${passengerId}`, "page");
  }
}

// ----------------------------- Plan de pagos -------------------------------

const countSchema = z.number().int().min(1).max(6);

/** Propuesta de cuotas. No escribe nada: alimenta la pantalla previa. */
export async function previewPlanAction(
  passengerId: string,
  installmentCount: unknown,
): Promise<ActionResult<PlanPreview>> {
  const parsed = countSchema.safeParse(installmentCount);
  if (!parsed.success) return failure("Elegí entre 1 y 6 cuotas.");

  return run(() => previewPaymentPlan(passengerId, parsed.data));
}

/**
 * Guarda el plan.
 *
 * Los IMPORTES que manda el cliente se ignoran: el servicio los recalcula. Lo
 * que sí se respeta son las fechas, que son la parte que el coordinador
 * decide. Si los importes vinieran del formulario, un cliente manipulado
 * podría armar un plan cuyas cuotas no suman el total.
 */
export async function generatePlanAction(
  tripId: string,
  passengerId: string,
  input: unknown,
): Promise<ActionResult<{ planId: string; replaced: boolean }>> {
  const parsed = paymentPlanSchema.safeParse(input);
  if (!parsed.success) {
    return failure(
      parsed.error.issues[0]?.message ?? "Revisá las cuotas cargadas.",
    );
  }

  const result = await run(() => generatePaymentPlan(passengerId, parsed.data));
  if (result.ok) revalidate(tripId, passengerId);
  return result;
}

// ------------------------------- Revisión ----------------------------------

/**
 * Confirma un pago.
 *
 * Devuelve `YA_RESUELTO` —no un error— si otro coordinador llegó primero: el
 * resultado que el usuario quería ya está, y tratarlo como falla sería mentir.
 */
export async function confirmPaymentAction(
  tripId: string,
  input: unknown,
): Promise<ActionResult<ReviewOutcome>> {
  const parsed = confirmPaymentSchema.safeParse(input);
  if (!parsed.success) {
    return failure(
      parsed.error.issues[0]?.message ?? "Revisá los datos de la confirmación.",
    );
  }

  const result = await run(() => confirmPayment(parsed.data));
  if (result.ok) revalidate(tripId);
  return result;
}

export async function rejectPaymentAction(
  tripId: string,
  input: unknown,
): Promise<ActionResult<ReviewOutcome>> {
  const parsed = rejectPaymentSchema.safeParse(input);
  if (!parsed.success) {
    return failure(parsed.error.issues[0]?.message ?? "Escribí el motivo.");
  }

  const result = await run(() => rejectPayment(parsed.data));
  if (result.ok) revalidate(tripId);
  return result;
}

/** Deshace una confirmación hecha por error. Motivo obligatorio + AuditLog. */
export async function revertPaymentAction(
  tripId: string,
  passengerId: string,
  input: unknown,
): Promise<ActionResult<ReviewOutcome>> {
  const parsed = revertPaymentSchema.safeParse(input);
  if (!parsed.success) {
    return failure(parsed.error.issues[0]?.message ?? "Escribí el motivo.");
  }

  const result = await run(() => revertPayment(parsed.data));
  if (result.ok) revalidate(tripId, passengerId);
  return result;
}

// ------------------------------ Reembolso ----------------------------------

export async function registerRefundAction(
  tripId: string,
  passengerId: string,
  input: unknown,
): Promise<ActionResult<{ paymentId: string }>> {
  const parsed = refundSchema.safeParse(input);
  if (!parsed.success) {
    return failure(
      parsed.error.issues[0]?.message ?? "Revisá los datos del reembolso.",
    );
  }

  const result = await run(() => registerRefund(passengerId, parsed.data));
  if (result.ok) revalidate(tripId, passengerId);
  return result;
}

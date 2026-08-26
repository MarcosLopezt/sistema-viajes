"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { ForbiddenError, UnauthorizedError } from "@/lib/auth/errors";
import {
  createTripDraft,
  deleteAccommodation,
  deleteDirectCost,
  deleteIndirectCost,
  deleteItineraryStop,
  setTripPrices,
  TripStateError,
  updateTripGeneral,
  updateTripStatus,
  upsertAccommodation,
  upsertDirectCost,
  upsertIndirectCost,
  upsertItineraryStop,
} from "@/lib/services/trip";
import {
  accommodationSchema,
  directCostSchema,
  indirectCostSchema,
  itineraryStopSchema,
  tripGeneralSchema,
  tripPricesSchema,
  tripStatusSchema,
} from "@/lib/validation/trip";
import type { ZodType } from "zod";

/**
 * Server Actions del módulo de presupuesto.
 *
 * Son cáscaras finas: validan con Zod y delegan en src/lib/services/trip.ts.
 * Ninguna decisión de negocio ni de autorización vive acá.
 *
 * TODA acción revalida el input en el servidor aunque el formulario ya lo haya
 * validado en el cliente. El cliente valida para dar feedback inmediato; el
 * servidor valida porque el cliente no es confiable.
 */

export type ActionResult<T = void> =
  | ({ ok: true } & (T extends void ? { data?: undefined } : { data: T }))
  | {
      ok: false;
      /** Mensaje ya legible: los schemas traen el texto humano. */
      error: string;
      fieldErrors?: Record<string, string[]>;
    };

function failure(error: string, fieldErrors?: Record<string, string[]>) {
  return { ok: false as const, error, ...(fieldErrors ? { fieldErrors } : {}) };
}

/**
 * Valida contra un schema y traduce el fallo a un resultado, no a una
 * excepción: un error de validación es una respuesta esperable del formulario.
 */
function parse<T>(
  schema: ZodType<T>,
  input: unknown,
): { ok: true; data: T } | ReturnType<typeof failure> {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };

  const flattened = result.error.flatten();
  // El tipo de `fieldErrors` que infiere Zod depende del schema y para los
  // schemas con `.refine()` encima queda como un mapa de claves desconocidas.
  // Se acota acá, en un solo lugar, en vez de castear en cada acción.
  const fieldErrors = flattened.fieldErrors as Record<string, string[]>;

  // Se muestra el PRIMER error, no todos: un formulario que escupe ocho
  // mensajes a la vez no se lee. El resto vuelve en `fieldErrors` para que
  // cada campo pinte el suyo al lado.
  const first =
    Object.values(fieldErrors).flat()[0] ??
    flattened.formErrors[0] ??
    "Revisá los datos cargados.";

  return failure(first, fieldErrors);
}

/**
 * Traduce las excepciones de la capa de servicios a un resultado.
 *
 * ForbiddenError y UnauthorizedError NO se convierten en un mensaje amable:
 * se relanzan para que las capture el error boundary y la página responda 404.
 * Devolverlas como texto en el formulario le confirmaría a quien está
 * probando ids que el recurso existe.
 */
async function run<T>(operation: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await operation();
    return { ok: true, data } as ActionResult<T>;
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof UnauthorizedError) {
      throw error;
    }
    if (error instanceof TripStateError) {
      return failure(error.message);
    }
    console.error("[viajes] acción fallida", (error as Error).message);
    return failure("No se pudo guardar. Probá de nuevo en un momento.");
  }
}

function revalidateTrip(tripId: string): void {
  revalidatePath(`/[locale]/viajes/${tripId}`, "page");
  revalidatePath(`/[locale]/viajes/${tripId}/presupuesto`, "page");
  revalidatePath("/[locale]/viajes", "page");
}

// ------------------------------- Alta --------------------------------------

export async function createTripAction(
  _prev: ActionResult<{ id: string }> | undefined,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const parsed = parse(tripGeneralSchema, {
    name: formData.get("name"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    currency: formData.get("currency"),
    minPassengers: formData.get("minPassengers"),
    maxPassengers: formData.get("maxPassengers"),
    budgetedPassengers: formData.get("budgetedPassengers"),
    coordinatorCount: formData.get("coordinatorCount"),
    passportValidityMonths: formData.get("passportValidityMonths"),
    requireFullPassportValidity:
      formData.get("requireFullPassportValidity") === "on",
  });

  if (!parsed.ok) return parsed;

  const created = await run(() => createTripDraft(parsed.data));
  if (!created.ok) return created;

  revalidatePath("/[locale]/viajes", "page");
  redirect({
    href: `/viajes/${created.data.id}/presupuesto?paso=2`,
    locale: await getLocale(),
  });
}

// ------------------------------ Wizard -------------------------------------

export async function saveGeneralAction(
  tripId: string,
  input: unknown,
): Promise<ActionResult> {
  const parsed = parse(tripGeneralSchema, input);
  if (!parsed.ok) return parsed;

  const result = await run(() => updateTripGeneral(tripId, parsed.data));
  if (result.ok) revalidateTrip(tripId);
  return result;
}

export async function saveStopAction(
  tripId: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = parse(itineraryStopSchema, input);
  if (!parsed.ok) return parsed;

  const result = await run(() => upsertItineraryStop(tripId, parsed.data));
  if (result.ok) revalidateTrip(tripId);
  return result;
}

export async function deleteStopAction(
  tripId: string,
  stopId: string,
): Promise<ActionResult> {
  const result = await run(() => deleteItineraryStop(tripId, stopId));
  if (result.ok) revalidateTrip(tripId);
  return result;
}

export async function saveAccommodationAction(
  tripId: string,
  stopId: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = parse(accommodationSchema, input);
  if (!parsed.ok) return parsed;

  const result = await run(() =>
    upsertAccommodation(tripId, stopId, parsed.data),
  );
  if (result.ok) revalidateTrip(tripId);
  return result;
}

export async function deleteAccommodationAction(
  tripId: string,
  accommodationId: string,
): Promise<ActionResult> {
  const result = await run(() => deleteAccommodation(tripId, accommodationId));
  if (result.ok) revalidateTrip(tripId);
  return result;
}

export async function saveDirectCostAction(
  tripId: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = parse(directCostSchema, input);
  if (!parsed.ok) return parsed;

  const result = await run(() => upsertDirectCost(tripId, parsed.data));
  if (result.ok) revalidateTrip(tripId);
  return result;
}

export async function deleteDirectCostAction(
  tripId: string,
  costId: string,
): Promise<ActionResult> {
  const result = await run(() => deleteDirectCost(tripId, costId));
  if (result.ok) revalidateTrip(tripId);
  return result;
}

export async function saveIndirectCostAction(
  tripId: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = parse(indirectCostSchema, input);
  if (!parsed.ok) return parsed;

  const result = await run(() => upsertIndirectCost(tripId, parsed.data));
  if (result.ok) revalidateTrip(tripId);
  return result;
}

export async function deleteIndirectCostAction(
  tripId: string,
  costId: string,
): Promise<ActionResult> {
  const result = await run(() => deleteIndirectCost(tripId, costId));
  if (result.ok) revalidateTrip(tripId);
  return result;
}

export async function savePricesAction(
  tripId: string,
  input: unknown,
): Promise<ActionResult> {
  const parsed = parse(tripPricesSchema, input);
  if (!parsed.ok) return parsed;

  const result = await run(() => setTripPrices(tripId, parsed.data));
  if (result.ok) revalidateTrip(tripId);
  return result;
}

export async function changeStatusAction(
  tripId: string,
  status: unknown,
): Promise<ActionResult> {
  const parsed = parse(tripStatusSchema, status);
  if (!parsed.ok) return parsed;

  const result = await run(() => updateTripStatus(tripId, parsed.data));
  if (result.ok) revalidateTrip(tripId);
  return result;
}

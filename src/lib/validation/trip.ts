import { z } from "zod";

/**
 * Validación del módulo de presupuesto.
 *
 * Estos schemas son la ÚNICA definición de qué es un dato válido, y se usan
 * en los dos lados: el formulario del cliente los aplica para dar feedback
 * inmediato, y la Server Action los vuelve a aplicar porque el cliente no es
 * confiable. Al compartirse, el mensaje humano ("el precio de la single no
 * puede ser menor…") se escribe una sola vez.
 *
 * Los montos viajan como STRING, nunca como number. Un `number` de JavaScript
 * no representa exactamente 95.10, y estos valores terminan multiplicados por
 * cantidades de noches y divididos entre pasajeros.
 */

/** Hasta 2 decimales, sin signo. Acepta "95", "95.1" y "95.10". */
const MONEY_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

const money = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `Ingresá ${label}.`)
    .regex(
      MONEY_PATTERN,
      `${label} tiene que ser un número con hasta dos decimales, sin símbolo de moneda.`,
    );

/** Fecha de negocio en formato ISO (lo que emite un <input type="date">). */
const isoDate = (label: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `Elegí ${label}.`)
    .refine(
      (value) => !Number.isNaN(new Date(`${value}T00:00:00.000Z`).getTime()),
      `${label} no es una fecha válida.`,
    );

export const currencySchema = z.enum(["GBP", "USD", "EUR"]);
export const tripStatusSchema = z.enum([
  "BORRADOR",
  "ABIERTO",
  "CERRADO",
  "FINALIZADO",
]);

// ------------------------- Paso 1 · datos generales ------------------------

export const tripGeneralSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(3, "Poné un nombre de al menos 3 caracteres.")
      .max(120, "El nombre es demasiado largo."),
    startDate: isoDate("la fecha de salida"),
    endDate: isoDate("la fecha de regreso"),
    currency: currencySchema,
    minPassengers: z.coerce
      .number()
      .int("Tiene que ser un número entero.")
      .min(1, "Como mínimo 1 pasajero."),
    maxPassengers: z.coerce
      .number()
      .int("Tiene que ser un número entero.")
      .min(1, "Como mínimo 1 pasajero."),
    budgetedPassengers: z.coerce
      .number()
      .int("Tiene que ser un número entero.")
      .min(1, "Como mínimo 1 pasajero."),
    coordinatorCount: z.coerce
      .number()
      .int("Tiene que ser un número entero.")
      .min(0, "No puede ser negativo."),
    passportValidityMonths: z.coerce
      .number()
      .int("Tiene que ser un número entero.")
      .min(0)
      .max(24),
    requireFullPassportValidity: z.boolean(),
  })
  .refine((data) => data.endDate >= data.startDate, {
    message: "El regreso no puede ser anterior a la salida.",
    path: ["endDate"],
  })
  .refine((data) => data.maxPassengers >= data.minPassengers, {
    message: "El máximo no puede ser menor que el mínimo.",
    path: ["maxPassengers"],
  })
  .refine((data) => data.budgetedPassengers <= data.maxPassengers, {
    message:
      "No podés presupuestar más pasajeros de los que entran en el viaje.",
    path: ["budgetedPassengers"],
  });

export type TripGeneralInput = z.infer<typeof tripGeneralSchema>;

// --------------------- Paso 2 · itinerario y hospedajes --------------------

export const accommodationSchema = z
  .object({
    id: z.uuid().optional(),
    hotelName: z.string().trim().min(1, "Poné el nombre del hotel."),
    nights: z.coerce
      .number()
      .int("Tiene que ser un número entero de noches.")
      .min(1, "Como mínimo 1 noche."),
    pricePerNightDouble: money("el precio por noche en habitación compartida"),
    pricePerNightSingle: money("el precio por noche en habitación individual"),
    notes: z.string().trim().max(500).optional().nullable(),
  })
  .refine(
    (data) =>
      Number(data.pricePerNightSingle) >= Number(data.pricePerNightDouble),
    {
      // La habitación individual la paga una sola persona; la doble se
      // reparte entre dos. Por persona, la single nunca puede salir menos.
      // Casi siempre que pasa es que se cargaron los dos precios cruzados.
      message:
        "El precio de la individual no puede ser menor que el de la compartida. ¿Los cargaste al revés?",
      path: ["pricePerNightSingle"],
    },
  );

export const itineraryStopSchema = z
  .object({
    id: z.uuid().optional(),
    order: z.coerce.number().int().min(1),
    city: z.string().trim().min(1, "Poné la ciudad."),
    country: z.string().trim().min(1, "Poné el país."),
    fromDate: isoDate("la fecha de llegada"),
    toDate: isoDate("la fecha de salida"),
    notes: z.string().trim().max(500).optional().nullable(),
    accommodations: z.array(accommodationSchema).default([]),
  })
  .refine((data) => data.toDate >= data.fromDate, {
    message: "La salida no puede ser anterior a la llegada.",
    path: ["toDate"],
  });

export type ItineraryStopInput = z.infer<typeof itineraryStopSchema>;
export type AccommodationInput = z.infer<typeof accommodationSchema>;

// ---------------------- Paso 3 · comidas y eventos -------------------------

export const directCostSchema = z.object({
  id: z.uuid().optional(),
  stopId: z.uuid().optional().nullable(),
  concept: z.string().trim().min(1, "Poné un concepto."),
  amountPerPassenger: money("el importe por pasajero"),
  type: z.enum(["COMIDA", "EVENTO", "TRANSPORTE", "OTRO"]),
});

export type DirectCostInput = z.infer<typeof directCostSchema>;

// ---------------------- Paso 4 · costos indirectos -------------------------

export const indirectCostSchema = z.object({
  id: z.uuid().optional(),
  concept: z.string().trim().min(1, "Poné un concepto."),
  totalAmount: money("el importe total"),
  type: z.enum(["CHARTER", "TRANSFER", "HOSPEDAJE_COORDINADOR", "OTRO"]),
});

export type IndirectCostInput = z.infer<typeof indirectCostSchema>;

// ------------------------- Paso 5 · precios --------------------------------

export const tripPricesSchema = z.object({
  priceDouble: money("el precio en habitación compartida"),
  priceSingle: money("el precio en habitación individual"),
});

export type TripPricesInput = z.infer<typeof tripPricesSchema>;

// --------------------------------- Utilidades ------------------------------

/** Convierte "2027-05-10" en un Date a medianoche UTC, como guarda `@db.Date`. */
export function toBusinessDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/** Inversa de `toBusinessDate`, para precargar un <input type="date">. */
export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

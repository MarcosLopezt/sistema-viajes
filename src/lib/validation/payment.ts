import { z } from "zod";
import { isRealIsoDate } from "./date";
import { MAX_INSTALLMENTS, MIN_INSTALLMENTS } from "@/lib/domain/payments";

/**
 * Validación del módulo de pagos.
 *
 * Mismo criterio que en el presupuesto: los schemas son la única definición de
 * qué es un dato válido y corren en los dos lados. Los montos viajan como
 * STRING —nunca `number`— porque un float de JavaScript no representa
 * exactamente 1330.43, y estos valores son plata que después se suma y se
 * compara contra el monto de una cuota.
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
    )
    .refine((v) => Number(v) > 0, `${label} tiene que ser mayor a cero.`);

const isoDate = (label: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `Elegí ${label}.`)
    .refine(isRealIsoDate, `${label} no es una fecha válida.`);

export const currencySchema = z.enum(["GBP", "USD", "EUR"]);

/**
 * Motivo obligatorio.
 *
 * Se exige en el rechazo de un pago y en la reversión de una confirmación: en
 * los dos casos alguien del otro lado se entera de que pasó algo raro con su
 * plata, y "rechazado" sin explicación no es información, es una molestia.
 */
const reason = z
  .string()
  .trim()
  .min(5, "Escribí el motivo: el pasajero lo va a leer.")
  .max(500, "El motivo es demasiado largo.");

// ------------------------- Generación del plan -----------------------------

export const installmentDraftSchema = z.object({
  number: z.number().int().min(1).max(MAX_INSTALLMENTS),
  dueDate: isoDate("el vencimiento de la cuota"),
  amount: money("el importe de la cuota"),
});

export type InstallmentDraftInput = z.infer<typeof installmentDraftSchema>;

export const paymentPlanSchema = z
  .object({
    installmentCount: z
      .number()
      .int()
      .min(MIN_INSTALLMENTS, `El plan tiene que tener al menos ${MIN_INSTALLMENTS} cuota.`)
      .max(MAX_INSTALLMENTS, `El plan no puede tener más de ${MAX_INSTALLMENTS} cuotas.`),
    installments: z.array(installmentDraftSchema).min(1).max(MAX_INSTALLMENTS),
    /** Confirmación explícita para reemplazar un plan que ya existe. */
    replaceExisting: z.boolean().default(false),
  })
  .refine((v) => v.installments.length === v.installmentCount, {
    message: "La cantidad de cuotas no coincide con las cuotas cargadas.",
    path: ["installments"],
  })
  .refine(
    (v) =>
      v.installments.every((cuota, index) => cuota.number === index + 1),
    {
      message: "Las cuotas tienen que estar numeradas de 1 en adelante.",
      path: ["installments"],
    },
  );

export type PaymentPlanInput = z.infer<typeof paymentPlanSchema>;

// --------------------------- Carga de un pago ------------------------------

/**
 * Lo que declara el pasajero. Fijate qué NO está acá: el tipo de cambio.
 *
 * El pasajero no tiene por qué saber a qué cotización le liquidó el banco, y
 * si se lo preguntáramos escribiría la de Google, que no es la que salió de su
 * cuenta. El TC real lo carga el coordinador al revisar, mirando el extracto.
 */
export const declarePaymentSchema = z.object({
  installmentId: z.uuid("Elegí a qué cuota corresponde el pago."),
  amount: money("el importe que transferiste"),
  currency: currencySchema,
  transferDate: isoDate("la fecha de la transferencia"),
  /** Path del comprobante ya subido al bucket. */
  proofFileId: z
    .string()
    .trim()
    .min(1, "Subí el comprobante de la transferencia.")
    .max(500),
});

export type DeclarePaymentInput = z.infer<typeof declarePaymentSchema>;

// ------------------------------- Revisión ----------------------------------

/** Tipo de cambio: hasta 8 decimales, como la columna. */
const FX_PATTERN = /^\d{1,10}(\.\d{1,8})?$/;

export const confirmPaymentSchema = z.object({
  paymentId: z.uuid(),
  /**
   * TC real del extracto. Obligatorio solo si la moneda del pago difiere de
   * la del viaje; el servicio lo verifica contra la moneda real, no contra lo
   * que diga el cliente.
   */
  fxRateUsed: z
    .string()
    .trim()
    .regex(FX_PATTERN, "El tipo de cambio tiene hasta 8 decimales.")
    .refine((v) => Number(v) > 0, "El tipo de cambio tiene que ser mayor a cero.")
    .nullable()
    .default(null),
  /**
   * De dónde salió ese TC.
   *
   * Es PROCEDENCIA, no un control: solo el formulario sabe si el coordinador
   * tocó el campo o confirmó dejando la sugerencia, y el servidor no tiene
   * forma de verificarlo (tipear exactamente la cotización sugerida es
   * legítimo). Por eso el default es SUGERIDO: la afirmación fuerte —"esto lo
   * saqué del extracto"— tiene que declararse explícitamente, no asumirse.
   *
   * Lo que el servidor SÍ decide es que sea `null` cuando no hubo conversión.
   */
  fxRateSource: z.enum(["SUGERIDO", "INGRESADO"]).default("SUGERIDO"),
  notes: z.string().trim().max(500).nullable().default(null),
});

export type ConfirmPaymentInput = z.infer<typeof confirmPaymentSchema>;

export const rejectPaymentSchema = z.object({
  paymentId: z.uuid(),
  reason,
});

export type RejectPaymentInput = z.infer<typeof rejectPaymentSchema>;

/**
 * Reversión de una confirmación hecha por error.
 *
 * Decisión tomada: el coordinador PUEDE deshacerla, con motivo obligatorio y
 * AuditLog. La alternativa purista —compensar con un asiento inverso— es más
 * limpia contablemente, pero le pide a alguien que apretó el botón equivocado
 * que entienda partida doble para arreglarlo.
 */
export const revertPaymentSchema = z.object({
  paymentId: z.uuid(),
  reason,
});

export type RevertPaymentInput = z.infer<typeof revertPaymentSchema>;

// ------------------------------- Reembolso ---------------------------------

export const refundSchema = z.object({
  amount: money("el importe del reembolso"),
  transferDate: isoDate("la fecha del reembolso"),
  reason,
});

export type RefundInput = z.infer<typeof refundSchema>;

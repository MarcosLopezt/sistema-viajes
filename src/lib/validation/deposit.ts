import { z } from "zod";
import { isRealIsoDate } from "@/lib/domain/date";
import { currencySchema } from "./payment";

/**
 * Validación de la seña.
 *
 * Mismo criterio que el resto del módulo de pagos: los montos viajan como
 * STRING y nunca como `number`, porque un float no representa exactamente
 * 500.10 y esto es plata que después se imputa a una cuota.
 */

const MONEY_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

/**
 * Lo que manda la interesada al subir el comprobante de su seña.
 *
 * ── Fijate qué NO está acá ────────────────────────────────────────────────
 *
 * Ni el interestId, ni el tripId, ni el personId. Los tres salen de la sesión
 * en `requireInterestAccess()`. Que no estén en el schema no es un olvido: es
 * lo que hace imposible que una interesada suba un comprobante a nombre de
 * otra, porque no hay campo donde escribir el nombre de otra.
 *
 * Tampoco está el tipo de cambio: como en `declarePayment`, ella no tiene por
 * qué saber a cuánto le liquidó el banco. Lo carga la coordinadora al revisar,
 * mirando el extracto.
 *
 * ── Y qué SÍ está, que podría sorprender ──────────────────────────────────
 *
 * `acceptedTermsText`: el texto de la condición de no reembolsable **tal como
 * se lo mostró la pantalla**. Viaja desde el cliente y el servidor NO le cree:
 * lo compara contra el texto vigente del viaje y rechaza si no coinciden. Ver
 * `submitDeposit`. Está en el input para poder detectar exactamente el caso en
 * que las coordinadoras editaron las condiciones mientras ella tenía el
 * formulario abierto — que es el único momento en que alguien podría aceptar
 * un texto que ya no existe.
 */
export const submitDepositSchema = z.object({
  amount: z
    .string()
    .trim()
    .min(1, "Ingresá el importe que transferiste.")
    .regex(
      MONEY_PATTERN,
      "El importe tiene que ser un número con hasta dos decimales, sin símbolo de moneda.",
    )
    .refine((v) => Number(v) > 0, "El importe tiene que ser mayor a cero."),
  currency: currencySchema,
  transferDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Elegí la fecha de la transferencia.")
    .refine(isRealIsoDate, "Esa no es una fecha válida."),
  /** Path del comprobante ya subido al bucket. */
  proofFileId: z
    .string()
    .trim()
    .min(1, "Subí el comprobante de la transferencia.")
    .max(500),
  /** El texto exacto de la condición que se le mostró en pantalla. */
  acceptedTermsText: z
    .string()
    .trim()
    .min(1, "Faltan las condiciones de la seña.")
    .max(5000),
  /**
   * La casilla tildada. Es `z.literal(true)` y no `boolean`: un `false` no es
   * un valor válido que haya que interpretar más adelante, es un formulario
   * que no se puede enviar.
   */
  acceptsTerms: z.literal(true, {
    error: "Tenés que aceptar la condición para poder continuar.",
  }),
});

export type SubmitDepositInput = z.infer<typeof submitDepositSchema>;

/**
 * Confirmar la seña es, al mismo tiempo, convertirla en pasajera.
 *
 * No pide `roomType`: nace sin él. Lo elige ella en su formulario de datos,
 * no la coordinadora al confirmar la transferencia.
 */
export const confirmDepositSchema = z.object({
  depositId: z.uuid(),
  /** Del extracto bancario. Obligatorio solo si la moneda difiere. */
  fxRateUsed: z
    .string()
    .trim()
    .regex(/^\d{1,10}(\.\d{1,8})?$/, "El tipo de cambio no tiene un formato válido.")
    .nullable(),
  fxRateSource: z.enum(["SUGERIDO", "INGRESADO"]).nullable(),
});

export type ConfirmDepositInput = z.infer<typeof confirmDepositSchema>;

export const rejectDepositSchema = z.object({
  depositId: z.uuid(),
  reason: z
    .string()
    .trim()
    .min(5, "Escribí el motivo: la interesada lo va a leer.")
    .max(500, "El motivo es demasiado largo."),
});

export type RejectDepositInput = z.infer<typeof rejectDepositSchema>;

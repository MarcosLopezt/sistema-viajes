import { Prisma } from "@/generated/prisma/client";

export type Decimal = Prisma.Decimal;
export const Decimal = Prisma.Decimal;

/** Valores que aceptamos como entrada de un monto. Nunca `number` suelto. */
export type MoneyInput = Prisma.Decimal | string | number;

export function toDecimal(value: MoneyInput): Decimal {
  return new Decimal(value);
}

export const ZERO = new Decimal(0);

export function sum(values: readonly MoneyInput[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(toDecimal(v)), ZERO);
}

/**
 * Redondeo al centavo hacia arriba.
 *
 * Política acordada para el prorrateo de indirectos: siempre ROUND_UP.
 * `Σ(indirectos) / budgetedPassengers` casi nunca da exacto; redondear hacia
 * arriba garantiza que la suma de lo prorrateado nunca quede por debajo del
 * costo real. El residuo (unos centavos) queda a favor del viaje y nunca llega
 * al pasajero: el coordinador fija el precio final a mano.
 */
export function roundUpToCents(value: MoneyInput): Decimal {
  return toDecimal(value).toDecimalPlaces(2, Decimal.ROUND_UP);
}

/** Redondeo comercial al centavo. Para importes que no son prorrateos. */
export function roundToCents(value: MoneyInput): Decimal {
  return toDecimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/**
 * Prorratea un costo indirecto entre los pasajeros presupuestados.
 *
 * `budgetedPassengers` cuenta SOLO pasajeros facturables: los coordinadores
 * quedan afuera del divisor (decisión 1). Si se dividiera por los confirmados,
 * el precio cambiaría cada vez que entra o sale alguien.
 */
export function perPassengerShare(
  totalAmount: MoneyInput,
  budgetedPassengers: number,
): Decimal {
  if (!Number.isInteger(budgetedPassengers) || budgetedPassengers <= 0) {
    throw new Error(
      `budgetedPassengers debe ser un entero positivo, recibido: ${budgetedPassengers}`,
    );
  }
  return roundUpToCents(toDecimal(totalAmount).dividedBy(budgetedPassengers));
}

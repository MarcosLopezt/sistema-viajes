import { toDecimal, type Decimal, type MoneyInput } from "./money";

/**
 * Conversión entre monedas. Parte pura, sin red ni base de datos.
 *
 * El servicio que trae y cachea las cotizaciones vive en
 * src/lib/services/fx.ts. Acá solo está la aritmética, para poder testearla.
 */

export type Currency = "GBP" | "USD" | "EUR";
export const CURRENCIES: readonly Currency[] = ["GBP", "USD", "EUR"];

/**
 * Cotizaciones con base USD.
 *
 * La API de frankfurter se consulta con `base=USD`, pero el viaje puede estar
 * en GBP o EUR. Los cruces GBP↔EUR NO se guardan: se derivan de las dos tasas
 * contra el dólar en el momento de usarlas. Guardar cruces precalculados
 * duplicaría la fuente de verdad y abriría la puerta a que queden
 * inconsistentes entre sí.
 */
export interface FxSnapshot {
  base: "USD";
  /**
   * Fecha que reporta la API, NO la fecha en que se consultó.
   *
   * El BCE publica solo días hábiles: un viernes a la noche, un sábado y un
   * domingo devuelven todos la cotización del viernes. La leyenda
   * "cotización del DD/MM/AAAA" que ve el usuario usa este campo.
   */
  date: Date;
  /** Unidades de cada moneda por 1 USD. `USD` siempre vale 1. */
  rates: Readonly<Record<Currency, string>>;
}

export class FxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FxError";
  }
}

function rateOf(snapshot: FxSnapshot, currency: Currency): Decimal {
  const raw = snapshot.rates[currency];
  if (raw === undefined) {
    throw new FxError(`La cotización no incluye ${currency}.`);
  }
  const value = toDecimal(raw);
  if (!value.isFinite() || value.lessThanOrEqualTo(0)) {
    throw new FxError(`Cotización inválida para ${currency}: ${raw}`);
  }
  return value;
}

/**
 * Cuántas unidades de `to` equivale 1 unidad de `from`.
 *
 * Con las tasas expresadas por dólar, el cruce sale de dividirlas:
 *   GBP→EUR = (EUR por USD) / (GBP por USD)
 *
 * La división se hace en Decimal y sin redondear el resultado intermedio: el
 * redondeo se aplica una sola vez, sobre el importe final.
 */
export function deriveRate(
  snapshot: FxSnapshot,
  from: Currency,
  to: Currency,
): Decimal {
  if (from === to) return toDecimal(1);
  return rateOf(snapshot, to).dividedBy(rateOf(snapshot, from));
}

/**
 * Convierte un importe entre monedas usando una cotización congelada.
 *
 * El resultado se redondea al centavo una sola vez, al final. Redondear el
 * tipo de cambio antes de multiplicar introduce un error que se agranda con
 * el importe.
 */
export function convert(
  amount: MoneyInput,
  from: Currency,
  to: Currency,
  snapshot: FxSnapshot,
): Decimal {
  if (from === to) return toDecimal(amount).toDecimalPlaces(2);
  return toDecimal(amount)
    .times(deriveRate(snapshot, from, to))
    .toDecimalPlaces(2);
}

/**
 * Equivalencias informativas en las otras dos monedas.
 *
 * La deuda del pasajero siempre está en la moneda del viaje; esto es solo
 * referencia, y por eso viaja junto con la fecha de la cotización: un importe
 * convertido sin decir de cuándo es el tipo de cambio induce a error.
 */
export interface Equivalence {
  currency: Currency;
  amount: Decimal;
}

export function equivalences(
  amount: MoneyInput,
  from: Currency,
  snapshot: FxSnapshot,
): { rateDate: Date; values: readonly Equivalence[] } {
  return {
    rateDate: snapshot.date,
    values: CURRENCIES.filter((c) => c !== from).map((currency) => ({
      currency,
      amount: convert(amount, from, currency, snapshot),
    })),
  };
}

/** Valida la forma de un `fxSnapshot` leído de la base (columna Json). */
export function parseFxSnapshot(value: unknown): FxSnapshot {
  if (typeof value !== "object" || value === null) {
    throw new FxError("El snapshot de cotizaciones no es un objeto.");
  }

  const candidate = value as {
    base?: unknown;
    date?: unknown;
    rates?: unknown;
  };

  if (candidate.base !== "USD") {
    throw new FxError(`Base inesperada en el snapshot: ${String(candidate.base)}`);
  }
  if (typeof candidate.date !== "string" && !(candidate.date instanceof Date)) {
    throw new FxError("El snapshot no trae una fecha válida.");
  }
  if (typeof candidate.rates !== "object" || candidate.rates === null) {
    throw new FxError("El snapshot no trae cotizaciones.");
  }

  const rates = candidate.rates as Record<string, unknown>;
  const normalized: Record<string, string> = { USD: "1" };

  for (const currency of CURRENCIES) {
    if (currency === "USD") continue;
    const raw = rates[currency];
    if (typeof raw !== "string" && typeof raw !== "number") {
      throw new FxError(`Falta la cotización de ${currency} en el snapshot.`);
    }
    normalized[currency] = String(raw);
  }

  return {
    base: "USD",
    date:
      candidate.date instanceof Date
        ? candidate.date
        : new Date(`${candidate.date}T00:00:00.000Z`),
    rates: normalized as Record<Currency, string>,
  };
}

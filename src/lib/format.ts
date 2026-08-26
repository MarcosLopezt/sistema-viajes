/**
 * Formateo para mostrar. Browser-safe: no importa Prisma ni nada de Node,
 * así que puede usarse tanto en Server como en Client Components.
 */

export type CurrencyCode = "GBP" | "USD" | "EUR";
export type LocaleCode = "es" | "en";

const CURRENCY_SYMBOL: Record<CurrencyCode, string> = {
  GBP: "£",
  USD: "US$",
  EUR: "€",
};

/**
 * Monto con símbolo de moneda SIEMPRE explícito.
 *
 * Con tres monedas en juego un número pelado es un error esperando a pasar:
 * "1.200" no dice si son libras, dólares o euros. Por eso no existe una
 * variante de esta función sin moneda.
 *
 * Se usa el símbolo de forma explícita en lugar de `style: "currency"` de
 * Intl porque el default de Intl para USD en locale `es` es "US$ 1.200,00"
 * pero en `en` es "$1,200.00" — y ese "$" a secas es justamente la ambigüedad
 * que queremos evitar.
 */
export function formatMoney(
  amount: string | number,
  currency: CurrencyCode,
  locale: LocaleCode = "es",
): string {
  const value = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(value)) {
    throw new Error(`Monto inválido para formatear: ${String(amount)}`);
  }
  const formatted = new Intl.NumberFormat(
    locale === "es" ? "es-AR" : "en-GB",
    { minimumFractionDigits: 2, maximumFractionDigits: 2 },
  ).format(value);

  return `${CURRENCY_SYMBOL[currency]} ${formatted}`;
}

/**
 * Fecha en dd/mm/aaaa en los dos idiomas.
 *
 * Las fechas de negocio se guardan como `@db.Date` y llegan como Date a
 * medianoche UTC. Se leen con los getters UTC a propósito: usar los getters
 * locales correría un día para atrás en cualquier huso al oeste de Greenwich.
 */
export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Fecha inválida para formatear: ${String(date)}`);
  }
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const year = d.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

/** Fecha y hora local, para sellar exportaciones y registros de auditoría. */
export function formatDateTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Fecha inválida para formatear: ${String(date)}`);
  }
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${day}/${month}/${year} ${hh}:${mm}`;
}

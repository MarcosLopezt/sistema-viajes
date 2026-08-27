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

/**
 * Fecha y hora en un huso EXPLÍCITO.
 *
 * Es la que sella las exportaciones, y usa el huso del viaje. La razón es
 * concreta: `formatDateTime()` usa la hora local del proceso, y en Vercel el
 * proceso corre en UTC. Una planilla generada a las 16:30 en Buenos Aires
 * saldría sellada "19:30", y como ese archivo se manda por mail y se mira
 * semanas después, esas tres horas no se recuperan.
 *
 * El huso va escrito en la salida, no solo aplicado: quien recibe el archivo
 * no tiene por qué adivinar en qué reloj está la hora.
 */
export function formatDateTimeInZone(
  date: Date,
  timeZone: string,
): string {
  // Un huso inválido hace que Intl tire RangeError. `Trip.timezone` tiene un
  // default y no tiene UI, así que en la práctica siempre es válido — pero si
  // alguna vez llega algo raro desde la base, la exportación tiene que salir
  // igual con la hora en UTC, no devolver un 500. El sello sigue diciendo en
  // qué huso está, así que la salida nunca miente.
  let zone = timeZone;
  try {
    new Intl.DateTimeFormat("es-AR", { timeZone: zone }).format(date);
  } catch {
    zone = "UTC";
  }

  const parts = new Intl.DateTimeFormat("es-AR", {
    timeZone: zone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")} (${zone})`;
}

/** Fecha y hora local del proceso. Ojo: en Vercel eso es UTC. */
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

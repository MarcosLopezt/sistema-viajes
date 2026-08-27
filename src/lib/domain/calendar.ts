import { isRealIsoDate } from "./date";

/**
 * Fechas de calendario y zonas horarias.
 *
 * ── El problema que resuelve este módulo ──────────────────────────────────
 *
 * "¿Está vencida?" no es una pregunta sobre INSTANTES, es una pregunta sobre
 * DÍAS DE CALENDARIO. Una cuota que vence el 26 de agosto vence el 26 de
 * agosto donde vive el pasajero, no en Greenwich.
 *
 * Comparar `dueDate < new Date()` parece razonable y está mal. En Vercel el
 * proceso corre en UTC: a las 22:00 del 26 de agosto en Buenos Aires ya son
 * las 01:00 del 27 en UTC, así que la cuota del 26 aparecería vencida tres
 * horas antes de que termine el día del pasajero. Es un cartel rojo, un mail
 * de reclamo y una llamada al coordinador por algo que todavía no pasó.
 *
 * La solución no es "sumar tres horas". Es dejar de trabajar con instantes:
 * se convierte el instante actual a la FECHA DE CALENDARIO en la zona del
 * viaje, y a partir de ahí todas las comparaciones son entre fechas.
 *
 * ── Por qué las fechas viajan como string ────────────────────────────────
 *
 * Una `CalendarDate` es "2026-08-26": un día, sin hora y sin huso. En ese
 * formato el orden lexicográfico ES el orden cronológico, así que comparar
 * dos fechas es `a < b` y no hay forma de que se cuele una hora que corra el
 * resultado. Un `Date` para representar un día siempre lleva un huso adentro,
 * y ese huso vuelve a morder en cuanto alguien usa un getter local.
 *
 * Las columnas `@db.Date` de Prisma llegan como `Date` a medianoche UTC:
 * `toCalendarDate()` las traduce, y es la única puerta de entrada.
 *
 * Funciones puras, testeadas en tests/domain/calendar.test.ts.
 */

/** Un día del calendario en formato ISO: "2026-08-26". Sin hora, sin huso. */
export type CalendarDate = string;

/**
 * Zona horaria de referencia por default.
 *
 * El grupo viaja desde Argentina: los vencimientos se piensan, se comunican y
 * se reclaman en hora argentina, aunque el viaje sea a Europa y el servidor
 * esté en Washington. `Trip.timezone` la puede pisar por viaje.
 */
export const DEFAULT_TIMEZONE = "America/Argentina/Buenos_Aires";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export class CalendarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalendarError";
  }
}

/**
 * ¿Es una zona horaria que la plataforma conoce?
 *
 * Se pregunta antes de usarla porque `Intl` TIRA con una zona inválida, y una
 * zona mal tipeada guardada en la base no puede hacer explotar la pantalla de
 * pagos de todo un viaje.
 */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * La zona a usar: la del viaje si es válida, la default si no.
 *
 * Falla abierto A PROPÓSITO y hacia el default, no hacia UTC: si alguien
 * guarda "America/Buenos_Aires_" con un typo, es mucho mejor seguir contando
 * los días en hora argentina que empezar a contarlos en Greenwich sin que
 * nadie se entere.
 */
export function resolveTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return DEFAULT_TIMEZONE;
  return isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIMEZONE;
}

/**
 * Qué día es, en una zona horaria dada, en este instante.
 *
 * Es la única función del sistema que convierte un instante en un día. Todo
 * lo que decide "hoy" —el semáforo, los recordatorios del cron, las fechas
 * sugeridas de un plan— pasa por acá.
 *
 * Se usa `formatToParts` y no `format` porque el string que arma cada locale
 * no está garantizado; las partes sí.
 */
export function calendarDateIn(
  instant: Date,
  timeZone: string = DEFAULT_TIMEZONE,
): CalendarDate {
  if (Number.isNaN(instant.getTime())) {
    throw new CalendarError("Instante inválido.");
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: resolveTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Traduce un `@db.Date` de Prisma (Date a medianoche UTC) a fecha de
 * calendario.
 *
 * Se leen los getters UTC a propósito: con los locales, cualquier huso al
 * oeste de Greenwich devolvería el día anterior.
 */
export function toCalendarDate(date: Date): CalendarDate {
  if (Number.isNaN(date.getTime())) {
    throw new CalendarError("Fecha inválida.");
  }
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Inversa: el `Date` a medianoche UTC que guarda una columna `@db.Date`. */
export function fromCalendarDate(date: CalendarDate): Date {
  assertCalendarDate(date);
  return new Date(`${date}T00:00:00.000Z`);
}

export function assertCalendarDate(date: string): asserts date is CalendarDate {
  // `isRealIsoDate` y no un regex: JS desborda 31/02 a marzo en silencio.
  if (!isRealIsoDate(date)) {
    throw new CalendarError(`No es una fecha de calendario válida: ${date}`);
  }
}

export function addCalendarDays(date: CalendarDate, days: number): CalendarDate {
  const base = fromCalendarDate(date);
  return toCalendarDate(new Date(base.getTime() + days * MS_PER_DAY));
}

/**
 * Días enteros de `from` a `to`. Negativo si `to` ya pasó.
 *
 * Al operar sobre fechas de calendario —las dos a medianoche UTC— no hay
 * horario de verano que corra el resultado: entre dos días consecutivos
 * siempre hay exactamente un día, aunque en esa noche el reloj local haya
 * saltado una hora.
 */
export function daysBetweenCalendarDates(
  from: CalendarDate,
  to: CalendarDate,
): number {
  return Math.round(
    (fromCalendarDate(to).getTime() - fromCalendarDate(from).getTime()) /
      MS_PER_DAY,
  );
}

/** `-1`, `0` o `1`. El orden lexicográfico de ISO es el cronológico. */
export function compareCalendarDates(a: CalendarDate, b: CalendarDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function isBefore(a: CalendarDate, b: CalendarDate): boolean {
  return a < b;
}

export function minCalendarDate(
  a: CalendarDate,
  b: CalendarDate,
): CalendarDate {
  return a <= b ? a : b;
}

export function maxCalendarDate(
  a: CalendarDate,
  b: CalendarDate,
): CalendarDate {
  return a >= b ? a : b;
}

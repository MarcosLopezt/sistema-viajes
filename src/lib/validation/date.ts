/**
 * Validación de fechas de negocio en formato ISO ("aaaa-mm-dd").
 *
 * ── Por qué no alcanza con `new Date(value)` ──────────────────────────────
 *
 * JavaScript NO rechaza una fecha inexistente: la desborda en silencio.
 *
 *   new Date("2032-02-31T00:00:00.000Z")  →  2032-03-02
 *
 * No es NaN, así que cualquier chequeo del tipo `!isNaN(date)` la da por
 * buena. Aplicado a un vencimiento de pasaporte eso significa que alguien
 * tipea 31/02 y el sistema le guarda el 2 de marzo sin decirle nada — y esa
 * fecha después decide si puede viajar.
 *
 * La única forma confiable es reconstruir la fecha y comparar sus tres
 * componentes con lo que se escribió.
 */

const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isRealIsoDate(value: string): boolean {
  if (!ISO_PATTERN.test(value)) return false;

  const [year, month, day] = value.split("-").map(Number) as [
    number,
    number,
    number,
  ];

  // El rollover se detecta acá: si el día no sobrevive al viaje de ida y
  // vuelta, la fecha que se escribió no existe.
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export { ISO_PATTERN };

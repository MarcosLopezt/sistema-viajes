import "server-only";

import { prisma } from "@/lib/db/prisma";
import {
  CURRENCIES,
  FxError,
  type Currency,
  type FxSnapshot,
} from "@/lib/domain/fx";

/**
 * Cotizaciones: obtención diaria, cache en base y degradación elegante.
 *
 * Reglas:
 *  - La API se consulta UNA vez por día, nunca por request. El cache es la
 *    tabla FxRate; si ya hay una fila para hoy, no se sale a la red.
 *  - Si la API falla, se usa la última cotización guardada y se marca como
 *    vieja para que la interfaz pueda decirlo. Nunca se rompe una pantalla
 *    por una API de terceros caída.
 *  - Solo se guarda la base USD. Los cruces GBP↔EUR se derivan al usarlos
 *    (ver src/lib/domain/fx.ts).
 */

const FRANKFURTER_URL =
  "https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR,GBP";

/** Cuánto esperamos a la API antes de caer al cache. */
const FETCH_TIMEOUT_MS = 5_000;

export interface FxResult {
  snapshot: FxSnapshot;
  /**
   * `true` si no se pudo actualizar y esto viene del cache.
   * La interfaz igual muestra la fecha, así que el usuario nunca ve un
   * número sin saber de cuándo es; esto sirve para avisarlo explícitamente.
   */
  stale: boolean;
}

interface FrankfurterResponse {
  base: string;
  date: string;
  rates: Record<string, number>;
}

function todayUtc(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

function toSnapshot(row: {
  date: Date;
  rates: unknown;
}): FxSnapshot {
  const rates = row.rates as Record<string, string | number>;
  const normalized: Record<string, string> = { USD: "1" };
  for (const currency of CURRENCIES) {
    if (currency === "USD") continue;
    normalized[currency] = String(rates[currency]);
  }
  return {
    base: "USD",
    date: row.date,
    rates: normalized as Record<Currency, string>,
  };
}

/**
 * Trae la cotización del día desde frankfurter.
 *
 * Se guardan los valores como STRING, no como número: un `number` de
 * JavaScript no representa exactamente 0.8571, y esa cotización después
 * multiplica importes de dinero.
 */
async function fetchFromApi(): Promise<{ date: Date; rates: Record<string, string> }> {
  const response = await fetch(FRANKFURTER_URL, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    // El cache lo maneja la tabla FxRate, no el fetch de Next.
    cache: "no-store",
  });

  if (!response.ok) {
    throw new FxError(`frankfurter respondió HTTP ${response.status}`);
  }

  const payload = (await response.json()) as FrankfurterResponse;

  if (payload.base !== "USD" || typeof payload.date !== "string") {
    throw new FxError("Respuesta inesperada de frankfurter.");
  }

  const rates: Record<string, string> = {};
  for (const currency of ["EUR", "GBP"] as const) {
    const value = payload.rates?.[currency];
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      throw new FxError(`frankfurter no devolvió una cotización de ${currency}.`);
    }
    rates[currency] = String(value);
  }

  return {
    // La fecha la reporta la API y es un día hábil del BCE: puede no ser hoy.
    date: new Date(`${payload.date}T00:00:00.000Z`),
    rates,
  };
}

/** Última cotización guardada, sin importar de cuándo sea. */
async function lastStored(): Promise<FxSnapshot | null> {
  const row = await prisma.fxRate.findFirst({
    where: { base: "USD" },
    orderBy: { date: "desc" },
    select: { date: true, rates: true },
  });
  return row ? toSnapshot(row) : null;
}

/**
 * Cotización vigente, con cache diario.
 *
 * `refresh: true` fuerza la consulta a la API aunque ya haya una fila de hoy.
 * Lo usa el cron diario; el resto del sistema llama sin argumentos.
 */
export async function getFxSnapshot(
  options: { refresh?: boolean } = {},
): Promise<FxResult> {
  const today = todayUtc();

  if (!options.refresh) {
    // Si ya guardamos algo hoy, alcanza. Se compara contra `fetchedAt` y no
    // contra `date` porque un fin de semana la API devuelve la fecha del
    // viernes: sin esto saldríamos a la red en cada request del sábado.
    const fresh = await prisma.fxRate.findFirst({
      where: { base: "USD", fetchedAt: { gte: today } },
      orderBy: { fetchedAt: "desc" },
      select: { date: true, rates: true },
    });
    if (fresh) return { snapshot: toSnapshot(fresh), stale: false };
  }

  try {
    const { date, rates } = await fetchFromApi();

    const saved = await prisma.fxRate.upsert({
      where: { date_base: { date, base: "USD" } },
      // Si ya existía la fila de ese día hábil, solo se corre fetchedAt: así
      // el cache diario se renueva sin duplicar filas los fines de semana.
      update: { rates, fetchedAt: new Date() },
      create: { date, base: "USD", rates },
      select: { date: true, rates: true },
    });

    return { snapshot: toSnapshot(saved), stale: false };
  } catch (error) {
    // Degradación: la última guardada es mejor que una pantalla rota.
    const fallback = await lastStored();
    if (fallback) {
      console.warn(
        `[fx] no se pudo actualizar la cotización (${(error as Error).message}); se usa la del ${fallback.date.toISOString().slice(0, 10)}`,
      );
      return { snapshot: fallback, stale: true };
    }
    throw new FxError(
      "No hay cotizaciones disponibles y la API no responde. " +
        "Corré el cron diario o cargá una fila en FxRate.",
    );
  }
}

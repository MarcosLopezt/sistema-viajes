/**
 * Diagnóstico de la conexión a la base.
 *
 * Verifica lo que la connection string por sí sola NO garantiza desde que
 * Prisma 7 usa driver adapters: que el runtime vaya al transaction pooler,
 * que las migraciones vayan al session pooler, y sobre todo que el pool de
 * `pg` esté limitado a una conexión por instancia.
 *
 * Los parámetros `?pgbouncer=true&connection_limit=1` son directivas del
 * viejo engine de Prisma: `pg` no los conoce y los ignora en silencio. Sin un
 * `max` explícito en código el pool queda en el default de `pg` (10), y en el
 * free tier de Supabase eso agota el cupo bajo concurrencia. Este script lo
 * comprueba en vez de darlo por sentado.
 *
 * Uso: npm run check:db
 */
import "dotenv/config";
import { Pool } from "pg";
import { prisma, disconnectDb } from "../src/lib/db/prisma";

const EXPECTED_RUNTIME_PORT = "6543";
const EXPECTED_DIRECT_PORT = "5432";

interface PoolInternals {
  options?: { max?: number };
  totalCount?: number;
  idleCount?: number;
}

function portOf(url: string | undefined): string | null {
  return url?.match(/:(\d+)\/[^/]*$/)?.[1] ?? null;
}

const problems: string[] = [];

function check(ok: boolean, label: string, detail: string): void {
  console.info(`  ${ok ? "✓" : "✗"} ${label}: ${detail}`);
  if (!ok) problems.push(label);
}

async function main() {
  console.info("\nConexión a la base\n");

  // ---------------------------------------------------------------- puertos
  const runtimePort = portOf(process.env["DATABASE_URL"]);
  const directPort = portOf(process.env["DIRECT_URL"]);

  check(
    runtimePort === EXPECTED_RUNTIME_PORT,
    "runtime → transaction pooler",
    `puerto ${runtimePort ?? "?"} (esperado ${EXPECTED_RUNTIME_PORT})`,
  );
  check(
    directPort === EXPECTED_DIRECT_PORT,
    "migraciones → session pooler",
    `puerto ${directPort ?? "?"} (esperado ${EXPECTED_DIRECT_PORT})`,
  );

  // --------------------------------------------------- la URL no basta sola
  // Se demuestra que `pg` ignora connection_limit, para que quede claro por
  // qué el `max` tiene que ir en código.
  const throwaway = new Pool({ connectionString: process.env["DATABASE_URL"] });
  const urlOnlyMax = (throwaway as unknown as PoolInternals).options?.max;
  await throwaway.end();
  check(
    urlOnlyMax !== 1,
    "connection_limit de la URL",
    `pg lo ignora → max quedaría en ${urlOnlyMax} (por eso va explícito en código)`,
  );

  // ----------------------------------------------------- conectividad real
  const started = Date.now();
  const [trips, people, passengers, plans, installments] = await Promise.all([
    prisma.trip.count(),
    prisma.person.count(),
    prisma.passenger.count(),
    prisma.paymentPlan.count(),
    prisma.installment.count(),
  ]);
  check(
    true,
    "5 consultas concurrentes",
    `${Date.now() - started} ms`,
  );

  console.info(
    `\n  Datos: ${trips} viaje(s) · ${people} persona(s) · ${passengers} pasajero(s) · ${plans} plan(es) · ${installments} cuota(s)`,
  );

  // ------------------------------------------------------- límite del pool
  const pool = (globalThis as unknown as { prismaPool?: PoolInternals })
    .prismaPool;

  console.info("");
  check(
    pool?.options?.max === 1,
    "pool.max efectivo",
    String(pool?.options?.max ?? "desconocido"),
  );

  // Con max: 1 estas 25 consultas se serializan sobre una sola conexión en
  // vez de abrir 25. Es la prueba de que el límite es real y no declarativo.
  const burstStart = Date.now();
  await Promise.all(Array.from({ length: 25 }, () => prisma.trip.count()));
  check(
    pool?.totalCount === 1,
    "conexiones abiertas tras 25 consultas en paralelo",
    `${pool?.totalCount ?? "?"} (${Date.now() - burstStart} ms)`,
  );

  // ------------------------------------------------------------- resultado
  if (problems.length > 0) {
    console.error(`\n✗ ${problems.length} problema(s): ${problems.join(", ")}\n`);
    await disconnectDb();
    process.exit(1);
  }

  console.info("\n✓ Conexión y pooling correctos.\n");
  await disconnectDb();
}

main().catch(async (error) => {
  // Nunca imprimimos la connection string: lleva la contraseña.
  console.error("\n✗ No se pudo verificar la base:", (error as Error).message);
  await disconnectDb().catch(() => {});
  process.exit(1);
});

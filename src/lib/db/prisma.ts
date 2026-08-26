import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Cliente Prisma único por proceso, sobre un pool de `pg` explícito.
 *
 * ── Por qué el pool se configura acá y no en la connection string ──────────
 *
 * Prisma 7 dejó de traer su propio motor de consultas: ahora habla con
 * Postgres a través del driver `pg`. Eso mueve el control del pooling del
 * engine de Prisma a `pg`, y tiene una consecuencia que NO es evidente:
 *
 *   Los parámetros `?pgbouncer=true&connection_limit=1` de la URL eran
 *   directivas del engine de Prisma. `pg` no los conoce. `pg-connection-string`
 *   los parsea como propiedades sueltas sin significado y las ignora, así que
 *   `connection_limit=1` NO limita nada y el pool queda en el default de `pg`,
 *   que es max: 10 — por instancia.
 *
 * En Vercel cada instancia concurrente abriría hasta 10 conexiones contra un
 * pooler de Supabase free tier que admite pocas decenas en total. El síntoma
 * es intermitente y aparece recién bajo concurrencia, que es la peor forma de
 * enterarse. Por eso `max` va explícito en código.
 *
 * ── Reutilización ─────────────────────────────────────────────────────────
 *
 * Tanto el pool como el cliente se cachean en `globalThis`, por dos motivos a
 * la vez: el hot reload de Next en desarrollo (sin el cache, cada recarga
 * abriría un pool nuevo) y el reuso entre invocaciones de una misma lambda
 * tibia en producción. Nunca se crea un pool por request.
 *
 * ── Puertos ───────────────────────────────────────────────────────────────
 *
 *   DATABASE_URL → 6543, transaction pooler. Runtime (esto).
 *   DIRECT_URL   → 5432, session pooler.     Migraciones y seed, vía CLI.
 *
 * Ver README §Base de datos.
 */
const globalForDb = globalThis as unknown as {
  prismaPool: Pool | undefined;
  prisma: PrismaClient | undefined;
};

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "Falta DATABASE_URL. Copiá .env.example a .env y completala.",
    );
  }

  return new Pool({
    connectionString,
    // Una conexión por instancia. El pooler de Supabase ya multiplexa del
    // otro lado: abrir más acá no da paralelismo, solo agota el cupo.
    max: 1,
    // El transaction pooler corta las conexiones ociosas por su cuenta;
    // soltarlas antes evita quedarse con una conexión muerta en el pool.
    idleTimeoutMillis: 10_000,
    // Sin esto, si el pooler está saturado el request queda colgado hasta el
    // timeout de la plataforma en vez de fallar con un error accionable.
    connectionTimeoutMillis: 10_000,
    // Deja que el proceso termine cuando el pool queda ocioso: importa en los
    // scripts (seed, cron) para que no queden colgados.
    allowExitOnIdle: true,
  });
}

function getPool(): Pool {
  if (!globalForDb.prismaPool) {
    globalForDb.prismaPool = createPool();
  }
  return globalForDb.prismaPool;
}

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    // Se le pasa el Pool ya construido, no un connectionString: si se le
    // pasara la URL, el adapter armaría su propio pool con los defaults y
    // perderíamos el max: 1.
    adapter: new PrismaPg(getPool()),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

function getPrismaClient(): PrismaClient {
  if (!globalForDb.prisma) {
    globalForDb.prisma = createPrismaClient();
  }
  return globalForDb.prisma;
}

/**
 * La inicialización es perezosa. Si el cliente se construyera al importar el
 * módulo, `next build` fallaría con "falta DATABASE_URL" apenas recolecta las
 * páginas, porque compilar no necesita una base.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    const client = getPrismaClient();
    const value = Reflect.get(client, property, receiver);
    // Los métodos se re-atan al cliente real: si se devolvieran sueltos,
    // perderían el `this` y fallarían al invocarse.
    return typeof value === "function" ? value.bind(client) : value;
  },
});

/** Cierra el pool. Solo para scripts (seed, cron) y tests de integración. */
export async function disconnectDb(): Promise<void> {
  await globalForDb.prisma?.$disconnect();
  await globalForDb.prismaPool?.end();
  globalForDb.prisma = undefined;
  globalForDb.prismaPool = undefined;
}

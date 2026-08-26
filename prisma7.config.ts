import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * Supabase expone dos connection strings y las dos hacen falta:
 *
 *  - DATABASE_URL  → pooler (pgbouncer, modo transaction), puerto 6543.
 *    La usa la app en runtime, a través del adapter de `pg`. pgbouncer en modo
 *    transaction NO soporta prepared statements, por eso la URL lleva
 *    `?pgbouncer=true&connection_limit=1`. Ver src/lib/db/prisma.ts.
 *
 *  - DIRECT_URL    → conexión directa a Postgres, puerto 5432.
 *    Es la que se declara acá, porque este archivo lo lee únicamente el CLI
 *    (`prisma migrate`, `prisma db push`, `prisma studio`). Corridas contra el
 *    pooler fallan con errores crípticos sobre prepared statements.
 *
 * Si DIRECT_URL no está definida se cae a DATABASE_URL para que un clon nuevo
 * con una sola variable siga arrancando.
 *
 * Ver README §Base de datos.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"],
  },
});

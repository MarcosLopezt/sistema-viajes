import { defineConfig } from "vitest/config";

/**
 * Dos suites, separadas a propósito.
 *
 *   unit         funciones puras. Sin base, sin red. Corren en ~1 segundo, y
 *                por eso son las que se corren todo el tiempo.
 *
 *   integration  aislamiento y autorización contra la base REAL. Lo único
 *                mockeado es la sesión de Supabase; los guards, los servicios
 *                y las consultas corren de verdad. Necesitan DATABASE_URL.
 *
 * La separación importa: un test de aislamiento con Prisma mockeado no prueba
 * aislamiento, prueba que el mock hace lo que le dijimos.
 */
export default defineConfig({
  resolve: {
    // Resuelve el alias `@/*` de tsconfig.json de forma nativa.
    tsconfigPaths: true,
  },
  test: {
    projects: [
      {
        resolve: { tsconfigPaths: true },
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/domain/**/*.test.ts", "tests/auth/**/*.test.ts"],
        },
      },
      {
        resolve: { tsconfigPaths: true },
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          setupFiles: ["./tests/integration/setup.ts"],
          // Los tests comparten un pool de una sola conexión y crean datos
          // con nombres propios: corriendo en paralelo se pisarían.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
    coverage: {
      include: [
        "src/lib/domain/**",
        "src/lib/auth/policy.ts",
        "src/lib/services/**",
      ],
    },
  },
});

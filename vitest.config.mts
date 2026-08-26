import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Resuelve el alias `@/*` de tsconfig.json de forma nativa: Vite ya no
    // necesita el plugin vite-tsconfig-paths para esto.
    tsconfigPaths: true,
  },
  test: {
    // Entorno node: lo que se testea son funciones puras de dominio y la
    // matriz de autorizacion, nada que toque el DOM.
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      include: ["src/lib/domain/**", "src/lib/auth/policy.ts"],
    },
  },
});

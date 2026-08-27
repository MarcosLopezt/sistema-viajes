import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Los límites entre capas se verifican en DOS lugares, a propósito.
 *
 *   Acá         las reglas que ESLint expresa bien: "este archivo no puede
 *               importar aquello". Saltan en el editor mientras se escribe,
 *               que es cuando corregirlas cuesta nada.
 *
 *   check-layers.ts  las que necesitan seguir el grafo de importaciones o
 *               verificar una propiedad, y que `no-restricted-imports` no
 *               puede ver porque razona archivo por archivo.
 *
 * No es duplicación: son dos preguntas distintas. Un Client Component que
 * importa un módulo inocente que a su vez importa Prisma no viola ninguna
 * regla de las de acá, y sin embargo rompe el build.
 *
 * `allowTypeImports: true` en todas: `import type` se borra en compilación,
 * no llega un byte al bundle. Prohibirlo sería castigar el uso de tipos.
 *
 * Las reglas y sus porqués están en README §Arquitectura.
 */

const PRISMA = {
  group: ["@/lib/db/*", "@prisma/*", "@/generated/prisma/client"],
  message:
    "La base se consulta desde lib/services/. Acá no: la autorización vive con la consulta.",
  allowTypeImports: true,
};

const SERVICES = {
  group: ["@/lib/services/*"],
  message:
    "Un componente no llama servicios. Los datos bajan por props desde un Server Component.",
  allowTypeImports: true,
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    // Ignores por defecto de eslint-config-next.
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // El cliente de Prisma es código generado: no se lintea ni se edita.
    "src/generated/**",
  ]),
  {
    rules: {
      // Los enums de Prisma se usan como tipos en muchos lugares; el import
      // separado con `import type` mantiene el bundle del cliente limpio.
      "@typescript-eslint/consistent-type-imports": [
        "warn",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
    },
  },

  // ── domain/ es puro ──────────────────────────────────────────────────────
  // Funciones y nada más: sin base, sin framework, sin entorno. Es lo que
  // permite importarlas desde un Client Component sin pensarlo y testearlas
  // sin montar nada.
  {
    files: ["src/lib/domain/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            PRISMA,
            {
              group: [
                "next",
                "next/*",
                "react",
                "react/*",
                "react-dom",
                "@supabase/*",
                "@/lib/supabase/*",
                "@/lib/services/*",
                "@/lib/validation/*",
                "server-only",
              ],
              message:
                "domain/ es puro: sin framework, sin entorno, sin capas de arriba. Si hace falta eso, va en services/.",
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },

  // ── services/ no sabe que existe React ───────────────────────────────────
  {
    files: ["src/lib/services/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["react", "react/*", "react-dom", "react-dom/*"],
              message:
                "services/ es lógica y autorización, no interfaz. React no entra acá.",
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },

  // ── components/ no consulta ni llama servicios ───────────────────────────
  {
    files: ["src/components/**/*.tsx", "src/components/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        { patterns: [PRISMA, SERVICES] },
      ],
    },
  },

  // ── La capa de app entra por servicios ───────────────────────────────────
  // Páginas, Server Actions y Route Handlers son cáscaras finas. Importar
  // funciones puras de domain/ SÍ está permitido: no es acceso a datos.
  {
    files: ["src/app/**/*.ts", "src/app/**/*.tsx"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        { patterns: [PRISMA] },
      ],
    },
  },
]);

export default eslintConfig;

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

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
]);

export default eslintConfig;

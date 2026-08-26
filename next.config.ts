import path from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Rutas tipadas: un `<Link href="/viajess">` con un typo no compila.
  typedRoutes: true,
  turbopack: {
    // Ancla la raíz al proyecto. Sin esto, Turbopack sube por el árbol de
    // directorios buscando un lockfile y puede encontrar uno del directorio
    // del usuario, fuera del repositorio.
    root: path.resolve(import.meta.dirname),
  },
};

export default withNextIntl(nextConfig);

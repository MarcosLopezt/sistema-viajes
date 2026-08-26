import { defineRouting } from "next-intl/routing";

/**
 * Español por defecto, inglés como segundo idioma.
 *
 * `localePrefix: "always"` deja el idioma explícito en la URL (`/es/...`,
 * `/en/...`). Es más largo de escribir pero hace que un link compartido
 * conserve el idioma de quien lo mandó, que importa cuando el coordinador le
 * pasa una URL a un pasajero que lee en el otro idioma.
 */
export const routing = defineRouting({
  locales: ["es", "en"],
  defaultLocale: "es",
  localePrefix: "always",
});

export type Locale = (typeof routing.locales)[number];

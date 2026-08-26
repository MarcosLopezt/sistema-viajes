import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
    // Todas las fechas de negocio se muestran en dd/mm/aaaa en los dos
    // idiomas: el público es rioplatense y el formato mm/dd de en-US sería
    // una fuente silenciosa de errores de lectura.
    formats: {
      dateTime: {
        short: { day: "2-digit", month: "2-digit", year: "numeric" },
      },
    },
  };
});

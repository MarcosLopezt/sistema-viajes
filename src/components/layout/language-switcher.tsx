"use client";

import { useLocale, useTranslations } from "next-intl";
import { Languages } from "lucide-react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Cambia el idioma conservando la página actual.
 *
 * Esto solo cambia el idioma de la NAVEGACIÓN. La preferencia persistente del
 * pasajero vive en `Person.preferredLanguage` y es la que decide en qué idioma
 * le llegan los mails; se elige al registrarse y se edita desde "Mis datos".
 * Son dos cosas distintas a propósito: el coordinador puede navegar en español
 * y mandarle un mail en inglés a quien lo prefiere.
 */
export function LanguageSwitcher() {
  const t = useTranslations("common");
  const locale = useLocale() as Locale;
  const pathname = usePathname();
  const router = useRouter();

  const label: Record<Locale, string> = {
    es: t("languageEs"),
    en: t("languageEn"),
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* `default` (44px) y no `sm` (36px): este botón vive en las shells
            del pasajero y de la interesada, que son pantallas de teléfono, y
            el propio button.tsx reserva `sm` para las filas densas del panel
            de escritorio. Era un target de 36px que se coló en las tres
            shells; en el panel del coordinador 44px también está bien. */}
        <Button variant="ghost" aria-label={t("language")}>
          <Languages aria-hidden="true" />
          {label[locale]}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {routing.locales.map((option) => (
          <DropdownMenuItem
            key={option}
            disabled={option === locale}
            onSelect={() => router.replace(pathname, { locale: option })}
          >
            {label[option]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

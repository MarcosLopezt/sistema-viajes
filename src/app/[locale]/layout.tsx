import type { Metadata } from "next";
import { Geist, Geist_Mono, Cormorant_Garamond } from "next/font/google";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import "../globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * La serifa de la zona pública y de la interesada.
 *
 * Se carga en el layout raíz —y no en el de la zona cálida— porque
 * `next/font` necesita ser una constante de módulo para poder inlinear el
 * archivo en el build. Que esté declarada acá no la aplica a nada: solo define
 * la variable CSS, y solo `.zona-calida` la usa.
 */
const cormorant = Cormorant_Garamond({
  variable: "--font-serif",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
});

/**
 * Este es el root layout de la app: no hay `src/app/layout.tsx`. Todas las
 * páginas viven bajo `/[locale]`, así que el `<html lang>` puede reflejar el
 * idioma real — que es lo que necesitan los lectores de pantalla para elegir
 * la pronunciación correcta.
 */
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "common" });
  return {
    title: t("appName"),
    // Datos personales y de salud: que ningún buscador indexe nada de acá.
    robots: { index: false, follow: false },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: LayoutProps<"/[locale]">) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  // Habilita el renderizado estático de las páginas que no dependen de sesión.
  setRequestLocale(locale);

  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} ${cormorant.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}

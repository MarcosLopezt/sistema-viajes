import { getTranslations } from "next-intl/server";

/**
 * Shell de la zona pública. SIN sesión y sin ninguna verificación de acceso.
 *
 * Es el único layout del sistema que no llama a `getSessionUser()`, y eso es
 * el punto: acá llega alguien que todavía no es nadie, desde un botón de Wix o
 * un link de Instagram.
 *
 * Que no haya guard no lo vuelve una puerta abierta al sistema. Lo que se
 * muestra adentro son campos que un servicio seleccionó uno por uno para ser
 * públicos (`getPublicTrip`), y lo único que se puede hacer es registrarse,
 * que está acotado por rate limiting en tres capas.
 *
 * Identidad propia —serifa, paleta cálida— porque tiene que parecerse a la
 * escuela y no a un panel de administración. El corte con la zona interna, que
 * es gris y densa, es la señal de que ya entraste.
 *
 * Mobile-first de verdad: la mayoría llega desde Instagram, en un teléfono.
 */
export default async function PublicLayout({
  children,
}: LayoutProps<"/[locale]">) {
  const t = await getTranslations("common");

  return (
    <div className="zona-calida flex min-h-full flex-1 flex-col">
      <a href="#contenido" className="skip-link">
        {t("skipToContent")}
      </a>

      <main id="contenido" className="mx-auto w-full max-w-xl flex-1 px-5 py-10">
        {children}
      </main>
    </div>
  );
}

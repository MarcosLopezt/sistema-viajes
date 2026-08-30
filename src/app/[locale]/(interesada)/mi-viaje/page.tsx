import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { requireSessionUser } from "@/lib/auth/guards";
import { getMyInterestView } from "@/lib/services/interest";
import { PlainText } from "@/components/public/plain-text";
import { UserMenu } from "@/components/layout/user-menu";

/**
 * La pantalla de la interesada. Es TODO lo que ve del sistema.
 *
 * La propuesta del viaje, qué sigue, y nada más. No hay cupos, ni precios, ni
 * fechas, ni una sola referencia a otra persona: `getMyInterestView()`
 * selecciona cuatro campos y esa es la superficie completa.
 *
 * ── Por qué no hace falta un guard de rol acá ─────────────────────────────
 *
 * Porque no hay ningún rol que verificar. Esta página no lee nada del viaje
 * por su cuenta: le pide al servicio lo suyo, y el servicio lo resuelve desde
 * la sesión. Alguien que no tenga Interest recibe `null` y se va a `/`, que lo
 * reencamina al panel que le corresponde.
 *
 * Lo que impide que una interesada entre a las pantallas internas no es una
 * comprobación de esta página: es que no tiene TripMember, y por eso todos los
 * guards del sistema le dicen que no. Ver el docblock del modelo Interest.
 */
export default async function MyTripPage() {
  const user = await requireSessionUser();

  const locale = await getLocale();
  const t = await getTranslations("interest");
  const tCommon = await getTranslations("common");

  const view = await getMyInterestView(locale);

  // Sin Interest esta pantalla no es suya. Se la manda al punto de entrada, que
  // decide adónde va según lo que sí sea.
  if (!view) redirect({ href: "/", locale });

  return (
    <div className="zona-calida flex min-h-full flex-1 flex-col">
      <a href="#contenido" className="skip-link">
        {tCommon("skipToContent")}
      </a>

      <header className="border-border flex h-16 shrink-0 items-center justify-between gap-2 border-b px-5">
        <span className="text-lg font-semibold">{tCommon("appName")}</span>
        <UserMenu email={user.email} />
      </header>

      <main
        id="contenido"
        className="mx-auto w-full max-w-xl flex-1 space-y-8 px-5 py-10"
      >
        <header className="space-y-2">
          <p className="text-muted-foreground text-sm tracking-wide uppercase">
            {t("eyebrow")}
          </p>
          <h1 className="text-4xl leading-tight">{view.tripName}</h1>
        </header>

        {view.infoForInterested ? (
          <PlainText text={view.infoForInterested} className="text-lg" />
        ) : (
          <p className="text-muted-foreground text-lg">{t("noInfoYet")}</p>
        )}

        {view.nextStepMessage ? (
          <section className="border-border bg-card rounded-lg border p-5">
            <h2 className="mb-2 text-xl">{t("nextStepTitle")}</h2>
            <PlainText text={view.nextStepMessage} />
          </section>
        ) : null}
      </main>
    </div>
  );
}

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSessionUser } from "@/lib/auth/guards";
import { UserMenu } from "@/components/layout/user-menu";

/**
 * Shell del pasajero. Mobile-first de verdad: diseñado a 375px y ensanchado
 * después, no un panel de escritorio encogido.
 *
 * Sin navegación lateral ni menú hamburguesa: el home son tres tarjetas y
 * desde ahí se entra a todo. Un menú sería una capa más para alguien que entra
 * dos veces en su vida.
 */
export default async function PassengerLayout({
  children,
}: LayoutProps<"/[locale]">) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const t = await getTranslations("common");

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <a href="#contenido" className="skip-link">
        {t("skipToContent")}
      </a>

      <header className="border-border flex h-16 shrink-0 items-center justify-between gap-2 border-b px-4">
        <span className="text-lg font-semibold">{t("appName")}</span>
        <UserMenu email={user.email} />
      </header>

      <main id="contenido" className="mx-auto w-full max-w-lg flex-1 p-4">
        {children}
      </main>
    </div>
  );
}

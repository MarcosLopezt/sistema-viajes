import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSessionUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/db/prisma";
import { CoordinatorNav } from "@/components/layout/coordinator-nav";
import { UserMenu } from "@/components/layout/user-menu";

/**
 * Shell del coordinador: densidad de escritorio, navegación lateral fija.
 *
 * El guard de acá decide si se ve el panel, no qué se puede hacer adentro.
 * Cada página y cada Server Action vuelve a validar permisos sobre el viaje
 * concreto con requireCapability(): ocultar el menú no protege nada.
 */
export default async function CoordinatorLayout({
  children,
}: LayoutProps<"/[locale]">) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  if (user.role !== "ADMIN") {
    const membership = await prisma.tripMember.findFirst({
      where: { userId: user.id, role: "COORDINADOR" },
      select: { id: true },
    });
    if (!membership) redirect("/inicio");
  }

  const t = await getTranslations("common");

  return (
    <div className="flex min-h-full flex-1 flex-col md:flex-row">
      <a href="#contenido" className="skip-link">
        {t("skipToContent")}
      </a>

      <CoordinatorNav isAdmin={user.role === "ADMIN"} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-border flex h-16 shrink-0 items-center justify-end gap-2 border-b px-4">
          <UserMenu email={user.email} />
        </header>
        <main id="contenido" className="flex-1 p-4 md:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}

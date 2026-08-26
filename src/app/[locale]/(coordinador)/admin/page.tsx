import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/db/prisma";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Panel de administración.
 *
 * `requireAdmin()` corre en el servidor: aunque alguien escriba /admin a mano
 * sin ser ADMIN, la página falla antes de leer un solo dato. Esconder el ítem
 * del menú no protege nada por sí solo.
 *
 * La gestión de roles con escritura llega en la fase 6; esto es la lista en
 * solo lectura.
 */
export default async function AdminPage() {
  await requireAdmin();
  const t = await getTranslations("admin");

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      email: true,
      role: true,
      person: { select: { fullName: true } },
      _count: { select: { tripMemberships: true } },
    },
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-3xl font-semibold">{t("title")}</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl">
            {t("userCount", { count: users.length })}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-border divide-y">
            {users.map((user) => (
              <li
                key={user.id}
                className="flex min-h-14 flex-wrap items-center justify-between gap-2 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-base font-medium">
                    {user.person?.fullName ?? user.email}
                  </p>
                  {user.person?.fullName ? (
                    <p className="text-muted-foreground truncate text-sm">
                      {user.email}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-sm">
                    {t("tripCount", { count: user._count.tripMemberships })}
                  </span>
                  <Badge
                    variant={user.role === "ADMIN" ? "default" : "secondary"}
                  >
                    {user.role}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

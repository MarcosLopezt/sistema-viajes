import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/auth/guards";
import {
  AUDIT_PAGE_SIZE,
  listAuditActors,
  listAuditLog,
  listTripsForAssignment,
  listUsers,
} from "@/lib/services/admin";
import { formatDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UsersPanel } from "./users-panel";

/**
 * Panel de administración.
 *
 * `requireAdmin()` corre en el servidor: aunque alguien escriba /admin a mano
 * sin ser ADMIN, la página falla antes de leer un solo dato. Esconder el ítem
 * del menú no protege nada por sí solo.
 *
 * Dos pestañas y nada más: usuarios (rol global y pertenencia a viajes) y el
 * AuditLog con filtros. Sin métricas, sin gráficos, sin features inventadas.
 *
 * Los filtros del log viajan por querystring y el formulario es un `form` con
 * `method="get"`: se puede compartir el link de una búsqueda, funciona con el
 * botón de atrás y no necesita JavaScript. Un panel que se usa para
 * responder "¿quién tocó esto?" tiene que dar un link que sobreviva al mail.
 */
export default async function AdminPage({
  searchParams,
}: PageProps<"/[locale]/admin">) {
  const admin = await requireAdmin();
  const t = await getTranslations("admin");

  const params = await searchParams;
  const one = (key: string): string | undefined => {
    const value = params[key];
    const text = Array.isArray(value) ? value[0] : value;
    return text && text !== "" ? text : undefined;
  };

  const filters = {
    entity: one("entity"),
    actorUserId: one("actor"),
    from: one("from"),
    to: one("to"),
  };
  const page = Number.parseInt(one("page") ?? "0", 10) || 0;

  const [users, trips, audit, actors] = await Promise.all([
    listUsers(),
    listTripsForAssignment(),
    listAuditLog(filters, page),
    listAuditActors(),
  ]);

  const lastPage = Math.max(0, Math.ceil(audit.total / AUDIT_PAGE_SIZE) - 1);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <h1 className="text-3xl font-semibold">{t("title")}</h1>

      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users">
            {t("userCount", { count: users.length })}
          </TabsTrigger>
          <TabsTrigger value="audit">{t("auditTab")}</TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="pt-4">
          <UsersPanel
            users={users.map((user) => ({
              id: user.id,
              email: user.email,
              fullName: user.fullName,
              role: user.role,
              memberships: user.memberships,
            }))}
            trips={trips}
            currentUserId={admin.id}
          />
        </TabsContent>

        <TabsContent value="audit" className="space-y-4 pt-4">
          <Card>
            <CardContent className="py-4">
              <form method="get" className="flex flex-wrap items-end gap-3">
                <label className="space-y-1 text-sm">
                  <span className="block font-medium">{t("filterEntity")}</span>
                  <select
                    name="entity"
                    defaultValue={filters.entity ?? ""}
                    className="border-input bg-background h-11 rounded-lg border px-3 text-base"
                  >
                    <option value="">{t("filterAll")}</option>
                    {audit.entities.map((entity) => (
                      <option key={entity} value={entity}>
                        {entity}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1 text-sm">
                  <span className="block font-medium">{t("filterActor")}</span>
                  <select
                    name="actor"
                    defaultValue={filters.actorUserId ?? ""}
                    className="border-input bg-background h-11 rounded-lg border px-3 text-base"
                  >
                    <option value="">{t("filterAll")}</option>
                    {actors.map((actor) => (
                      <option key={actor.id} value={actor.id}>
                        {actor.fullName ?? actor.email}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1 text-sm">
                  <span className="block font-medium">{t("filterFrom")}</span>
                  <input
                    type="date"
                    name="from"
                    defaultValue={filters.from ?? ""}
                    className="border-input bg-background h-11 rounded-lg border px-3 text-base"
                  />
                </label>

                <label className="space-y-1 text-sm">
                  <span className="block font-medium">{t("filterTo")}</span>
                  <input
                    type="date"
                    name="to"
                    defaultValue={filters.to ?? ""}
                    className="border-input bg-background h-11 rounded-lg border px-3 text-base"
                  />
                </label>

                <Button type="submit">{t("filterApply")}</Button>
                <Button type="submit" name="entity" value="" variant="ghost">
                  {t("filterClear")}
                </Button>
              </form>
            </CardContent>
          </Card>

          <p className="text-muted-foreground text-sm">
            {t("auditCount", { count: audit.total })}
          </p>

          {audit.rows.length === 0 ? (
            <Card>
              <CardContent className="text-muted-foreground py-12 text-center text-base">
                {t("auditEmpty")}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="overflow-x-auto py-2">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-muted-foreground border-b text-left">
                      <th className="py-2 pr-3 font-medium">{t("colWhen")}</th>
                      <th className="py-2 pr-3 font-medium">{t("colWho")}</th>
                      <th className="py-2 pr-3 font-medium">{t("colWhat")}</th>
                      <th className="py-2 pr-3 font-medium">{t("colField")}</th>
                      <th className="py-2 font-medium">{t("colChange")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-border divide-y">
                    {audit.rows.map((row) => (
                      <tr key={row.id}>
                        <td className="py-2 pr-3 whitespace-nowrap tabular-nums">
                          {formatDateTime(row.createdAt)}
                        </td>
                        <td className="py-2 pr-3">
                          {row.actorName ?? row.actorEmail ?? t("actorSystem")}
                        </td>
                        <td className="py-2 pr-3">
                          <Badge variant="secondary">{row.entity}</Badge>
                          <span className="text-muted-foreground ml-2 font-mono text-xs">
                            {row.entityId.slice(0, 8)}
                          </span>
                        </td>
                        <td className="py-2 pr-3 font-mono text-xs">
                          {row.field}
                        </td>
                        <td className="py-2">
                          <span className="text-muted-foreground line-through">
                            {row.oldValue ?? "—"}
                          </span>
                          {" → "}
                          <span className="font-medium">
                            {row.newValue ?? "—"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          {lastPage > 0 ? (
            <div className="flex items-center justify-between gap-3">
              <PageLink
                page={page - 1}
                params={params}
                disabled={page === 0}
                label={t("prevPage")}
              />
              <span className="text-muted-foreground text-sm">
                {t("pageOf", { page: page + 1, total: lastPage + 1 })}
              </span>
              <PageLink
                page={page + 1}
                params={params}
                disabled={page >= lastPage}
                label={t("nextPage")}
              />
            </div>
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * Paginación como links, no como botones con JavaScript: el log se comparte
 * por mail y un link tiene que llevar a la misma página.
 */
function PageLink({
  page,
  params,
  disabled,
  label,
}: {
  page: number;
  params: Record<string, string | string[] | undefined>;
  disabled: boolean;
  label: string;
}) {
  if (disabled) {
    return (
      <span className="text-muted-foreground px-4 py-2 text-sm">{label}</span>
    );
  }

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "page" || key === "locale") continue;
    const text = Array.isArray(value) ? value[0] : value;
    if (text) query.set(key, text);
  }
  query.set("page", String(page));

  return (
    <Button asChild variant="outline">
      <a href={`?${query.toString()}`}>{label}</a>
    </Button>
  );
}

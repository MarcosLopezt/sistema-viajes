import { getTranslations } from "next-intl/server";
import { CalendarRange, Plus, Users } from "lucide-react";
import { requireSessionUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/db/prisma";
import { formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function TripsPage() {
  const user = await requireSessionUser();
  const t = await getTranslations("coordinatorHome");
  const tStatus = await getTranslations("tripStatus");

  // Un ADMIN ve todos los viajes; un coordinador, solo aquellos de los que es
  // miembro. El filtro se arma en la consulta, no descartando filas después.
  const trips = await prisma.trip.findMany({
    where:
      user.role === "ADMIN"
        ? {}
        : { members: { some: { userId: user.id, role: "COORDINADOR" } } },
    orderBy: { startDate: "desc" },
    select: {
      id: true,
      name: true,
      startDate: true,
      endDate: true,
      status: true,
      budgetedPassengers: true,
      _count: { select: { passengers: true } },
    },
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-semibold">{t("title")}</h1>
        {trips.length > 0 ? (
          <Button size="default" disabled>
            <Plus aria-hidden="true" />
            {t("emptyAction")}
          </Button>
        ) : null}
      </div>

      {trips.length === 0 ? (
        // Estado vacío con instrucción, no una tabla en blanco.
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-14 text-center">
            <CalendarRange
              className="text-muted-foreground size-10"
              aria-hidden="true"
            />
            <div className="space-y-1">
              <p className="text-xl font-medium">{t("emptyTitle")}</p>
              <p className="text-muted-foreground mx-auto max-w-md text-base text-balance">
                {t("emptyBody")}
              </p>
            </div>
            <Button size="lg" disabled>
              <Plus aria-hidden="true" />
              {t("emptyAction")}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {trips.map((trip) => (
            <li key={trip.id}>
              <Card className="h-full">
                <CardHeader className="gap-2">
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle className="text-xl">{trip.name}</CardTitle>
                    <Badge variant="secondary">{tStatus(trip.status)}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="text-muted-foreground space-y-2 text-base">
                  <p className="flex items-center gap-2">
                    <CalendarRange className="size-4" aria-hidden="true" />
                    {formatDate(trip.startDate)} — {formatDate(trip.endDate)}
                  </p>
                  <p className="flex items-center gap-2">
                    <Users className="size-4" aria-hidden="true" />
                    {t("passengerCount", {
                      count: trip._count.passengers,
                      budgeted: trip.budgetedPassengers,
                    })}
                  </p>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

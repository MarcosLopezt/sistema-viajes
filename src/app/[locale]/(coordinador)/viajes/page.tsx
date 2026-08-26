import { getTranslations } from "next-intl/server";
import { CalendarRange, Plus, Users } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { listTripsForViewer } from "@/lib/services/trip";
import { formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Listado de viajes.
 *
 * El alcance lo resuelve `listTripsForViewer()`: el ADMIN ve todos, el
 * coordinador solo aquellos donde tiene un TripMember, y un pasajero no ve
 * ninguno. El filtro va en la consulta, no en esta página.
 */
export default async function TripsPage() {
  const trips = await listTripsForViewer();
  const t = await getTranslations("coordinatorHome");
  const tStatus = await getTranslations("tripStatus");

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-semibold">{t("title")}</h1>
        {trips.length > 0 ? (
          <Button asChild>
            <Link href="/viajes/nuevo">
              <Plus aria-hidden="true" />
              {t("emptyAction")}
            </Link>
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
            <Button asChild size="lg">
              <Link href="/viajes/nuevo">
                <Plus aria-hidden="true" />
                {t("emptyAction")}
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {trips.map((trip) => (
            <li key={trip.id}>
              <Card className="hover:border-ring relative h-full transition-colors">
                <CardHeader className="gap-2">
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle className="text-xl">
                      <Link
                        href={`/viajes/${trip.id}`}
                        // El link cubre toda la tarjeta: en el celular el
                        // objetivo táctil es la tarjeta entera, no el texto.
                        className="after:absolute after:inset-0 focus-visible:outline-none"
                      >
                        {trip.name}
                      </Link>
                    </CardTitle>
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
                      count: trip.passengerCount,
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

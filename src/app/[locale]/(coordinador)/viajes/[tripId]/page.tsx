import { getLocale, getTranslations } from "next-intl/server";
import { CalendarRange, Megaphone, Pencil, Receipt, Users } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { ALLOWED_TRANSITIONS, getTripBudget } from "@/lib/services/trip";
import { countPassengersByStatus } from "@/lib/services/passengers";
import { getTripPaymentsOverview } from "@/lib/services/payments";
import { listCommunications } from "@/lib/services/communications";
import { formatDate, formatMoney, type LocaleCode } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PaymentLightBadge } from "@/components/payments/payment-badges";
import { TripStatusControl } from "./trip-status-control";

/**
 * Detalle del viaje.
 *
 * Las pestañas de pasajeros, pagos y comunicaciones existen pero están vacías:
 * llegan en las fases 3, 4 y 5. Se dejan visibles a propósito para que la
 * estructura de navegación no cambie después, cuando se llenen.
 */
export default async function TripDetailPage({
  params,
}: PageProps<"/[locale]/viajes/[tripId]">) {
  const { tripId } = await params;
  const locale = (await getLocale()) as LocaleCode;

  const [{ trip, breakdown, margin }, counts, payments, communications] =
    await Promise.all([
      getTripBudget(tripId),
      countPassengersByStatus(tripId),
      getTripPaymentsOverview(tripId),
      listCommunications(tripId),
    ]);

  const t = await getTranslations("budget.detail");
  const tPanel = await getTranslations("budget.panel");
  const tPrices = await getTranslations("budget.prices");
  const tPassengers = await getTranslations("passengers");
  const tInterests = await getTranslations("interests");
  const tPaymentsAdmin = await getTranslations("paymentsAdmin");
  const tCommunications = await getTranslations("communications");

  const money = (value: string) => formatMoney(value, trip.currency, locale);
  const confirmed = counts["CONFIRMADO"] ?? 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold">{trip.name}</h1>
          <p className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-base">
            <span className="flex items-center gap-2">
              <CalendarRange className="size-4" aria-hidden="true" />
              {t("dates", {
                from: formatDate(trip.startDate),
                to: formatDate(trip.endDate),
              })}
            </span>
            <span className="flex items-center gap-2">
              <Users className="size-4" aria-hidden="true" />
              {confirmed} / {trip.budgetedPassengers}
            </span>
          </p>
        </div>
        <TripStatusControl
          tripId={trip.id}
          status={trip.status}
          allowedTransitions={ALLOWED_TRANSITIONS[trip.status]}
        />
      </div>

      <Tabs defaultValue="budget">
        <TabsList>
          <TabsTrigger value="budget">{t("tabBudget")}</TabsTrigger>
          <TabsTrigger value="passengers">{t("tabPassengers")}</TabsTrigger>
          <TabsTrigger value="payments">{t("tabPayments")}</TabsTrigger>
          <TabsTrigger value="communications">
            {t("tabCommunications")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="budget" className="space-y-5 pt-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <SummaryCard
              label={tPanel("costDouble")}
              cost={money(breakdown.totalDouble)}
              price={trip.priceDouble ? money(trip.priceDouble) : null}
              margin={
                margin.perPassengerDouble
                  ? money(margin.perPassengerDouble.margin)
                  : null
              }
              percent={margin.perPassengerDouble?.marginPercent ?? null}
              marginLabel={tPanel("margin")}
              noPriceLabel={tPanel("noPriceYet")}
            />
            <SummaryCard
              label={tPanel("costSingle")}
              cost={money(breakdown.totalSingle)}
              price={trip.priceSingle ? money(trip.priceSingle) : null}
              margin={
                margin.perPassengerSingle
                  ? money(margin.perPassengerSingle.margin)
                  : null
              }
              percent={margin.perPassengerSingle?.marginPercent ?? null}
              marginLabel={tPanel("margin")}
              noPriceLabel={tPanel("noPriceYet")}
            />
          </div>

          {margin.totals.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">
                  {tPrices("totalMargin")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {margin.totals.map((total, index) => (
                    <li
                      key={index}
                      className="flex flex-wrap items-baseline justify-between gap-2"
                    >
                      {/* El margen total nunca aparece sin decir sobre qué
                          mix está calculado. */}
                      <span className="text-muted-foreground text-sm text-balance">
                        {total.basis.kind === "CONFIRMADOS"
                          ? tPrices("basisConfirmed", {
                              count:
                                total.basis.doubleCount +
                                total.basis.singleCount,
                              double: total.basis.doubleCount,
                              single: total.basis.singleCount,
                            })
                          : total.basis.scenario === "TODOS_DOBLE"
                            ? tPrices("basisScenarioDouble", {
                                count: total.basis.passengerCount,
                              })
                            : tPrices("basisScenarioSingle", {
                                count: total.basis.passengerCount,
                              })}
                      </span>
                      <span className="text-lg font-semibold tabular-nums">
                        {money(total.margin)}
                        <span className="text-muted-foreground ml-2 text-sm font-normal">
                          {total.marginPercent}%
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          <Button asChild>
            <Link href={`/viajes/${trip.id}/presupuesto`}>
              <Pencil aria-hidden="true" />
              {t("editBudget")}
            </Link>
          </Button>
        </TabsContent>

        <TabsContent value="passengers" className="space-y-4 pt-5">
          <Card>
            <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
              <Users className="text-muted-foreground size-8" aria-hidden="true" />
              <p className="text-base">
                {confirmed} / {trip.budgetedPassengers}
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button asChild size="lg">
                  <Link href={`/viajes/${trip.id}/pasajeros`}>
                    {tPassengers("title")}
                  </Link>
                </Button>
                {/* El embudo vive al lado de las pasajeras y no en una pestaña
                    propia porque es el paso ANTERIOR al mismo hecho: una
                    interesada que avanza termina en esa lista. */}
                <Button asChild size="lg" variant="outline">
                  <Link href={`/viajes/${trip.id}/interesadas`}>
                    {tInterests("title")}
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payments" className="space-y-4 pt-5">
          <Card>
            <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
              <Receipt className="text-muted-foreground size-8" aria-hidden="true" />
              <p className="text-base tabular-nums">
                {tPaymentsAdmin("collectedOf", {
                  collected: money(payments.collected),
                  expected: money(payments.expected),
                })}
              </p>
              <PaymentLightBadge light={payments.light} />
              <Button asChild size="lg">
                <Link href={`/viajes/${trip.id}/pagos`}>
                  {tPaymentsAdmin("title")}
                </Link>
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="communications" className="pt-5">
          <Card>
            <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
              <Megaphone
                className="text-muted-foreground size-8"
                aria-hidden="true"
              />
              <p className="text-base">
                {tCommunications("counts", {
                  sent: communications.filter((c) => c.status === "ENVIADA")
                    .length,
                  total: communications.length,
                })}
              </p>
              <Button asChild size="lg">
                <Link href={`/viajes/${trip.id}/comunicaciones`}>
                  {tCommunications("title")}
                </Link>
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SummaryCard({
  label,
  cost,
  price,
  margin,
  percent,
  marginLabel,
  noPriceLabel,
}: {
  label: string;
  cost: string;
  price: string | null;
  margin: string | null;
  percent: string | null;
  marginLabel: string;
  noPriceLabel: string;
}) {
  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle className="text-muted-foreground text-sm font-medium">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <p className="text-2xl font-semibold tabular-nums">{price ?? cost}</p>
        {price ? (
          <p className="text-muted-foreground text-sm tabular-nums">
            {cost} · {marginLabel} {margin} ({percent}%)
          </p>
        ) : (
          <p className="text-muted-foreground text-sm">{noPriceLabel}</p>
        )}
      </CardContent>
    </Card>
  );
}

import { getLocale, getTranslations } from "next-intl/server";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { requireCapability } from "@/lib/auth/guards";
import { prisma } from "@/lib/db/prisma";
import {
  getTripPaymentsOverview,
  listPendingReviews,
} from "@/lib/services/payments";
import { formatDate, formatMoney, type LocaleCode } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PaymentLightBadge } from "@/components/payments/payment-badges";
import { ReviewQueue, type ReviewItem } from "./review-queue";

/**
 * Pagos del viaje, para el coordinador.
 *
 * Dos pestañas: el estado de todos los pasajeros y la cola de comprobantes
 * esperando revisión. Arriba, lo único que se mira todos los días: cuánto se
 * recaudó contra cuánto se espera.
 *
 * El semáforo de cada fila sale de la misma función pura que la ficha
 * individual. Ver src/lib/domain/payments.ts.
 */
export default async function TripPaymentsPage({
  params,
}: PageProps<"/[locale]/viajes/[tripId]/pagos">) {
  const { tripId } = await params;
  await requireCapability(tripId, "payment:review");

  const locale = (await getLocale()) as LocaleCode;

  const [trip, overview, pending, t, tPayments] = await Promise.all([
    prisma.trip.findUniqueOrThrow({
      where: { id: tripId },
      select: { id: true, name: true },
    }),
    getTripPaymentsOverview(tripId),
    listPendingReviews(tripId),
    getTranslations("paymentsAdmin"),
    getTranslations("payments"),
  ]);

  const money = (value: string) => formatMoney(value, overview.currency, locale);

  const queue: ReviewItem[] = pending.map((item) => ({
    paymentId: item.paymentId,
    passengerId: item.passengerId,
    passengerName: item.passengerName,
    installmentNumber: item.installmentNumber,
    installmentAmountLabel: item.installmentAmount
      ? money(item.installmentAmount)
      : null,
    amount: item.amount,
    currency: item.currency,
    tripCurrency: item.tripCurrency,
    provisionalAmountLabel: money(item.provisionalAmountInTripCurrency),
    suggestedFxRate: item.suggestedFxRate,
    transferDateLabel: formatDate(item.transferDate),
    hasProof: item.proofFileId !== null,
  }));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-2">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/viajes/${trip.id}`}>
            <ArrowLeft aria-hidden="true" />
            {trip.name}
          </Link>
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold">{t("title")}</h1>
          <PaymentLightBadge light={overview.light} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard
          label={t("collected")}
          value={money(overview.collected)}
          detail={t("collectedOf", {
            collected: money(overview.collected),
            expected: money(overview.expected),
          })}
        />
        <SummaryCard
          label={t("underReviewTotal")}
          value={money(overview.underReview)}
          detail={t("queueCount", { count: pending.length })}
        />
        <SummaryCard
          label={t("expected")}
          value={money(overview.expected)}
          detail={t("withoutPlan", { count: overview.passengersWithoutPlan })}
        />
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">{t("tabOverview")}</TabsTrigger>
          <TabsTrigger value="queue">{t("tabQueue")}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="pt-5">
          {overview.rows.length === 0 ? (
            <Card>
              <CardContent className="text-muted-foreground py-12 text-center text-base">
                {t("empty")}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader className="gap-1">
                <CardTitle className="text-lg">{t("tabOverview")}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="divide-border divide-y">
                  {overview.rows.map((row) => (
                    <li key={row.passengerId}>
                      <Link
                        href={`/viajes/${trip.id}/pagos/${row.passengerId}`}
                        className="hover:bg-muted/50 -mx-2 flex flex-wrap items-center gap-3 rounded-lg px-2 py-3 transition-colors"
                      >
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <p className="text-base font-medium">
                            {row.fullName}
                          </p>
                          <p className="text-muted-foreground text-sm">
                            {row.hasPlan && row.nextDueDate
                              ? `${t("columnNext")}: ${tPayments("installment", {
                                  number: row.nextInstallmentNumber ?? 0,
                                })} · ${formatDate(row.nextDueDate)}`
                              : row.hasPlan
                                ? tPayments("light.VERDE")
                                : t("noPlanYet")}
                          </p>
                        </div>

                        <div className="text-right">
                          <p className="text-base font-semibold tabular-nums">
                            {row.hasPlan ? money(row.balance) : "—"}
                          </p>
                          {row.hasPlan ? (
                            <p className="text-muted-foreground text-sm tabular-nums">
                              {t("columnPaid")} {money(row.paidTotal)}
                            </p>
                          ) : null}
                        </div>

                        <PaymentLightBadge light={row.light} />
                        <ChevronRight
                          className="text-muted-foreground size-5 shrink-0"
                          aria-hidden="true"
                        />
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="queue" className="pt-5">
          <ReviewQueue tripId={trip.id} items={queue} locale={locale} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle className="text-muted-foreground text-sm font-medium">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        <p className="text-muted-foreground text-sm">{detail}</p>
      </CardContent>
    </Card>
  );
}

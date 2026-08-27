import { getLocale, getTranslations } from "next-intl/server";
import { ArrowLeft, FileText } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { requireCapability } from "@/lib/auth/guards";
import { getPassengerForPayments } from "@/lib/services/passengers";
import { getPaymentPlan } from "@/lib/services/payments";
import { formatDate, formatMoney, type LocaleCode } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  InstallmentStateBadge,
  PaymentLightBadge,
  PaymentStatusBadge,
} from "@/components/payments/payment-badges";
import { PlanEditor } from "./plan-editor";
import { RefundForm, RevertPaymentButton } from "./payment-actions";

/**
 * Ficha de pagos de un pasajero, para el coordinador.
 *
 * Es donde se arma el plan, se ve el estado de cada cuota y se deshace una
 * confirmación equivocada. El estado de las cuotas sale de la misma
 * `derivePlan()` que ve el pasajero: los dos miran exactamente el mismo
 * número.
 */
export default async function PassengerPaymentsPage({
  params,
}: PageProps<"/[locale]/viajes/[tripId]/pagos/[passengerId]">) {
  const { tripId, passengerId } = await params;
  await requireCapability(tripId, "payment:review");

  const locale = (await getLocale()) as LocaleCode;

  const [passenger, plan, t, tPayments] = await Promise.all([
    getPassengerForPayments(passengerId),
    getPaymentPlan(passengerId),
    getTranslations("paymentsAdmin"),
    getTranslations("payments"),
  ]);

  const currency = passenger.trip.currency;
  const money = (value: string) => formatMoney(value, currency, locale);
  const name = passenger.fullName ?? "";

  // Por qué NO se puede generar plan. Se resuelve acá, en el servidor, con los
  // mismos criterios que aplica el servicio: el editor solo muestra el aviso.
  const disabledReason = passenger.isCoordinator
    ? t("planCoordinator")
    : passenger.status === "CANCELADO"
      ? t("planCancelled")
      : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-2">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/viajes/${tripId}/pagos`}>
            <ArrowLeft aria-hidden="true" />
            {t("title")}
          </Link>
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold">
            {t("paymentsOf", { name })}
          </h1>
          {plan ? <PaymentLightBadge light={plan.light} /> : null}
        </div>
      </div>

      {plan ? (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Figure label={tPayments("total")} value={money(plan.totalAmount)} />
            <Figure label={tPayments("paid")} value={money(plan.paidTotal)} />
            <Figure label={tPayments("balance")} value={money(plan.balance)} />
          </div>

          {Number(plan.credit) > 0 || Number(plan.refundedTotal) > 0 ? (
            <p className="text-muted-foreground text-sm">
              {Number(plan.credit) > 0
                ? `${tPayments("credit")}: ${money(plan.credit)}`
                : null}
              {Number(plan.credit) > 0 && Number(plan.refundedTotal) > 0
                ? " · "
                : null}
              {Number(plan.refundedTotal) > 0
                ? `${tPayments("refunded")}: ${money(plan.refundedTotal)}`
                : null}
            </p>
          ) : null}

          <Card>
            <CardHeader className="gap-1">
              <CardTitle className="text-lg">{t("planPreview")}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-border divide-y">
                {plan.installments.map((cuota) => (
                  <li
                    key={cuota.id}
                    className="flex flex-wrap items-center gap-3 py-3"
                  >
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="text-base font-medium">
                        {tPayments("installmentOf", {
                          number: cuota.number,
                          total: plan.installments.length,
                        })}
                      </p>
                      <p className="text-muted-foreground text-sm">
                        {cuota.overdue
                          ? tPayments("overdueSince", {
                              date: formatDate(cuota.dueDate),
                            })
                          : tPayments("dueOn", {
                              date: formatDate(cuota.dueDate),
                            })}
                      </p>
                    </div>
                    <p className="text-base font-semibold tabular-nums">
                      {money(cuota.amount)}
                    </p>
                    <InstallmentStateBadge
                      state={
                        cuota.state as
                          | "PAGADA"
                          | "VENCIDA"
                          | "EN_REVISION"
                          | "PENDIENTE"
                          | "CONGELADA"
                      }
                    />
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="gap-1">
              <CardTitle className="text-lg">
                {t("paymentsOf", { name })}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-border divide-y">
                {plan.payments.map((payment) => (
                  <li key={payment.id} className="space-y-1.5 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-base font-medium tabular-nums">
                        {formatMoney(payment.amount, payment.currency, locale)}
                        {payment.currency !== currency ? (
                          <span className="text-muted-foreground ml-2 text-sm font-normal">
                            → {money(payment.amountInTripCurrency)}
                            {payment.fxRateUsed
                              ? ` · ${payment.fxRateUsed}`
                              : ""}
                            {/* De dónde salió ese TC. Sin esto no se puede
                                saber si el número es de mercado o del banco,
                                y al conciliar la diferencia importa. Los
                                pagos anteriores al campo no lo tienen. */}
                            {payment.fxRateUsed
                              ? ` (${
                                  payment.fxRateSource
                                    ? tPayments(
                                        `fxSource.${payment.fxRateSource}`,
                                      )
                                    : tPayments("fxSourceLegacy")
                                })`
                              : ""}
                          </span>
                        ) : null}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="text-muted-foreground text-sm">
                          {tPayments(`kinds.${payment.kind}`)}
                        </span>
                        <PaymentStatusBadge status={payment.status} />
                      </span>
                    </div>

                    <p className="text-muted-foreground text-sm">
                      {tPayments("transferredOn", {
                        date: formatDate(payment.transferDate),
                      })}
                      {payment.reviewedAt
                        ? ` · ${tPayments("reviewedOn", {
                            date: formatDate(payment.reviewedAt),
                          })}`
                        : ""}
                    </p>

                    {payment.notes ? (
                      <p className="text-muted-foreground text-sm">
                        {payment.notes}
                      </p>
                    ) : null}

                    <div className="flex flex-wrap gap-2">
                      {payment.proofFileId ? (
                        <Button
                          asChild
                          variant="link"
                          size="sm"
                          className="px-0"
                        >
                          <a
                            href={`/api/comprobantes/${payment.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <FileText aria-hidden="true" />
                            {tPayments("viewProof")}
                          </a>
                        </Button>
                      ) : null}

                      {payment.kind === "PAGO" &&
                      payment.status === "CONFIRMADO" ? (
                        <RevertPaymentButton
                          tripId={tripId}
                          passengerId={passengerId}
                          paymentId={payment.id}
                        />
                      ) : null}
                    </div>
                  </li>
                ))}
                {plan.payments.length === 0 ? (
                  <li className="text-muted-foreground py-3 text-base">
                    {tPayments("noProof")}
                  </li>
                ) : null}
              </ul>
            </CardContent>
          </Card>

          <RefundForm tripId={tripId} passengerId={passengerId} />
        </>
      ) : null}

      <PlanEditor
        tripId={tripId}
        passengerId={passengerId}
        passengerName={name}
        currency={currency}
        locale={locale}
        initialCount={plan?.installments.length ?? 3}
        disabledReason={disabledReason}
      />
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle className="text-muted-foreground text-sm font-medium">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}

import { getLocale, getTranslations } from "next-intl/server";
import { ArrowLeft, FileText, Snowflake } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { requireSessionUser } from "@/lib/auth/guards";
import { getMyActivePassenger } from "@/lib/services/passengers";
import { getPaymentPlan } from "@/lib/services/payments";
import { formatDate, formatMoney, type LocaleCode } from "@/lib/format";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PaymentStatusBadge } from "@/components/payments/payment-badges";
import { PlainText } from "@/components/public/plain-text";
import { PaymentsPanel, type InstallmentView } from "./payments-panel";

/**
 * "Mis pagos" del pasajero.
 *
 * ── La regla de diseño de esta pantalla ───────────────────────────────────
 *
 * Tiene que responder UNA pregunta sin que haga falta scrollear: cuánto debo y
 * cuándo. Eso es lo único que está arriba del pliegue. El desglose de cuotas,
 * las equivalencias y el historial de comprobantes son secundarios y viven
 * abajo, en ese orden.
 *
 * Los importes llevan SIEMPRE el símbolo de la moneda. Con tres monedas en
 * juego, "1.200" es un error esperando a pasar.
 */
export default async function MyPaymentsPage() {
  await requireSessionUser();

  const locale = (await getLocale()) as LocaleCode;
  const [t, tPayments] = await Promise.all([
    getTranslations("myPayments"),
    getTranslations("payments"),
  ]);

  const passenger = await getMyActivePassenger();
  if (!passenger) {
    return <EmptyState title={t("noPlanTitle")} body={t("noPlanBody")} />;
  }

  const plan = await getPaymentPlan(passenger.id, new Date(), locale);
  if (!plan) {
    return <EmptyState title={t("noPlanTitle")} body={t("noPlanBody")} />;
  }

  const money = (value: string) => formatMoney(value, plan.currency, locale);

  const installments: InstallmentView[] = plan.installments.map((cuota) => ({
    id: cuota.id,
    number: cuota.number,
    amount: cuota.amount,
    paid: cuota.paid,
    remaining: cuota.remaining,
    state: cuota.state as InstallmentView["state"],
    hasPendingProof: cuota.hasPendingProof,
    dueDateLabel: formatDate(cuota.dueDate),
  }));

  const next = plan.nextInstallment;

  return (
    <div className="space-y-5 py-2">
      <Button asChild variant="ghost" className="-ml-2">
        <Link href="/inicio">
          <ArrowLeft aria-hidden="true" />
          {t("backHome")}
        </Link>
      </Button>

      {plan.frozen ? (
        <Alert>
          <Snowflake className="size-5" aria-hidden="true" />
          <AlertTitle>{t("frozenTitle")}</AlertTitle>
          <AlertDescription>{t("frozenBody")}</AlertDescription>
        </Alert>
      ) : null}

      {/* ── La pregunta ──────────────────────────────────────────────── */}
      <Card>
        <CardContent className="space-y-3 py-6">
          <p className="text-muted-foreground text-base">
            {next ? t("youOwe") : t("nothingDue")}
          </p>

          <p className="text-4xl font-semibold tabular-nums">
            {money(plan.balance)}
          </p>

          {next ? (
            <p className="text-lg">
              {t("nextDue", {
                label: `${tPayments("installment", { number: next.number })} · ${money(next.remaining)} · ${
                  next.overdue
                    ? tPayments("overdueSince", {
                        date: formatDate(next.dueDate),
                      })
                    : tPayments("dueOn", { date: formatDate(next.dueDate) })
                }`,
              })}
            </p>
          ) : null}

          <p className="text-muted-foreground text-sm">
            {tPayments("total")} {money(plan.totalAmount)} ·{" "}
            {tPayments("paid")} {money(plan.paidTotal)}
          </p>
        </CardContent>
      </Card>

      {/* Equivalencias: SIEMPRE con la fecha de la cotización al lado. Un
          importe convertido sin decir de cuándo es el TC induce a error, y
          esta cotización quedó congelada al crear el plan: no se mueve. */}
      <p className="text-muted-foreground text-sm">
        {plan.balanceEquivalences
          .map((eq) => formatMoney(eq.amount, eq.currency, locale))
          .join(" · ")}
        {" — "}
        {tPayments("rateNote", { date: formatDate(plan.fxSnapshotDate) })}
      </p>

      {/* ── DÓNDE pagar ──────────────────────────────────────────────────
          Hasta la fase 8 esta pantalla decía cuánto se debe y no dónde
          pagarlo, así que la pasajera tenía que ir a buscar la cuenta a un
          WhatsApp de hace tres meses. Va inmediatamente después del saldo y
          antes del desglose: es lo segundo que necesita, después de saber
          cuánto.

          El texto lo escriben las coordinadoras y puede estar pisado por uno
          propio de la pasajera — las cuentas cambian según el país. Cuál de
          los dos manda se decide en el servicio, no acá. */}
      {plan.paymentInstructions ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t("whereToPay")}</CardTitle>
          </CardHeader>
          <CardContent>
            <PlainText text={plan.paymentInstructions} className="text-base" />
          </CardContent>
        </Card>
      ) : null}

      {Number(plan.credit) > 0 ? (
        <Alert>
          <AlertTitle>
            {tPayments("credit")} {money(plan.credit)}
          </AlertTitle>
          <AlertDescription>{tPayments("creditHelp")}</AlertDescription>
        </Alert>
      ) : null}

      <PaymentsPanel
        passengerId={passenger.id}
        installments={installments}
        currency={plan.currency}
        locale={locale}
        frozen={plan.frozen}
        nextInstallmentId={next?.id ?? null}
      />

      {/* ── Historial ────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="gap-1">
          <CardTitle className="text-lg">{t("historyTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {plan.payments.length === 0 ? (
            <p className="text-muted-foreground text-base">
              {t("historyEmpty")}
            </p>
          ) : (
            <ul className="divide-border divide-y">
              {plan.payments.map((payment) => (
                <li key={payment.id} className="space-y-1.5 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-base font-medium tabular-nums">
                      {formatMoney(payment.amount, payment.currency, locale)}
                      {payment.installmentNumber !== null ? (
                        <span className="text-muted-foreground ml-2 text-sm font-normal">
                          {tPayments("installment", {
                            number: payment.installmentNumber,
                          })}
                        </span>
                      ) : null}
                    </span>
                    <PaymentStatusBadge status={payment.status} />
                  </div>

                  <p className="text-muted-foreground text-sm">
                    {tPayments("transferredOn", {
                      date: formatDate(payment.transferDate),
                    })}
                  </p>

                  {payment.status === "EN_REVISION" ? (
                    <p className="text-muted-foreground text-sm">
                      {t("inReviewNote")}
                    </p>
                  ) : null}

                  {/* El motivo del rechazo se muestra tal cual lo escribió el
                      coordinador. "Rechazado" a secas no es información. */}
                  {payment.status === "RECHAZADO" && payment.notes ? (
                    <p className="text-status-danger text-sm">
                      {t("rejectedReason", { reason: payment.notes })}
                    </p>
                  ) : null}

                  {payment.proofFileId ? (
                    <Button asChild variant="link" className="px-0">
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
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="space-y-4 py-10 text-center">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-muted-foreground text-base">{body}</p>
    </div>
  );
}

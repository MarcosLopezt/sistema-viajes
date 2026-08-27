"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, FileText, Loader2, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field } from "@/components/form/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney, type CurrencyCode, type LocaleCode } from "@/lib/format";
import { toDecimal } from "@/lib/domain/money";
import { confirmPaymentAction, rejectPaymentAction } from "./actions";

/**
 * Cola de comprobantes por revisar.
 *
 * Cada fila muestra las tres cosas que hacen falta para decidir: el
 * comprobante, lo que el pasajero declaró y a qué cuota se imputa. Si la
 * moneda difiere de la del viaje aparece el campo de tipo de cambio, con la
 * cotización del día PRECARGADA como sugerencia — sugerencia, no valor: el que
 * vale es el del extracto bancario, y son números distintos.
 */

export interface ReviewItem {
  paymentId: string;
  passengerId: string;
  passengerName: string | null;
  installmentNumber: number | null;
  installmentAmountLabel: string | null;
  amount: string;
  currency: CurrencyCode;
  tripCurrency: CurrencyCode;
  provisionalAmountLabel: string;
  suggestedFxRate: string | null;
  transferDateLabel: string;
  hasProof: boolean;
}

export function ReviewQueue({
  tripId,
  items,
  locale,
}: {
  tripId: string;
  items: ReviewItem[];
  locale: LocaleCode;
}) {
  const t = useTranslations("paymentsAdmin");

  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="text-muted-foreground py-12 text-center text-base">
          {t("queueEmpty")}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        {t("queueCount", { count: items.length })}
      </p>
      {items.map((item) => (
        <ReviewCard
          key={item.paymentId}
          tripId={tripId}
          item={item}
          locale={locale}
        />
      ))}
    </div>
  );
}

function ReviewCard({
  tripId,
  item,
  locale,
}: {
  tripId: string;
  item: ReviewItem;
  locale: LocaleCode;
}) {
  const t = useTranslations("paymentsAdmin");
  const tPayments = useTranslations("payments");
  const tCommon = useTranslations("common");

  const needsRate = item.currency !== item.tripCurrency;
  const [fxRate, setFxRate] = useState(item.suggestedFxRate ?? "");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // El importe imputado se calcula en vivo con la MISMA aritmética decimal que
  // usa el servidor: lo que el coordinador ve antes de apretar es exactamente
  // lo que se va a guardar.
  const computed = (() => {
    if (!needsRate) return item.amount;
    const rate = toDecimal(fxRate || "0");
    if (!rate.isFinite() || rate.lessThanOrEqualTo(0)) return null;
    return toDecimal(item.amount).times(rate).toDecimalPlaces(2).toFixed(2);
  })();

  async function confirm() {
    setBusy(true);
    setError(null);

    const result = await confirmPaymentAction(tripId, {
      paymentId: item.paymentId,
      fxRateUsed: needsRate ? fxRate.trim() : null,
      notes: null,
    });

    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage(
      result.data === "YA_RESUELTO" ? t("reviewAlreadyResolved") : null,
    );
  }

  async function reject() {
    setBusy(true);
    setError(null);

    const result = await rejectPaymentAction(tripId, {
      paymentId: item.paymentId,
      reason: reason.trim(),
    });

    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage(
      result.data === "YA_RESUELTO" ? t("reviewAlreadyResolved") : null,
    );
    setRejecting(false);
  }

  return (
    <Card>
      <CardContent className="space-y-4 py-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div className="space-y-0.5">
            <p className="text-base font-medium">{item.passengerName}</p>
            <p className="text-muted-foreground text-sm">
              {item.installmentNumber !== null
                ? t("reviewImputedTo", {
                    installment: `${tPayments("installment", {
                      number: item.installmentNumber,
                    })}${
                      item.installmentAmountLabel
                        ? ` · ${item.installmentAmountLabel}`
                        : ""
                    }`,
                  })
                : t("reviewNoInstallment")}
            </p>
            <p className="text-muted-foreground text-sm">
              {tPayments("transferredOn", { date: item.transferDateLabel })}
            </p>
          </div>

          <div className="space-y-1 text-right">
            <p className="text-xl font-semibold tabular-nums">
              {t("reviewDeclared", {
                amount: formatMoney(item.amount, item.currency, locale),
              })}
            </p>
            {item.hasProof ? (
              <Button asChild variant="outline" size="sm">
                <a
                  href={`/api/comprobantes/${item.paymentId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <FileText aria-hidden="true" />
                  {tPayments("viewProof")}
                </a>
              </Button>
            ) : (
              <p className="text-muted-foreground text-sm">
                {tPayments("noProof")}
              </p>
            )}
          </div>
        </div>

        {needsRate ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t("reviewFxRate")}
              help={t("reviewFxHelp")}
              required
            >
              {(props) => (
                <Input
                  {...props}
                  inputMode="decimal"
                  value={fxRate}
                  onChange={(event) => setFxRate(event.target.value)}
                />
              )}
            </Field>
            <div className="space-y-1 self-start pt-7">
              <p className="text-muted-foreground text-sm">
                {t("reviewFxSuggested", {
                  rate: item.suggestedFxRate ?? "—",
                })}
              </p>
              <p className="text-base font-medium tabular-nums">
                {computed === null
                  ? "—"
                  : t("reviewComputed", {
                      amount: formatMoney(
                        computed,
                        item.tripCurrency,
                        locale,
                      ),
                    })}
              </p>
            </div>
          </div>
        ) : null}

        {rejecting ? (
          <Field
            label={t("reviewRejectReason")}
            help={t("reviewRejectHelp")}
            required
          >
            {(props) => (
              <Textarea
                {...props}
                rows={3}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            )}
          </Field>
        ) : null}

        {error ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {message ? (
          <Alert role="status">
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {rejecting ? (
            <>
              <Button
                variant="destructive"
                disabled={busy || reason.trim().length < 5}
                onClick={reject}
              >
                {busy ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <X aria-hidden="true" />
                )}
                {t("reviewRejectConfirm")}
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => setRejecting(false)}
              >
                {tCommon("cancel")}
              </Button>
            </>
          ) : (
            <>
              <Button
                disabled={busy || (needsRate && computed === null)}
                onClick={confirm}
              >
                {busy ? (
                  <>
                    <Loader2 className="animate-spin" aria-hidden="true" />
                    {t("reviewConfirming")}
                  </>
                ) : (
                  <>
                    <Check aria-hidden="true" />
                    {t("reviewConfirm")}
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setRejecting(true)}
              >
                <X aria-hidden="true" />
                {t("reviewReject")}
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

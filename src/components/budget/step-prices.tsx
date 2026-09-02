"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, TrendingUp } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney, type CurrencyCode, type LocaleCode } from "@/lib/format";
import {
  calculateTripMargin,
  type TripCostBreakdown,
} from "@/lib/domain/pricing";
import { Field } from "@/components/form/field";
import type { WizardPassengerMix } from "./types";

/**
 * Paso 5 — revisión y precios.
 *
 * Dos cosas que son criterios de aceptación, no decoración:
 *
 *  1. Antes de guardar se muestra el IMPACTO del cambio, en términos de lo que
 *     le cambia al pasajero: "el precio pasa de £3.990 a £4.100".
 *
 *  2. El margen total NUNCA se muestra como un número suelto. Depende del mix
 *     single/doble, y hasta que no haya confirmados ese mix no se conoce: se
 *     muestran los dos extremos, cada uno diciendo sobre qué está calculado.
 */
export function StepPrices({
  breakdown,
  currency,
  budgetedPassengers,
  passengerMix,
  savedPriceDouble,
  savedPriceSingle,
  savedDepositAmount,
  savedInstallmentCount,
  savedIntervalMonths,
  passengersWithActivePlan,
  disabled,
  onSave,
}: {
  breakdown: TripCostBreakdown;
  currency: CurrencyCode;
  budgetedPassengers: number;
  passengerMix: WizardPassengerMix[];
  savedPriceDouble: string | null;
  savedPriceSingle: string | null;
  savedDepositAmount: string | null;
  savedInstallmentCount: number;
  savedIntervalMonths: number;
  /** Cuántos pasajeros ya tienen un plan de pagos generado. */
  passengersWithActivePlan: number;
  disabled?: boolean;
  onSave: (prices: {
    priceDouble: string;
    priceSingle: string;
    depositAmount: string | null;
    defaultInstallmentCount: number;
    installmentIntervalMonths: number;
  }) => Promise<{ ok: boolean; error?: string }>;
}) {
  const t = useTranslations("budget.prices");
  const locale = useLocale() as LocaleCode;

  const [priceDouble, setPriceDouble] = useState(savedPriceDouble ?? "");
  const [priceSingle, setPriceSingle] = useState(savedPriceSingle ?? "");
  const [depositAmount, setDepositAmount] = useState(savedDepositAmount ?? "");
  const [installmentCount, setInstallmentCount] = useState(
    String(savedInstallmentCount),
  );
  const [intervalMonths, setIntervalMonths] = useState(
    String(savedIntervalMonths),
  );
  const [error, setError] = useState<string | null>(null);

  const money = (value: string) => formatMoney(value, currency, locale);

  // El margen se recalcula en vivo con lo que el coordinador está tipeando,
  // no con lo guardado: la idea es que vea el efecto antes de confirmar.
  const margin = useMemo(() => {
    const valid = (value: string) =>
      value.trim() !== "" && Number.isFinite(Number(value));

    return calculateTripMargin(
      breakdown,
      {
        priceDouble: valid(priceDouble) ? priceDouble : null,
        priceSingle: valid(priceSingle) ? priceSingle : null,
      },
      passengerMix,
      budgetedPassengers,
    );
  }, [breakdown, priceDouble, priceSingle, passengerMix, budgetedPassengers]);

  const priceChanged =
    (savedPriceDouble ?? "") !== priceDouble ||
    (savedPriceSingle ?? "") !== priceSingle;

  const hasSavedPrices = savedPriceDouble !== null || savedPriceSingle !== null;

  return (
    <form
      className="space-y-6"
      onSubmit={async (event) => {
        event.preventDefault();
        const result = await onSave({
          priceDouble,
          priceSingle,
          depositAmount: depositAmount.trim() || null,
          defaultInstallmentCount: Number(installmentCount),
          installmentIntervalMonths: Number(intervalMonths),
        });
        if (!result.ok) setError(result.error ?? null);
        else setError(null);
      }}
    >
      <p className="text-muted-foreground text-base text-balance">
        {t("intro")}
      </p>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label={t("priceDouble")}
          help={t("costIs", { amount: money(breakdown.totalDouble.toString()) })}
          error={error ?? undefined}
          required
        >
          {(props) => (
            <Input
              {...props}
              inputMode="decimal"
              placeholder="0.00"
              value={priceDouble}
              disabled={disabled}
              onChange={(e) => setPriceDouble(e.target.value)}
              required
            />
          )}
        </Field>

        <Field
          label={t("priceSingle")}
          help={t("costIs", { amount: money(breakdown.totalSingle.toString()) })}
          required
        >
          {(props) => (
            <Input
              {...props}
              inputMode="decimal"
              placeholder="0.00"
              value={priceSingle}
              disabled={disabled}
              onChange={(e) => setPriceSingle(e.target.value)}
              required
            />
          )}
        </Field>
      </div>

      {/* La seña va acá y no en el paso público porque es PLATA en la moneda
          del viaje, como los dos de arriba. Lo que sí es texto de marca —la
          condición de no reembolsable— vive en el paso 6, con el resto de la
          voz de la escuela. */}
      <Field label={t("depositAmount")} help={t("depositHelp")}>
        {(props) => (
          <Input
            {...props}
            inputMode="decimal"
            placeholder="0.00"
            value={depositAmount}
            disabled={disabled}
            onChange={(e) => setDepositAmount(e.target.value)}
          />
        )}
      </Field>

      {/* Los dos defaults del plan CON seña. Solo intervienen si hay seña:
          sin ella el generador sigue repartiendo las cuotas hasta la salida,
          como siempre. Son sugerencias — al generar el plan de cada pasajera
          se pueden cambiar. */}
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t("installmentCount")} help={t("installmentCountHelp")}>
          {(props) => (
            <Input
              {...props}
              type="number"
              min={2}
              max={6}
              value={installmentCount}
              disabled={disabled}
              onChange={(e) => setInstallmentCount(e.target.value)}
            />
          )}
        </Field>

        <Field label={t("intervalMonths")} help={t("intervalMonthsHelp")}>
          {(props) => (
            <Input
              {...props}
              type="number"
              min={1}
              max={12}
              value={intervalMonths}
              disabled={disabled}
              onChange={(e) => setIntervalMonths(e.target.value)}
            />
          )}
        </Field>
      </div>

      {/* Los planes ya generados NO se tocan al cambiar el precio.
          Es deliberado —nadie quiere que a quien ya pagó dos cuotas se le
          reescriba la deuda— pero es invisible si no se dice, así que se dice
          antes de guardar y con el número exacto de afectados. */}
      {priceChanged && passengersWithActivePlan > 0 ? (
        <Alert role="alert" className="border-status-warning/40 bg-status-warning-surface">
          <AlertTriangle aria-hidden="true" />
          <AlertDescription>
            {t("activePlansWarning", { count: passengersWithActivePlan })}
          </AlertDescription>
        </Alert>
      ) : null}

      {/* Impacto: qué le cambia al pasajero respecto de lo ya guardado. */}
      {hasSavedPrices && priceChanged ? (
        <Alert role="status">
          <TrendingUp aria-hidden="true" />
          <AlertDescription className="space-y-1">
            <strong className="font-medium">{t("impactTitle")}</strong>
            {savedPriceDouble !== null && savedPriceDouble !== priceDouble ? (
              <p>
                {t("impactDouble", {
                  before: money(savedPriceDouble),
                  after: priceDouble ? money(priceDouble) : "—",
                })}
              </p>
            ) : null}
            {savedPriceSingle !== null && savedPriceSingle !== priceSingle ? (
              <p>
                {t("impactSingle", {
                  before: money(savedPriceSingle),
                  after: priceSingle ? money(priceSingle) : "—",
                })}
              </p>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {/* Margen por pasajero. */}
      <section className="space-y-3">
        <h3 className="text-lg font-medium">{t("marginPerPassenger")}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {margin.perPassengerDouble ? (
            <MarginCard
              label={t("priceDouble")}
              margin={margin.perPassengerDouble.margin.toString()}
              percent={margin.perPassengerDouble.marginPercent.toString()}
              currency={currency}
              locale={locale}
            />
          ) : null}
          {margin.perPassengerSingle ? (
            <MarginCard
              label={t("priceSingle")}
              margin={margin.perPassengerSingle.margin.toString()}
              percent={margin.perPassengerSingle.marginPercent.toString()}
              currency={currency}
              locale={locale}
            />
          ) : null}
        </div>

        {margin.perPassengerDouble?.margin.isNegative() ? (
          <Alert variant="destructive" role="alert">
            <AlertTriangle aria-hidden="true" />
            <AlertDescription>
              {t("negativeMargin", {
                amount: money(
                  margin.perPassengerDouble.margin.abs().toString(),
                ),
              })}
            </AlertDescription>
          </Alert>
        ) : null}
      </section>

      {/* Margen total, siempre con su base declarada. */}
      {margin.totals.length > 0 ? (
        <section className="space-y-3">
          <h3 className="text-lg font-medium">{t("totalMargin")}</h3>

          {margin.totals[0]!.basis.kind === "ESCENARIO" ? (
            <p className="text-muted-foreground text-sm text-balance">
              {t("noConfirmedYet")}
            </p>
          ) : null}

          <ul className="space-y-2">
            {margin.totals.map((total, index) => (
              <li
                key={index}
                className="border-border flex flex-wrap items-baseline justify-between gap-2 rounded-lg border p-4"
              >
                <span className="text-muted-foreground text-sm text-balance">
                  {total.basis.kind === "CONFIRMADOS"
                    ? t("basisConfirmed", {
                        count:
                          total.basis.doubleCount + total.basis.singleCount,
                        double: total.basis.doubleCount,
                        single: total.basis.singleCount,
                      })
                    : total.basis.scenario === "TODOS_DOBLE"
                      ? t("basisScenarioDouble", {
                          count: total.basis.passengerCount,
                        })
                      : t("basisScenarioSingle", {
                          count: total.basis.passengerCount,
                        })}
                </span>
                <span className="text-xl font-semibold tabular-nums">
                  {money(total.margin.toString())}
                  <span className="text-muted-foreground ml-2 text-sm font-normal">
                    {total.marginPercent.toString()}%
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Button type="submit" size="lg" disabled={disabled}>
        {t("save")}
      </Button>
    </form>
  );
}

function MarginCard({
  label,
  margin,
  percent,
  currency,
  locale,
}: {
  label: string;
  margin: string;
  percent: string;
  currency: CurrencyCode;
  locale: LocaleCode;
}) {
  const negative = Number(margin) < 0;
  return (
    <div className="border-border rounded-lg border p-4">
      <p className="text-muted-foreground text-sm">{label}</p>
      <p
        className={`text-2xl font-semibold tabular-nums ${
          negative ? "text-status-danger" : "text-status-ok"
        }`}
      >
        {formatMoney(margin, currency, locale)}
      </p>
      <p className="text-muted-foreground text-sm tabular-nums">{percent}%</p>
    </div>
  );
}

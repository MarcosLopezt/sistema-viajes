"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChevronDown, ChevronUp, Info } from "lucide-react";
import { formatMoney, type CurrencyCode, type LocaleCode } from "@/lib/format";
import type { TripCostBreakdown } from "@/lib/domain/pricing";
import { cn } from "@/lib/utils";

/**
 * Panel de costo en vivo.
 *
 * Es el corazón del wizard, no un adorno: el coordinador nunca pierde de vista
 * el número que le importa mientras carga datos. Se recalcula en el navegador
 * con las MISMAS funciones puras que usa el servidor (src/lib/domain/pricing),
 * así que no hay ida y vuelta a la base por cada tecla y los dos lados no
 * pueden dar números distintos.
 *
 * En escritorio es una columna fija a la derecha. En pantallas chicas es una
 * barra inferior colapsable: ocupa poco, pero el costo por pasajero sigue
 * visible sin desplegar nada.
 */
export interface CostPanelProps {
  breakdown: TripCostBreakdown;
  currency: CurrencyCode;
  budgetedPassengers: number;
  /** Precio de lista, si ya se fijó. Habilita mostrar el margen. */
  priceDouble?: string | null;
  priceSingle?: string | null;
}

export function CostPanel(props: CostPanelProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      {/* Escritorio: columna fija. */}
      <aside className="hidden lg:block">
        <div className="sticky top-6">
          <PanelBody {...props} showBreakdown />
        </div>
      </aside>

      {/* Mobile: barra inferior colapsable. */}
      <div className="border-border bg-background fixed inset-x-0 bottom-0 z-40 border-t shadow-lg lg:hidden">
        {expanded ? (
          <div className="max-h-[60vh] overflow-y-auto p-4">
            <PanelBody {...props} showBreakdown />
          </div>
        ) : (
          <CollapsedSummary {...props} />
        )}
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="text-muted-foreground flex min-h-11 w-full items-center justify-center gap-1.5 border-t px-4 text-sm"
        >
          {expanded ? (
            <>
              <ChevronDown className="size-4" aria-hidden="true" />
              <PanelLabel k="hide" />
            </>
          ) : (
            <>
              <ChevronUp className="size-4" aria-hidden="true" />
              <PanelLabel k="show" />
            </>
          )}
        </button>
      </div>

      {/* Reserva el alto de la barra para que no tape el último control. */}
      <div className="h-32 lg:hidden" aria-hidden="true" />
    </>
  );
}

function PanelLabel({ k }: { k: "show" | "hide" }) {
  const t = useTranslations("budget.panel");
  return <>{t(k)}</>;
}

/** Lo mínimo visible sin desplegar: los dos costos por pasajero. */
function CollapsedSummary({
  breakdown,
  currency,
}: Pick<CostPanelProps, "breakdown" | "currency">) {
  const t = useTranslations("budget.panel");
  const locale = useLocale() as LocaleCode;

  return (
    <div className="flex items-center justify-around gap-2 px-4 py-3">
      <div className="text-center">
        <p className="text-muted-foreground text-xs">{t("costDouble")}</p>
        <p className="text-lg font-semibold tabular-nums">
          {formatMoney(breakdown.totalDouble.toString(), currency, locale)}
        </p>
      </div>
      <div className="bg-border h-8 w-px" aria-hidden="true" />
      <div className="text-center">
        <p className="text-muted-foreground text-xs">{t("costSingle")}</p>
        <p className="text-lg font-semibold tabular-nums">
          {formatMoney(breakdown.totalSingle.toString(), currency, locale)}
        </p>
      </div>
    </div>
  );
}

function PanelBody({
  breakdown,
  currency,
  budgetedPassengers,
  priceDouble,
  priceSingle,
  showBreakdown,
}: CostPanelProps & { showBreakdown?: boolean }) {
  const t = useTranslations("budget.panel");
  const locale = useLocale() as LocaleCode;
  const money = (value: string) => formatMoney(value, currency, locale);

  const marginOf = (price: string | null | undefined, cost: string) =>
    price == null ? null : (Number(price) - Number(cost)).toFixed(2);

  const marginDouble = marginOf(priceDouble, breakdown.totalDouble.toString());
  const marginSingle = marginOf(priceSingle, breakdown.totalSingle.toString());

  return (
    <section
      aria-label={t("title")}
      className="border-border bg-card rounded-xl border p-5"
    >
      <h2 className="text-muted-foreground mb-4 text-sm font-medium tracking-wide uppercase">
        {t("title")}
      </h2>

      <div className="space-y-4">
        <CostFigure
          label={t("costDouble")}
          value={money(breakdown.totalDouble.toString())}
          margin={marginDouble}
          currency={currency}
          locale={locale}
        />
        <CostFigure
          label={t("costSingle")}
          value={money(breakdown.totalSingle.toString())}
          margin={marginSingle}
          currency={currency}
          locale={locale}
        />
      </div>

      {showBreakdown ? (
        <>
          <hr className="border-border my-4" />
          <h3 className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
            {t("breakdown")}
          </h3>
          <dl className="space-y-1.5 text-sm">
            <Row
              label={t("indirectTotal")}
              value={money(breakdown.indirectTotal.toString())}
            />
            <Row
              label={t("indirect")}
              value={money(breakdown.indirectPerPassenger.toString())}
              hint={t("dividedBy", { count: budgetedPassengers })}
            />
          </dl>

          {/* El sobrante del redondeo se muestra en vez de esconderse: es
              plata que el presupuesto recauda de más. */}
          {!breakdown.roundingResidue.isZero() ? (
            <p className="text-muted-foreground mt-3 flex items-start gap-1.5 text-xs">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span>
                {t("residue", {
                  amount: money(breakdown.roundingResidue.toString()),
                })}{" "}
                {t("residueHelp")}
              </span>
            </p>
          ) : null}

          {priceDouble == null && priceSingle == null ? (
            <p className="text-muted-foreground mt-4 text-xs">
              {t("noPriceYet")}
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function CostFigure({
  label,
  value,
  margin,
  currency,
  locale,
}: {
  label: string;
  value: string;
  margin: string | null;
  currency: CurrencyCode;
  locale: LocaleCode;
}) {
  const t = useTranslations("budget.panel");
  const negative = margin !== null && Number(margin) < 0;

  return (
    <div>
      <p className="text-muted-foreground text-sm">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      {margin !== null ? (
        <p
          className={cn(
            "text-sm tabular-nums",
            negative ? "text-status-danger" : "text-status-ok",
          )}
        >
          {t("margin")}: {formatMoney(margin, currency, locale)}
        </p>
      ) : null}
    </div>
  );
}

function Row({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">
        {label}
        {hint ? <span className="block text-xs opacity-80">{hint}</span> : null}
      </dt>
      <dd className="shrink-0 font-medium tabular-nums">{value}</dd>
    </div>
  );
}

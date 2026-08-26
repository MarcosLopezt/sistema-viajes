"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { calculateTripCost } from "@/lib/domain/pricing";
import { cn } from "@/lib/utils";
import {
  deleteAccommodationAction,
  deleteDirectCostAction,
  deleteIndirectCostAction,
  deleteStopAction,
  saveAccommodationAction,
  saveDirectCostAction,
  saveGeneralAction,
  saveIndirectCostAction,
  savePricesAction,
  saveStopAction,
} from "@/app/[locale]/(coordinador)/viajes/actions";
import { CostPanel } from "./cost-panel";
import { SaveIndicator, useSave } from "./save-state";
import { StepCosts, type CostRow } from "./step-costs";
import { StepGeneral, generalValuesFrom, type GeneralValues } from "./step-general";
import { StepItinerary } from "./step-itinerary";
import { StepPrices } from "./step-prices";
import {
  WIZARD_STEPS,
  type WizardAccommodation,
  type WizardPassengerMix,
  type WizardStop,
  type WizardTrip,
} from "./types";

/**
 * Wizard de presupuesto.
 *
 * La pantalla más difícil del sistema, y la que decide si el coordinador puede
 * armar un viaje sin una planilla al lado.
 *
 * Decisiones que la sostienen:
 *
 *  - El estado vive acá, en el cliente, y el panel de costo recalcula con las
 *    funciones puras de src/lib/domain/pricing. No hay ida y vuelta al
 *    servidor por cada tecla, y servidor y cliente no pueden dar números
 *    distintos porque corren el mismo código.
 *
 *  - Cada operación autoguarda contra su Server Action apenas se confirma. El
 *    viaje ya existe desde el paso 1, así que se puede abandonar en cualquier
 *    punto y retomar sin perder nada.
 *
 *  - El paso vive en la URL (?paso=3): recargar no devuelve al principio, y el
 *    coordinador puede dejar la pestaña abierta y volver.
 */
export function BudgetWizard({
  initialTrip,
  passengerMix,
}: {
  initialTrip: WizardTrip;
  passengerMix: WizardPassengerMix[];
}) {
  const t = useTranslations("budget");
  const tActions = useTranslations("budget.actions");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [trip, setTrip] = useState(initialTrip);
  const [general, setGeneral] = useState<GeneralValues>(() =>
    generalValuesFrom(initialTrip),
  );
  const [fieldErrors, setFieldErrors] = useState<
    Record<string, string[]> | undefined
  >();
  const { status, error, save } = useSave();

  const readOnly = trip.status === "FINALIZADO";

  const stepIndex = clampStep(Number(searchParams.get("paso") ?? "1"));
  const step = WIZARD_STEPS[stepIndex - 1]!;

  function goToStep(next: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("paso", String(clampStep(next)));
    router.replace(`${pathname}?${params.toString()}`, { scroll: true });
  }

  // El costo se recalcula en cada render a partir del estado local: es lo que
  // hace que el panel se mueva mientras el coordinador escribe.
  const breakdown = useMemo(
    () =>
      calculateTripCost({
        budgetedPassengers: Math.max(1, general.budgetedPassengers),
        accommodations: trip.stops.flatMap((stop) =>
          stop.accommodations.map((a) => ({
            nights: a.nights,
            pricePerNightDouble: safeAmount(a.pricePerNightDouble),
            pricePerNightSingle: safeAmount(a.pricePerNightSingle),
          })),
        ),
        directCosts: trip.directCosts.map((c) => ({
          amountPerPassenger: safeAmount(c.amountPerPassenger),
        })),
        indirectCosts: trip.indirectCosts.map((c) => ({
          totalAmount: safeAmount(c.totalAmount),
        })),
      }),
    [trip, general.budgetedPassengers],
  );

  // ------------------------------ Guardado ---------------------------------

  async function saveGeneral() {
    const result = await save(() => saveGeneralAction(trip.id, general));
    if (!result.ok) {
      setFieldErrors(result.fieldErrors);
      return false;
    }
    setFieldErrors(undefined);
    setTrip((current) => ({ ...current, ...general }));
    return true;
  }

  async function handleSaveStop(stop: Omit<WizardStop, "accommodations">) {
    const result = await save(() =>
      saveStopAction(trip.id, {
        ...(stop.id ? { id: stop.id } : {}),
        order: stop.order,
        city: stop.city,
        country: stop.country,
        fromDate: stop.fromDate,
        toDate: stop.toDate,
        notes: stop.notes,
        accommodations: [],
      }),
    );

    if (!result.ok) return { ok: false, error: result.error };

    const id = result.data.id;
    setTrip((current) => {
      const existing = current.stops.find((s) => s.id === id);
      const stops = existing
        ? current.stops.map((s) => (s.id === id ? { ...s, ...stop, id } : s))
        : [...current.stops, { ...stop, id, accommodations: [] }];
      return { ...current, stops: stops.sort((a, b) => a.order - b.order) };
    });

    return { ok: true };
  }

  async function handleDeleteStop(stopId: string) {
    const result = await save(() => deleteStopAction(trip.id, stopId));
    if (result.ok) {
      setTrip((current) => ({
        ...current,
        stops: current.stops.filter((s) => s.id !== stopId),
      }));
    }
  }

  async function handleSaveAccommodation(
    stopId: string,
    accommodation: WizardAccommodation,
  ) {
    const result = await save(() =>
      saveAccommodationAction(trip.id, stopId, {
        ...(accommodation.id ? { id: accommodation.id } : {}),
        hotelName: accommodation.hotelName,
        nights: accommodation.nights,
        pricePerNightDouble: accommodation.pricePerNightDouble,
        pricePerNightSingle: accommodation.pricePerNightSingle,
        notes: accommodation.notes,
      }),
    );

    if (!result.ok) return { ok: false, error: result.error };

    const id = result.data.id;
    setTrip((current) => ({
      ...current,
      stops: current.stops.map((stop) => {
        if (stop.id !== stopId) return stop;
        const existing = stop.accommodations.find((a) => a.id === id);
        return {
          ...stop,
          accommodations: existing
            ? stop.accommodations.map((a) =>
                a.id === id ? { ...accommodation, id } : a,
              )
            : [...stop.accommodations, { ...accommodation, id }],
        };
      }),
    }));

    return { ok: true };
  }

  async function handleDeleteAccommodation(accommodationId: string) {
    const result = await save(() =>
      deleteAccommodationAction(trip.id, accommodationId),
    );
    if (result.ok) {
      setTrip((current) => ({
        ...current,
        stops: current.stops.map((stop) => ({
          ...stop,
          accommodations: stop.accommodations.filter(
            (a) => a.id !== accommodationId,
          ),
        })),
      }));
    }
  }

  async function handleSaveDirectCost(row: CostRow) {
    const result = await save(() =>
      saveDirectCostAction(trip.id, {
        ...(row.id ? { id: row.id } : {}),
        concept: row.concept,
        amountPerPassenger: row.amount,
        type: row.type,
      }),
    );
    if (!result.ok) return { ok: false, error: result.error };

    const id = result.data.id;
    setTrip((current) => {
      const entry = {
        id,
        stopId: null,
        concept: row.concept,
        amountPerPassenger: row.amount,
        type: row.type as WizardTrip["directCosts"][number]["type"],
      };
      const exists = current.directCosts.some((c) => c.id === id);
      return {
        ...current,
        directCosts: exists
          ? current.directCosts.map((c) => (c.id === id ? entry : c))
          : [...current.directCosts, entry],
      };
    });

    return { ok: true };
  }

  async function handleSaveIndirectCost(row: CostRow) {
    const result = await save(() =>
      saveIndirectCostAction(trip.id, {
        ...(row.id ? { id: row.id } : {}),
        concept: row.concept,
        totalAmount: row.amount,
        type: row.type,
      }),
    );
    if (!result.ok) return { ok: false, error: result.error };

    const id = result.data.id;
    setTrip((current) => {
      const entry = {
        id,
        concept: row.concept,
        totalAmount: row.amount,
        type: row.type as WizardTrip["indirectCosts"][number]["type"],
      };
      const exists = current.indirectCosts.some((c) => c.id === id);
      return {
        ...current,
        indirectCosts: exists
          ? current.indirectCosts.map((c) => (c.id === id ? entry : c))
          : [...current.indirectCosts, entry],
      };
    });

    return { ok: true };
  }

  // -------------------------------- Render ---------------------------------

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-6">
        <StepNav current={stepIndex} onSelect={goToStep} />

        <div className="flex min-h-6 items-center justify-between gap-3">
          <h2 className="text-2xl font-semibold">{t(`steps.${step}`)}</h2>
          <SaveIndicator status={status} error={error} />
        </div>

        {step === "general" ? (
          <StepGeneral
            values={general}
            onChange={setGeneral}
            fieldErrors={fieldErrors}
            disabled={readOnly}
          />
        ) : null}

        {step === "itinerary" ? (
          <StepItinerary
            stops={trip.stops}
            currency={trip.currency}
            disabled={readOnly}
            onSaveStop={handleSaveStop}
            onDeleteStop={handleDeleteStop}
            onSaveAccommodation={handleSaveAccommodation}
            onDeleteAccommodation={handleDeleteAccommodation}
          />
        ) : null}

        {step === "directCosts" ? (
          <StepCosts
            namespace="directCosts"
            currency={trip.currency}
            disabled={readOnly}
            types={["COMIDA", "EVENTO", "TRANSPORTE", "OTRO"]}
            rows={trip.directCosts.map((c) => ({
              id: c.id,
              concept: c.concept,
              amount: c.amountPerPassenger,
              type: c.type,
            }))}
            onSave={handleSaveDirectCost}
            onDelete={async (id) => {
              const result = await save(() =>
                deleteDirectCostAction(trip.id, id),
              );
              if (result.ok) {
                setTrip((current) => ({
                  ...current,
                  directCosts: current.directCosts.filter((c) => c.id !== id),
                }));
              }
            }}
          />
        ) : null}

        {step === "indirectCosts" ? (
          <StepCosts
            namespace="indirectCosts"
            currency={trip.currency}
            disabled={readOnly}
            types={["CHARTER", "TRANSFER", "HOSPEDAJE_COORDINADOR", "OTRO"]}
            rows={trip.indirectCosts.map((c) => ({
              id: c.id,
              concept: c.concept,
              amount: c.totalAmount,
              type: c.type,
            }))}
            onSave={handleSaveIndirectCost}
            onDelete={async (id) => {
              const result = await save(() =>
                deleteIndirectCostAction(trip.id, id),
              );
              if (result.ok) {
                setTrip((current) => ({
                  ...current,
                  indirectCosts: current.indirectCosts.filter(
                    (c) => c.id !== id,
                  ),
                }));
              }
            }}
          />
        ) : null}

        {step === "prices" ? (
          <StepPrices
            breakdown={breakdown}
            currency={trip.currency}
            budgetedPassengers={general.budgetedPassengers}
            passengerMix={passengerMix}
            savedPriceDouble={trip.priceDouble}
            savedPriceSingle={trip.priceSingle}
            disabled={readOnly}
            onSave={async (prices) => {
              const result = await save(() =>
                savePricesAction(trip.id, prices),
              );
              if (result.ok) {
                setTrip((current) => ({ ...current, ...prices }));
                return { ok: true };
              }
              return { ok: false, error: result.error };
            }}
          />
        ) : null}

        <div className="flex items-center justify-between gap-3 pt-2">
          <Button
            variant="outline"
            disabled={stepIndex === 1}
            onClick={() => goToStep(stepIndex - 1)}
          >
            <ChevronLeft aria-hidden="true" />
            {tActions("previous")}
          </Button>

          {stepIndex < WIZARD_STEPS.length ? (
            <Button
              onClick={async () => {
                // El paso 1 guarda al avanzar; los demás ya autoguardaron
                // cada fila al confirmarla.
                if (step === "general" && !readOnly) {
                  const ok = await saveGeneral();
                  if (!ok) return;
                }
                goToStep(stepIndex + 1);
              }}
            >
              {tActions("next")}
              <ChevronRight aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      </div>

      <CostPanel
        breakdown={breakdown}
        currency={trip.currency}
        budgetedPassengers={general.budgetedPassengers}
        priceDouble={trip.priceDouble}
        priceSingle={trip.priceSingle}
      />
    </div>
  );
}

function StepNav({
  current,
  onSelect,
}: {
  current: number;
  onSelect: (step: number) => void;
}) {
  const t = useTranslations("budget");

  return (
    <nav aria-label={t("title")}>
      <p className="text-muted-foreground mb-2 text-sm">
        {t("stepOf", { current, total: WIZARD_STEPS.length })}
      </p>
      <ol className="flex flex-wrap gap-1.5">
        {WIZARD_STEPS.map((step, index) => {
          const number = index + 1;
          const isCurrent = number === current;
          const isDone = number < current;
          return (
            <li key={step}>
              <button
                type="button"
                onClick={() => onSelect(number)}
                aria-current={isCurrent ? "step" : undefined}
                className={cn(
                  "flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm transition-colors",
                  isCurrent
                    ? "bg-primary text-primary-foreground font-medium"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                {isDone ? (
                  <Check className="size-4" aria-hidden="true" />
                ) : (
                  <span className="tabular-nums">{number}.</span>
                )}
                {t(`steps.${step}`)}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function clampStep(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(Math.max(Math.trunc(value), 1), WIZARD_STEPS.length);
}

/**
 * Un campo a medio tipear ("12.", "" o "abc") no debe romper el panel: se
 * trata como cero hasta que sea un número válido. La validación real la hace
 * Zod al guardar.
 */
function safeAmount(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "" || !Number.isFinite(Number(trimmed))) return "0";
  return trimmed;
}

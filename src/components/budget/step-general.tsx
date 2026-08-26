"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field } from "@/components/form/field";
import type { WizardTrip } from "./types";

/**
 * Paso 1 — datos generales.
 *
 * Es el único paso que existe antes de que el viaje esté creado: desde acá
 * sale el borrador. Después queda editable como cualquier otro paso.
 */
export interface GeneralValues {
  name: string;
  startDate: string;
  endDate: string;
  currency: "GBP" | "USD" | "EUR";
  minPassengers: number;
  maxPassengers: number;
  budgetedPassengers: number;
  coordinatorCount: number;
  passportValidityMonths: number;
  requireFullPassportValidity: boolean;
}

export function generalValuesFrom(trip: WizardTrip): GeneralValues {
  return {
    name: trip.name,
    startDate: trip.startDate,
    endDate: trip.endDate,
    currency: trip.currency,
    minPassengers: trip.minPassengers,
    maxPassengers: trip.maxPassengers,
    budgetedPassengers: trip.budgetedPassengers,
    coordinatorCount: trip.coordinatorCount,
    passportValidityMonths: trip.passportValidityMonths,
    requireFullPassportValidity: trip.requireFullPassportValidity,
  };
}

export function StepGeneral({
  values,
  onChange,
  fieldErrors,
  disabled,
}: {
  values: GeneralValues;
  onChange: (values: GeneralValues) => void;
  fieldErrors?: Record<string, string[]> | undefined;
  disabled?: boolean;
}) {
  const t = useTranslations("budget.general");
  const [touched, setTouched] = useState(false);

  const set = <K extends keyof GeneralValues>(
    key: K,
    value: GeneralValues[K],
  ) => {
    setTouched(true);
    onChange({ ...values, [key]: value });
  };

  const errorOf = (field: string) => fieldErrors?.[field]?.[0];

  // Presupuestar menos pasajeros que el mínimo del viaje no es inválido, pero
  // casi siempre es un descuido: se avisa sin bloquear.
  const belowMinimum = values.budgetedPassengers < values.minPassengers;

  const number = (raw: string) => {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  return (
    <div className="space-y-6">
      <Field label={t("name")} error={errorOf("name")} required>
        {(props) => (
          <Input
            {...props}
            value={values.name}
            placeholder={t("namePlaceholder")}
            disabled={disabled}
            onChange={(e) => set("name", e.target.value)}
          />
        )}
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t("startDate")} error={errorOf("startDate")} required>
          {(props) => (
            <Input
              {...props}
              type="date"
              value={values.startDate}
              disabled={disabled}
              onChange={(e) => set("startDate", e.target.value)}
            />
          )}
        </Field>

        <Field label={t("endDate")} error={errorOf("endDate")} required>
          {(props) => (
            <Input
              {...props}
              type="date"
              value={values.endDate}
              disabled={disabled}
              onChange={(e) => set("endDate", e.target.value)}
            />
          )}
        </Field>
      </div>

      <Field
        label={t("currency")}
        help={t("currencyHelp")}
        error={errorOf("currency")}
        required
      >
        {(props) => (
          <Select
            value={values.currency}
            disabled={disabled}
            onValueChange={(value) =>
              set("currency", value as GeneralValues["currency"])
            }
          >
            <SelectTrigger id={props.id} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="GBP">£ — Libra esterlina (GBP)</SelectItem>
              <SelectItem value="EUR">€ — Euro (EUR)</SelectItem>
              <SelectItem value="USD">US$ — Dólar (USD)</SelectItem>
            </SelectContent>
          </Select>
        )}
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t("minPassengers")} error={errorOf("minPassengers")}>
          {(props) => (
            <Input
              {...props}
              type="number"
              inputMode="numeric"
              min={1}
              value={values.minPassengers}
              disabled={disabled}
              onChange={(e) => set("minPassengers", number(e.target.value))}
            />
          )}
        </Field>

        <Field label={t("maxPassengers")} error={errorOf("maxPassengers")}>
          {(props) => (
            <Input
              {...props}
              type="number"
              inputMode="numeric"
              min={1}
              value={values.maxPassengers}
              disabled={disabled}
              onChange={(e) => set("maxPassengers", number(e.target.value))}
            />
          )}
        </Field>
      </div>

      <Field
        label={t("budgetedPassengers")}
        help={t("budgetedHelp")}
        error={errorOf("budgetedPassengers")}
        required
      >
        {(props) => (
          <Input
            {...props}
            type="number"
            inputMode="numeric"
            min={1}
            value={values.budgetedPassengers}
            disabled={disabled}
            onChange={(e) => set("budgetedPassengers", number(e.target.value))}
          />
        )}
      </Field>

      {belowMinimum && touched ? (
        <Alert role="status">
          <AlertTriangle aria-hidden="true" />
          <AlertDescription>
            {t("belowMinimum", {
              budgeted: values.budgetedPassengers,
              min: values.minPassengers,
            })}
          </AlertDescription>
        </Alert>
      ) : null}

      <Field
        label={t("coordinatorCount")}
        help={t("coordinatorHelp")}
        error={errorOf("coordinatorCount")}
      >
        {(props) => (
          <Input
            {...props}
            type="number"
            inputMode="numeric"
            min={0}
            value={values.coordinatorCount}
            disabled={disabled}
            onChange={(e) => set("coordinatorCount", number(e.target.value))}
          />
        )}
      </Field>

      <Field
        label={t("passportMonths")}
        help={t("passportMonthsHelp")}
        error={errorOf("passportValidityMonths")}
      >
        {(props) => (
          <Input
            {...props}
            type="number"
            inputMode="numeric"
            min={0}
            max={24}
            value={values.passportValidityMonths}
            disabled={disabled}
            onChange={(e) =>
              set("passportValidityMonths", number(e.target.value))
            }
          />
        )}
      </Field>

      <div className="border-border space-y-2 rounded-lg border p-4">
        <div className="flex items-start gap-3">
          <Checkbox
            id="requireFullPassportValidity"
            checked={values.requireFullPassportValidity}
            disabled={disabled}
            onCheckedChange={(checked) =>
              set("requireFullPassportValidity", checked === true)
            }
          />
          <div className="space-y-1">
            <Label
              htmlFor="requireFullPassportValidity"
              className="text-base leading-snug"
            >
              {t("requireFullValidity")}
            </Label>
            <p className="text-muted-foreground text-sm">
              {t("requireFullValidityHelp")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  StepGeneral,
  type GeneralValues,
} from "@/components/budget/step-general";
import { createTripAction, type ActionResult } from "../actions";

/**
 * Formulario de creación.
 *
 * Reutiliza `StepGeneral`, el mismo componente que el paso 1 del wizard: los
 * campos, las ayudas y la alerta de "presupuestás menos que el mínimo" son
 * idénticos porque son la misma pantalla en dos momentos distintos.
 *
 * Los valores viajan en un FormData con inputs ocultos porque el componente
 * es controlado y la Server Action recibe FormData. Es el precio de compartir
 * el componente, y vale la pena frente a mantener dos formularios paralelos.
 */
export function NewTripForm() {
  const t = useTranslations("budget.newTrip");
  const [state, formAction, pending] = useActionState(
    createTripAction,
    undefined as ActionResult<{ id: string }> | undefined,
  );

  const [values, setValues] = useState<GeneralValues>({
    name: "",
    startDate: "",
    endDate: "",
    currency: "GBP",
    minPassengers: 10,
    maxPassengers: 14,
    budgetedPassengers: 14,
    coordinatorCount: 2,
    passportValidityMonths: 3,
    requireFullPassportValidity: false,
  });

  const failed = state && !state.ok ? state : null;

  return (
    <form action={formAction} className="space-y-6" noValidate>
      {failed && failed.error ? (
        <Alert variant="destructive" role="alert">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{failed.error}</AlertDescription>
        </Alert>
      ) : null}

      <StepGeneral
        values={values}
        onChange={setValues}
        fieldErrors={failed?.fieldErrors}
      />

      {/* Espejo de los valores controlados para que viajen en el FormData. */}
      <input type="hidden" name="name" value={values.name} />
      <input type="hidden" name="startDate" value={values.startDate} />
      <input type="hidden" name="endDate" value={values.endDate} />
      <input type="hidden" name="currency" value={values.currency} />
      <input type="hidden" name="minPassengers" value={values.minPassengers} />
      <input type="hidden" name="maxPassengers" value={values.maxPassengers} />
      <input
        type="hidden"
        name="budgetedPassengers"
        value={values.budgetedPassengers}
      />
      <input
        type="hidden"
        name="coordinatorCount"
        value={values.coordinatorCount}
      />
      <input
        type="hidden"
        name="passportValidityMonths"
        value={values.passportValidityMonths}
      />
      {values.requireFullPassportValidity ? (
        <input type="hidden" name="requireFullPassportValidity" value="on" />
      ) : null}

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {t("create")}
      </Button>
    </form>
  );
}

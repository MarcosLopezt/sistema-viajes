"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, CalendarPlus, Loader2, Lock } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/form/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatMoney, type CurrencyCode, type LocaleCode } from "@/lib/format";
import { generatePlanAction, previewPlanAction } from "../actions";

/**
 * Armado del plan de cuotas.
 *
 * El coordinador elige CUÁNTAS cuotas y edita las FECHAS. Los importes no se
 * editan: los calcula el motor y la última absorbe la diferencia del
 * redondeo. Dejarlos editables abriría la puerta a un plan cuyas cuotas no
 * suman el total, que es exactamente el problema que el reparto resuelve.
 *
 * Un plan con pagos confirmados no se toca. Uno sin pagos se puede reemplazar,
 * pero pidiendo confirmación explícita que dice cuántas cuotas se van a
 * perder.
 */

interface PreviewLine {
  number: number;
  dueDate: string;
  amount: string;
  afterDeparture: boolean;
}

export function PlanEditor({
  tripId,
  passengerId,
  passengerName,
  currency,
  locale,
  initialCount,
  disabledReason,
}: {
  tripId: string;
  passengerId: string;
  passengerName: string;
  currency: CurrencyCode;
  locale: LocaleCode;
  initialCount: number;
  /** Mensaje ya traducido si no se puede generar. `null` si se puede. */
  disabledReason: string | null;
}) {
  const t = useTranslations("paymentsAdmin");
  const tPayments = useTranslations("payments");
  const tCommon = useTranslations("common");

  const [count, setCount] = useState(initialCount);
  const [total, setTotal] = useState<string | null>(null);
  const [lines, setLines] = useState<PreviewLine[]>([]);
  const [late, setLate] = useState<number[]>([]);
  const [locked, setLocked] = useState(false);
  const [existingCount, setExistingCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(disabledReason);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [loading, startLoading] = useTransition();
  const [saving, setSaving] = useState(false);

  // La propuesta se pide al servidor y no se calcula acá: los importes que se
  // muestran tienen que ser los mismos que se van a guardar, y la única forma
  // de garantizarlo es que salgan del mismo lugar.
  useEffect(() => {
    if (disabledReason !== null) return;

    startLoading(async () => {
      const result = await previewPlanAction(passengerId, count);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      setTotal(result.data.totalAmount);
      setLines(result.data.installments);
      setLate(result.data.lateInstallments);
      setLocked(result.data.locked);
      setExistingCount(result.data.existingInstallmentCount);
    });
  }, [passengerId, count, disabledReason]);

  function setDueDate(index: number, value: string) {
    setLines((current) =>
      current.map((line, i) =>
        i === index ? { ...line, dueDate: value } : line,
      ),
    );
  }

  async function save(replaceExisting: boolean) {
    setSaving(true);
    setError(null);

    const result = await generatePlanAction(tripId, passengerId, {
      installmentCount: count,
      installments: lines.map((line) => ({
        number: line.number,
        dueDate: line.dueDate,
        amount: line.amount,
      })),
      replaceExisting,
    });

    setSaving(false);

    if (!result.ok) {
      // El servicio no reemplaza nada sin que se lo pidan explícitamente:
      // devuelve cuántas cuotas están en juego y acá se pregunta.
      if (result.reason === "PLAN_EXISTENTE") {
        setExistingCount(result.installmentsAtRisk ?? existingCount);
        setConfirmReplace(true);
        return;
      }
      setError(result.error);
      return;
    }

    setConfirmReplace(false);
  }

  if (locked) {
    return (
      <Alert>
        <Lock className="size-5" aria-hidden="true" />
        <AlertDescription className="text-base">
          {t("planLocked")}
        </AlertDescription>
      </Alert>
    );
  }

  if (disabledReason !== null) {
    return (
      <Alert>
        <AlertTriangle className="size-5" aria-hidden="true" />
        <AlertDescription className="text-base">
          {disabledReason}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle className="text-lg">
          {t("planTitle", { name: passengerName })}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {total ? (
          <p className="text-base">
            {t("planTotal")}:{" "}
            <span className="font-semibold tabular-nums">
              {formatMoney(total, currency, locale)}
            </span>
          </p>
        ) : null}

        <Field label={t("planCount")} help={t("planCountHelp")}>
          {(props) => (
            <Select
              value={String(count)}
              onValueChange={(value) => setCount(Number(value))}
            >
              <SelectTrigger id={props.id} className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Field>

        {loading ? (
          <p className="text-muted-foreground flex items-center gap-2 text-base">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            {tCommon("loading")}
          </p>
        ) : null}

        {lines.length > 0 ? (
          <div className="space-y-3">
            <p className="text-base font-medium">{t("planPreview")}</p>
            <ul className="space-y-3">
              {lines.map((line, index) => (
                <li
                  key={line.number}
                  className="flex flex-wrap items-end gap-3"
                >
                  <Field
                    label={`${tPayments("installment", { number: line.number })} · ${t("planDueDate")}`}
                    className="min-w-48 flex-1"
                  >
                    {(props) => (
                      <Input
                        {...props}
                        type="date"
                        value={line.dueDate}
                        onChange={(event) =>
                          setDueDate(index, event.target.value)
                        }
                      />
                    )}
                  </Field>
                  <p className="pb-2 text-base font-semibold tabular-nums">
                    {formatMoney(line.amount, currency, locale)}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* Advertencia, no bloqueo: puede haber un motivo para cobrar una
            cuota con el viaje en marcha, pero nadie debería enterarse después. */}
        {late.length > 0 ? (
          <Alert>
            <AlertTriangle className="size-5" aria-hidden="true" />
            <AlertDescription className="text-base">
              {t("planLateWarning", { numbers: late.join(", ") })}
            </AlertDescription>
          </Alert>
        ) : null}

        {error ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <Button
          size="lg"
          disabled={saving || loading || lines.length === 0}
          onClick={() => save(false)}
        >
          {saving ? (
            <>
              <Loader2 className="animate-spin" aria-hidden="true" />
              {t("planGenerating")}
            </>
          ) : (
            <>
              <CalendarPlus aria-hidden="true" />
              {t("planGenerate")}
            </>
          )}
        </Button>
      </CardContent>

      <AlertDialog open={confirmReplace} onOpenChange={setConfirmReplace}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("planReplaceTitle")}</AlertDialogTitle>
            <AlertDialogDescription className="text-base">
              {t("planReplaceBody", { count: existingCount ?? 0 })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void save(true)}>
              {t("planReplaceConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

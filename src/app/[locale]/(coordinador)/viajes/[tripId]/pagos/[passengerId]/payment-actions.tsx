"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, RotateCcw, Undo2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/form/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { registerRefundAction, revertPaymentAction } from "../actions";

/**
 * Deshacer una confirmación hecha por error.
 *
 * Decisión tomada: se puede, con motivo obligatorio y AuditLog. La alternativa
 * purista —compensar con un asiento inverso— es más limpia contablemente pero
 * le complica la vida a quien apretó el botón equivocado.
 *
 * El botón NO confirma directo: abre un diálogo que exige escribir por qué. El
 * motivo no es burocracia, es lo único que va a explicar dentro de seis meses
 * por qué ese pago figura dos veces en la auditoría.
 */
export function RevertPaymentButton({
  tripId,
  passengerId,
  paymentId,
}: {
  tripId: string;
  passengerId: string;
  paymentId: string;
}) {
  const t = useTranslations("paymentsAdmin");
  const tCommon = useTranslations("common");

  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function revert() {
    setBusy(true);
    setError(null);

    const result = await revertPaymentAction(tripId, passengerId, {
      paymentId,
      reason: reason.trim(),
    });

    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (result.data === "YA_RESUELTO") {
      setError(t("reviewAlreadyResolved"));
      return;
    }
    setOpen(false);
    setReason("");
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Undo2 aria-hidden="true" />
          {t("revertAction")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("revertTitle")}</AlertDialogTitle>
          <AlertDialogDescription className="text-base">
            {t("revertBody")}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <Field label={t("revertReason")} required>
          {(props) => (
            <Textarea
              {...props}
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          )}
        </Field>

        {error ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>
            {tCommon("cancel")}
          </AlertDialogCancel>
          {/* No es AlertDialogAction: ese cierra el diálogo al tocarlo, y acá
              el diálogo tiene que quedarse abierto si el motivo es corto. */}
          <Button
            variant="destructive"
            disabled={busy || reason.trim().length < 5}
            onClick={revert}
          >
            {busy ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : null}
            {t("revertConfirm")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Registra un reembolso.
 *
 * Cuelga del plan, no de una cuota: no cambia el estado de ninguna. Devolverle
 * plata a alguien no "descobra" la cuota 2.
 */
export function RefundForm({
  tripId,
  passengerId,
}: {
  tripId: string;
  passengerId: string;
}) {
  const t = useTranslations("paymentsAdmin");

  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const result = await registerRefundAction(tripId, passengerId, {
      amount: amount.trim(),
      transferDate: date,
      reason: reason.trim(),
    });

    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setAmount("");
    setDate("");
    setReason("");
  }

  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle className="text-lg">{t("refundTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <p className="text-muted-foreground text-sm">{t("refundHelp")}</p>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("refundAmount")} required>
              {(props) => (
                <Input
                  {...props}
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
              )}
            </Field>
            <Field label={t("refundDate")} required>
              {(props) => (
                <Input
                  {...props}
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
              )}
            </Field>
          </div>

          <Field label={t("refundReason")} required>
            {(props) => (
              <Textarea
                {...props}
                rows={2}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            )}
          </Field>

          {error ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <Button type="submit" variant="outline" disabled={busy}>
            {busy ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <RotateCcw aria-hidden="true" />
            )}
            {t("refundSubmit")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

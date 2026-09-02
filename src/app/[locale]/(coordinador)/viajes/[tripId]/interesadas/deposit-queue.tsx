"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Clock, ExternalLink, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDate, formatMoney } from "@/lib/format";
import { confirmDepositAction, rejectDepositAction } from "./actions";

/**
 * La cola de señas esperando revisión.
 *
 * ── Por qué la antigüedad es lo primero que se ve ─────────────────────────
 *
 * Porque una seña sin revisar es plata parada: alguien transfirió, ya no tiene
 * ese dinero, y del otro lado nadie le confirmó nada. Mientras tanto no es
 * pasajera, no ocupa cupo y no entra al plan de pagos.
 *
 * El dato que importa no es "cuándo la subió" sino "cuánto hace que espera", y
 * son la misma información dicha de dos maneras muy distintas: una fecha hay
 * que restarla mentalmente, un contador de días se lee de un vistazo. Por eso
 * la fecha está igual, en chico, al lado — sirve para conciliar contra el
 * extracto.
 *
 * Los tres tramos no son estéticos: a los 3 días la escuela ya quedó mal, y a
 * los 7 la persona probablemente escribió por WhatsApp preguntando.
 */

export interface DepositRow {
  depositId: string;
  interestId: string;
  fullName: string | null;
  email: string;
  amount: string;
  currency: "GBP" | "USD" | "EUR";
  tripCurrency: "GBP" | "USD" | "EUR";
  provisionalAmountInTripCurrency: string;
  suggestedFxRate: string | null;
  transferDate: string;
  shownAmount: string;
  acceptedAt: Date;
  createdAt: Date;
  waitingDays: number;
}

/** Días de espera a partir de los cuales el contador cambia de tono. */
const WAIT_WARNING = 3;
const WAIT_DANGER = 7;

export function DepositQueue({
  tripId,
  rows,
  locale,
}: {
  tripId: string;
  rows: DepositRow[];
  locale: "es" | "en";
}) {
  const t = useTranslations("depositReview");

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-2xl font-semibold">{t("title")}</h2>
        <p className="text-muted-foreground text-sm">
          {t("count", { count: rows.length })}
        </p>
      </div>

      <ul className="space-y-4">
        {rows.map((row) => (
          <DepositCard
            key={row.depositId}
            tripId={tripId}
            row={row}
            locale={locale}
          />
        ))}
      </ul>
    </section>
  );
}

function WaitingBadge({ days }: { days: number }) {
  const t = useTranslations("depositReview");

  const tone =
    days >= WAIT_DANGER
      ? "border-status-danger/40 bg-status-danger-surface text-status-danger"
      : days >= WAIT_WARNING
        ? "border-status-warning/40 bg-status-warning-surface text-status-warning"
        : "border-border bg-muted text-muted-foreground";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium ${tone}`}
    >
      {/* El ícono acompaña siempre al color: el semáforo nunca va solo, para
          quien no distingue rojo de verde. Misma regla que el resto del
          sistema. */}
      {days >= WAIT_DANGER ? (
        <TriangleAlert className="size-4" aria-hidden="true" />
      ) : (
        <Clock className="size-4" aria-hidden="true" />
      )}
      {days === 0 ? t("waitingToday") : t("waitingDays", { days })}
    </span>
  );
}

function DepositCard({
  tripId,
  row,
  locale,
}: {
  tripId: string;
  row: DepositRow;
  locale: "es" | "en";
}) {
  const t = useTranslations("depositReview");
  const [pending, startTransition] = useTransition();

  const [roomType, setRoomType] = useState<"DOBLE" | "SINGLE">("DOBLE");
  const [fxRate, setFxRate] = useState(row.suggestedFxRate ?? "");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const converts = row.currency !== row.tripCurrency;

  function confirm() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await confirmDepositAction(tripId, {
        depositId: row.depositId,
        roomType,
        fxRateUsed: converts ? fxRate.trim() || null : null,
        // Si el coordinador dejó la sugerencia intacta, la procedencia es
        // SUGERIDO; si la tipeó mirando el extracto, INGRESADO. La distinción
        // importa al conciliar y por eso se guarda.
        fxRateSource: converts
          ? fxRate.trim() === (row.suggestedFxRate ?? "")
            ? "SUGERIDO"
            : "INGRESADO"
          : null,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessage(result.alreadyResolved ? t("alreadyResolved") : t("converted"));
    });
  }

  function reject() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await rejectDepositAction(tripId, {
        depositId: row.depositId,
        reason: reason.trim(),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setRejecting(false);
      setMessage(t("rejected"));
    });
  }

  return (
    <li className="border-border bg-card space-y-4 rounded-lg border p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-lg font-medium">{row.fullName ?? row.email}</p>
          <p className="text-muted-foreground text-sm [overflow-wrap:anywhere]">
            {row.email}
          </p>
        </div>
        <WaitingBadge days={row.waitingDays} />
      </div>

      <dl className="grid gap-x-6 gap-y-2 text-base sm:grid-cols-2">
        <div className="flex justify-between gap-2 sm:block">
          <dt className="text-muted-foreground text-sm">{t("declared")}</dt>
          <dd className="font-medium">
            {formatMoney(row.amount, row.currency, locale)}
          </dd>
        </div>
        <div className="flex justify-between gap-2 sm:block">
          <dt className="text-muted-foreground text-sm">{t("transferDate")}</dt>
          <dd className="font-medium">{formatDate(row.transferDate)}</dd>
        </div>
        {/* Lo que se le pidió cuando aceptó, que puede no ser lo que el viaje
            pide hoy: si le subieron la seña después, ella no debe la
            diferencia. Verlo acá evita rechazar un pago que estaba bien. */}
        <div className="flex justify-between gap-2 sm:block">
          <dt className="text-muted-foreground text-sm">{t("shownAmount")}</dt>
          <dd className="font-medium">
            {formatMoney(row.shownAmount, row.tripCurrency, locale)}
          </dd>
        </div>
        <div className="flex justify-between gap-2 sm:block">
          <dt className="text-muted-foreground text-sm">{t("submittedOn")}</dt>
          <dd className="font-medium">{formatDate(row.createdAt)}</dd>
        </div>
      </dl>

      <Button asChild variant="outline" size="sm">
        <a
          href={`/api/senas/${row.depositId}`}
          target="_blank"
          rel="noreferrer noopener"
        >
          <ExternalLink aria-hidden="true" />
          {t("openProof")}
        </a>
      </Button>

      {converts ? (
        <div className="space-y-1.5">
          <label
            className="text-base font-medium"
            htmlFor={`fx-${row.depositId}`}
          >
            {t("fxRate", { from: row.currency, to: row.tripCurrency })}
          </label>
          <Input
            id={`fx-${row.depositId}`}
            inputMode="decimal"
            value={fxRate}
            onChange={(event) => setFxRate(event.target.value)}
          />
          <p className="text-muted-foreground text-sm">
            {t("fxHint", {
              amount: formatMoney(
                row.provisionalAmountInTripCurrency,
                row.tripCurrency,
                locale,
              ),
            })}
          </p>
        </div>
      ) : null}

      {rejecting ? (
        <div className="space-y-2">
          <label
            className="text-base font-medium"
            htmlFor={`reason-${row.depositId}`}
          >
            {t("reasonLabel")}
          </label>
          <Textarea
            id={`reason-${row.depositId}`}
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={t("reasonPlaceholder")}
          />
          <p className="text-muted-foreground text-sm">{t("reasonHint")}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="destructive"
              disabled={pending || reason.trim().length < 5}
              onClick={reject}
            >
              {t("confirmReject")}
            </Button>
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() => setRejecting(false)}
            >
              {t("cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <label className="text-base font-medium" id={`rt-${row.depositId}`}>
              {t("roomType")}
            </label>
            <Select
              value={roomType}
              onValueChange={(value) =>
                setRoomType(value as "DOBLE" | "SINGLE")
              }
            >
              <SelectTrigger
                aria-labelledby={`rt-${row.depositId}`}
                className="w-40"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="DOBLE">{t("roomDouble")}</SelectItem>
                <SelectItem value="SINGLE">{t("roomSingle")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button disabled={pending} onClick={confirm}>
            {t("confirmAndConvert")}
          </Button>
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() => setRejecting(true)}
          >
            {t("reject")}
          </Button>
        </div>
      )}

      {message ? (
        <p role="status" className="text-status-ok text-base">
          {message}
        </p>
      ) : null}

      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </li>
  );
}

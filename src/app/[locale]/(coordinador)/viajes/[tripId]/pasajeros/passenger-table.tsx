"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, BedDouble, CircleCheck, CircleDashed, Users } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PassportBadge } from "@/components/passenger/passport-alert";
import { cn } from "@/lib/utils";
import { confirmPassengerAction } from "./actions";
import type { PassengerRow } from "./types";

/**
 * Listado de pasajeros con semáforo.
 *
 * Tres indicadores por fila —datos, pagos, pasaporte— para que se entienda en
 * dos segundos quién necesita atención. Ninguno depende solo del color: cada
 * uno lleva ícono con forma propia y texto.
 *
 * El filtro "necesitan atención" es el que se va a usar de verdad: con catorce
 * pasajeros, lo que importa no es la lista sino los tres que están frenados.
 */
export function PassengerTable({
  tripId,
  passengers,
}: {
  tripId: string;
  passengers: PassengerRow[];
}) {
  const t = useTranslations("passengers");
  const [filter, setFilter] = useState<"all" | "attention">("all");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const needsAttention = (row: PassengerRow) =>
    !row.isCoordinator &&
    row.status !== "CANCELADO" &&
    (!row.isComplete ||
      row.passportLevel === "BLOQUEANTE" ||
      row.passportLevel === "SIN_DATO" ||
      row.needsRoommate);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return passengers.filter((row) => {
      if (filter === "attention" && !needsAttention(row)) return false;
      if (term && !(row.fullName ?? "").toLowerCase().includes(term)) {
        return false;
      }
      return true;
    });
  }, [passengers, filter, search]);

  function confirm(passengerId: string) {
    setError(null);
    startTransition(async () => {
      const result = await confirmPassengerAction(tripId, passengerId);
      if (!result.ok) setError(result.error);
    });
  }

  if (passengers.length === 0) {
    return (
      <div className="border-border flex flex-col items-center gap-3 rounded-xl border border-dashed py-12 text-center">
        <Users className="text-muted-foreground size-8" aria-hidden="true" />
        <p className="text-muted-foreground text-base text-balance">
          {t("empty")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("searchLabel")}
          aria-label={t("searchLabel")}
          className="max-w-xs"
        />
        <Select
          value={filter}
          onValueChange={(value) => setFilter(value as "all" | "attention")}
        >
          <SelectTrigger aria-label={t("filterLabel")} className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("filterAll")}</SelectItem>
            <SelectItem value="attention">
              {t("filterNeedsAttention")}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <ul className="divide-border divide-y">
        {rows.map((row) => (
          <li key={row.id} className="py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/viajes/${tripId}/pasajeros/${row.id}`}
                    className="text-base font-medium underline-offset-4 hover:underline"
                  >
                    {row.fullName ?? "—"}
                  </Link>
                  {row.isCoordinator ? (
                    <Badge variant="secondary">{t("coordinatorTag")}</Badge>
                  ) : null}
                  <Badge variant="outline">{t(`statuses.${row.status}`)}</Badge>
                </div>

                {/* Semáforo */}
                <div className="flex flex-wrap items-center gap-2">
                  <StatusChip
                    ok={row.isComplete}
                    okLabel={t("dataComplete")}
                    pendingLabel={t("dataIncomplete", {
                      percent: row.completionPercentage,
                    })}
                  />
                  <PassportBadge level={row.passportLevel} />
                  {/* Los pagos llegan en la fase 4: por ahora el tercer
                      indicador dice lo único cierto, que no hay plan. */}
                  <StatusChip ok={false} pendingLabel={t("paymentsPending")} />
                  {row.needsRoommate ? (
                    <span className="text-status-warning border-status-warning/40 bg-status-warning-surface inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm">
                      <BedDouble className="size-4" aria-hidden="true" />
                      {t("needsRoommate")}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {row.roomLabel ? (
                  <span className="text-muted-foreground text-sm">
                    {row.roomLabel}
                  </span>
                ) : null}
                {!row.isCoordinator && row.status === "REGISTRADO" ? (
                  <Button
                    size="sm"
                    disabled={pending}
                    onClick={() => confirm(row.id)}
                  >
                    {pending ? t("confirming") : t("confirm")}
                  </Button>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatusChip({
  ok,
  okLabel,
  pendingLabel,
}: {
  ok: boolean;
  okLabel?: string;
  pendingLabel: string;
}) {
  const Icon = ok ? CircleCheck : CircleDashed;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm",
        ok
          ? "border-status-ok/40 bg-status-ok-surface text-status-ok"
          : "border-border bg-muted text-muted-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      {ok ? (okLabel ?? "") : pendingLabel}
    </span>
  );
}

"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle, CircleAlert, CircleCheck, CircleHelp } from "lucide-react";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PassportAlertLevel } from "@/lib/domain/passport";

/**
 * Alerta de pasaporte.
 *
 * La ve el coordinador en el listado y el pasajero en su home, con el mismo
 * texto: no hay una versión "técnica" y otra "amable". Lo que explica no es
 * el estado sino POR QUÉ es un problema y qué hay que hacer, porque «pasaporte
 * en amarillo» no le dice nada a nadie.
 *
 * El color nunca va solo: cada nivel tiene un ícono de forma distinta y un
 * texto, para quien no distingue rojo de verde.
 */
export interface PassportAlertProps {
  level: PassportAlertLevel;
  /** ISO "aaaa-mm-dd". `null` si todavía no lo cargó. */
  expiryDate: string | null;
  tripEndDate: string;
  /** Vencimiento mínimo que permitiría confirmarlo. ISO. */
  minimumToConfirm: string;
  validityMonths: number;
  /** El viaje exige la validez completa (destino tipo Schengen). */
  requiresFullValidity: boolean;
}

const STYLES: Record<
  PassportAlertLevel,
  { icon: typeof CircleCheck; className: string }
> = {
  OK: {
    icon: CircleCheck,
    className: "border-status-ok/40 bg-status-ok-surface text-status-ok",
  },
  ADVERTENCIA: {
    icon: AlertTriangle,
    className:
      "border-status-warning/40 bg-status-warning-surface text-status-warning",
  },
  BLOQUEANTE: {
    icon: CircleAlert,
    className:
      "border-status-danger/40 bg-status-danger-surface text-status-danger",
  },
  SIN_DATO: {
    icon: CircleHelp,
    className: "border-border bg-muted text-muted-foreground",
  },
};

export function PassportAlert(props: PassportAlertProps) {
  const t = useTranslations("passport");
  const { icon: Icon, className } = STYLES[props.level];

  if (props.level === "OK") return null;

  const title =
    props.level === "SIN_DATO"
      ? t("missing")
      : props.level === "BLOQUEANTE"
        ? t("blocking")
        : t("warning");

  const detail = (() => {
    if (props.level === "SIN_DATO") return t("missingDetail");
    if (!props.expiryDate) return t("missingDetail");

    const expiry = formatDate(props.expiryDate);

    if (props.level === "BLOQUEANTE") {
      // Dos motivos distintos para el mismo rojo, y conviene distinguirlos:
      // el pasaporte vence durante el viaje, o vence antes de lo que exige
      // el destino. El segundo caso sorprende, así que se explica entero.
      return props.requiresFullValidity &&
        props.expiryDate > props.tripEndDate
        ? t("blockingByPolicyDetail", {
            expiry,
            months: props.validityMonths,
            minimumDate: formatDate(props.minimumToConfirm),
          })
        : t("blockingDetail", {
            expiry,
            tripEnd: formatDate(props.tripEndDate),
          });
    }

    return t("warningDetail", { expiry, months: props.validityMonths });
  })();

  return (
    <div
      role={props.level === "BLOQUEANTE" ? "alert" : "status"}
      className={cn("space-y-1 rounded-xl border p-4", className)}
    >
      <p className="flex items-center gap-2 font-medium">
        <Icon className="size-5 shrink-0" aria-hidden="true" />
        {title}
      </p>
      <p className="text-foreground/90 text-base text-balance">{detail}</p>
      {props.level !== "SIN_DATO" ? (
        <p className="text-foreground/70 text-sm">{t("renewAdvice")}</p>
      ) : null}
    </div>
  );
}

/** Versión compacta para las filas del listado del coordinador. */
export function PassportBadge({ level }: { level: PassportAlertLevel }) {
  const t = useTranslations("passport");
  const { icon: Icon, className } = STYLES[level];

  const label =
    level === "OK"
      ? t("okShort")
      : level === "ADVERTENCIA"
        ? t("warningShort")
        : level === "BLOQUEANTE"
          ? t("blockingShort")
          : t("missingShort");

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm",
        className,
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      {label}
    </span>
  );
}

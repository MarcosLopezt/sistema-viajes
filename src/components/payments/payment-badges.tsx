import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/**
 * Los tres semáforos de pagos, en un solo lugar.
 *
 * El color nunca va solo: cada estado lleva su texto al lado. Un semáforo que
 * solo es color no lo lee quien no distingue rojo de verde —y son bastantes—
 * ni quien mira la pantalla al sol.
 */

export type PaymentLight = "VERDE" | "AMARILLO" | "ROJO" | "NEUTRO";

const LIGHT_CLASS: Record<PaymentLight, string> = {
  VERDE: "bg-status-ok-surface text-status-ok border-status-ok/30",
  AMARILLO:
    "bg-status-warning-surface text-status-warning border-status-warning/30",
  ROJO: "bg-status-danger-surface text-status-danger border-status-danger/30",
  NEUTRO: "bg-muted text-muted-foreground border-border",
};

const LIGHT_DOT: Record<PaymentLight, string> = {
  VERDE: "bg-status-ok",
  AMARILLO: "bg-status-warning",
  ROJO: "bg-status-danger",
  NEUTRO: "bg-muted-foreground",
};

export function PaymentLightBadge({
  light,
  className,
}: {
  light: PaymentLight;
  className?: string;
}) {
  const t = useTranslations("payments.light");

  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-sm font-medium whitespace-nowrap",
        LIGHT_CLASS[light],
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn("size-2 shrink-0 rounded-full", LIGHT_DOT[light])}
      />
      {t(light)}
    </span>
  );
}

export type InstallmentState =
  | "PAGADA"
  | "VENCIDA"
  | "EN_REVISION"
  | "PENDIENTE"
  | "CONGELADA";

const STATE_LIGHT: Record<InstallmentState, PaymentLight> = {
  PAGADA: "VERDE",
  VENCIDA: "ROJO",
  EN_REVISION: "AMARILLO",
  PENDIENTE: "NEUTRO",
  CONGELADA: "NEUTRO",
};

export function InstallmentStateBadge({
  state,
  className,
}: {
  state: InstallmentState;
  className?: string;
}) {
  const t = useTranslations("payments.states");
  const light = STATE_LIGHT[state];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-sm font-medium whitespace-nowrap",
        LIGHT_CLASS[light],
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn("size-2 shrink-0 rounded-full", LIGHT_DOT[light])}
      />
      {t(state)}
    </span>
  );
}

export function PaymentStatusBadge({
  status,
}: {
  status: "EN_REVISION" | "CONFIRMADO" | "RECHAZADO";
}) {
  const t = useTranslations("payments.paymentStates");
  const light: PaymentLight =
    status === "CONFIRMADO"
      ? "VERDE"
      : status === "RECHAZADO"
        ? "ROJO"
        : "AMARILLO";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-sm font-medium whitespace-nowrap",
        LIGHT_CLASS[light],
      )}
    >
      <span
        aria-hidden="true"
        className={cn("size-2 shrink-0 rounded-full", LIGHT_DOT[light])}
      />
      {t(status)}
    </span>
  );
}

import { useTranslations } from "next-intl";
import { Check, CircleAlert, Clock, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Los tres semáforos de pagos, en un solo lugar.
 *
 * El color nunca va solo: cada estado tiene ADEMÁS un ícono de forma
 * distinta —no el mismo punto pintado de otro color—, más su texto al lado.
 * Es el mismo criterio que ya usan `PassportBadge` y el `StatusChip` del
 * listado de pasajeros, en la misma fila que este badge: por eso el ícono
 * queda en `size-4`, igual que esos dos, y no rompe la altura de fila que ya
 * conviven ahí.
 */

export type PaymentLight = "VERDE" | "AMARILLO" | "ROJO" | "NEUTRO";

const LIGHT_CLASS: Record<PaymentLight, string> = {
  VERDE: "bg-status-ok-surface text-status-ok border-status-ok/30",
  AMARILLO:
    "bg-status-warning-surface text-status-warning border-status-warning/30",
  ROJO: "bg-status-danger-surface text-status-danger border-status-danger/30",
  NEUTRO: "bg-muted text-muted-foreground border-border",
};

const LIGHT_ICON: Record<PaymentLight, typeof Check> = {
  VERDE: Check,
  AMARILLO: Clock,
  ROJO: CircleAlert,
  NEUTRO: Minus,
};

export function PaymentLightBadge({
  light,
  className,
}: {
  light: PaymentLight;
  className?: string;
}) {
  const t = useTranslations("payments.light");
  const Icon = LIGHT_ICON[light];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm font-medium whitespace-nowrap",
        LIGHT_CLASS[light],
        className,
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
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
  const Icon = LIGHT_ICON[light];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm font-medium whitespace-nowrap",
        LIGHT_CLASS[light],
        className,
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
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
  const Icon = LIGHT_ICON[light];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm font-medium whitespace-nowrap",
        LIGHT_CLASS[light],
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      {t(status)}
    </span>
  );
}

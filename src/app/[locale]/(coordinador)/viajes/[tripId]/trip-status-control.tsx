"use client";

import { Fragment, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { changeStatusAction } from "../actions";
import type { TripStatus } from "@/generated/prisma/enums";

/**
 * Control de estado del viaje: el mismo badge que antes era de solo lectura
 * ahora abre el menú de transiciones válidas.
 *
 * ── Por qué no hay una lista de los cuatro estados ────────────────────────
 *
 * `allowedTransitions` viene calculado por el servidor a partir de la MISMA
 * tabla que `updateTripStatus` vuelve a chequear al guardar (trip.ts:63-69).
 * Este componente no decide qué transición es válida, solo la etiqueta y el
 * texto de la confirmación: si el prop llegara desactualizado —dos
 * coordinadoras mirando la misma pantalla—, el servidor la rechaza igual y
 * el diálogo muestra ese motivo, no un estado inconsistente silencioso.
 *
 * ── Por qué "Finalizar" no cierra al tocar el botón de acción ─────────────
 *
 * `AlertDialogAction` cierra el diálogo apenas se hace click, antes de saber
 * si el servidor aceptó el cambio. Acá hace falta esperar la respuesta para
 * poder mostrar el error en el propio diálogo si algo salió mal, así que el
 * botón de confirmar es un `Button` común controlado a mano (mismo patrón que
 * `RevertPaymentButton` en pagos/[passengerId]/payment-actions.tsx).
 */

type EdgeKind = "forward" | "backward" | "irreversible";

interface EdgeConfig {
  kind: EdgeKind;
  labelKey: string;
  titleKey: string;
  bodyKey: string;
}

/** Copy de cada arista de trip.ts:63-69. Ver el comentario de arriba. */
const EDGE_CONFIG: Record<string, EdgeConfig> = {
  "BORRADOR->ABIERTO": {
    kind: "forward",
    labelKey: "openTrip",
    titleKey: "confirmOpenTitle",
    bodyKey: "confirmOpenBody",
  },
  "ABIERTO->CERRADO": {
    kind: "forward",
    labelKey: "closeTrip",
    titleKey: "confirmCloseTitle",
    bodyKey: "confirmCloseBody",
  },
  "CERRADO->FINALIZADO": {
    kind: "irreversible",
    labelKey: "finalizeTrip",
    titleKey: "confirmFinalizeTitle",
    bodyKey: "confirmFinalizeBody",
  },
  "ABIERTO->BORRADOR": {
    kind: "backward",
    labelKey: "revertToDraft",
    titleKey: "confirmRevertToDraftTitle",
    bodyKey: "confirmRevertToDraftBody",
  },
  "CERRADO->ABIERTO": {
    kind: "backward",
    labelKey: "reopenTrip",
    titleKey: "confirmReopenTitle",
    bodyKey: "confirmReopenBody",
  },
};

interface Edge {
  to: TripStatus;
  config: EdgeConfig;
}

export function TripStatusControl({
  tripId,
  status,
  allowedTransitions,
}: {
  tripId: string;
  status: TripStatus;
  allowedTransitions: readonly TripStatus[];
}) {
  const t = useTranslations("tripStatus");
  const tCommon = useTranslations("common");

  const [target, setTarget] = useState<TripStatus | null>(null);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const edges: Edge[] = allowedTransitions
    .map((to) => ({ to, config: EDGE_CONFIG[`${status}->${to}`] }))
    .filter((edge): edge is Edge => Boolean(edge.config))
    // La transición sin vuelta atrás siempre va al final y separada: es la
    // única que pide un paso más, y eso tiene que verse antes de tocarla.
    .sort(
      (a, b) =>
        Number(a.config.kind === "irreversible") -
        Number(b.config.kind === "irreversible"),
    );

  const active = edges.find((edge) => edge.to === target) ?? null;

  function openConfirm(to: TripStatus) {
    setTarget(to);
    setAck(false);
    setError(null);
  }

  function handleOpenChange(open: boolean) {
    if (!open && busy) return; // no se cierra a mitad de un guardado
    if (!open) setTarget(null);
  }

  async function confirm() {
    if (!target) return;
    setBusy(true);
    setError(null);

    const result = await changeStatusAction(tripId, target);

    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setTarget(null);
  }

  if (edges.length === 0) {
    // FINALIZADO: sin transiciones, el badge vuelve a ser de solo lectura.
    return <Badge variant="secondary">{t(status)}</Badge>;
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t("changeLabel")}
            className="inline-flex items-center gap-1 rounded-4xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <Badge variant="secondary">{t(status)}</Badge>
            <ChevronDown
              className="text-muted-foreground size-3.5"
              aria-hidden="true"
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {edges.map((edge, index) => (
            <Fragment key={edge.to}>
              {edge.config.kind === "irreversible" && index > 0 ? (
                <DropdownMenuSeparator />
              ) : null}
              <DropdownMenuItem
                variant={
                  edge.config.kind === "irreversible" ? "destructive" : "default"
                }
                onSelect={() => openConfirm(edge.to)}
              >
                {t(edge.config.labelKey)}
              </DropdownMenuItem>
            </Fragment>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={target !== null} onOpenChange={handleOpenChange}>
        <AlertDialogContent>
          {active ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>{t(active.config.titleKey)}</AlertDialogTitle>
                <AlertDialogDescription className="text-base">
                  {t(active.config.bodyKey)}
                </AlertDialogDescription>
              </AlertDialogHeader>

              {active.config.kind === "irreversible" ? (
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="trip-status-finalize-ack"
                    checked={ack}
                    onCheckedChange={(value) => setAck(value === true)}
                  />
                  <Label
                    htmlFor="trip-status-finalize-ack"
                    className="text-base"
                  >
                    {t("confirmFinalizeCheckbox")}
                  </Label>
                </div>
              ) : null}

              {error ? (
                <Alert variant="destructive" role="alert">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}

              <AlertDialogFooter>
                <AlertDialogCancel disabled={busy}>
                  {tCommon("cancel")}
                </AlertDialogCancel>
                <Button
                  variant={
                    active.config.kind === "irreversible"
                      ? "destructive"
                      : "default"
                  }
                  disabled={
                    busy || (active.config.kind === "irreversible" && !ack)
                  }
                  onClick={confirm}
                >
                  {busy ? (
                    <Loader2 className="animate-spin" aria-hidden="true" />
                  ) : null}
                  {t("confirm")}
                </Button>
              </AlertDialogFooter>
            </>
          ) : null}
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

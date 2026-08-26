"use client";

import { useCallback, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import type { ActionResult } from "@/app/[locale]/(coordinador)/viajes/actions";

/**
 * Estado de guardado compartido por todos los pasos del wizard.
 *
 * El autoguardado tiene que ser visible sin ser molesto: el coordinador
 * necesita saber que lo que cargó quedó guardado antes de pasar al paso
 * siguiente o cerrar la pestaña, pero un cartel por cada tecla sería ruido.
 * Por eso el indicador es chico y persistente, no un toast.
 */
export type SaveStatus = "idle" | "saving" | "saved" | "error";

export interface UseSaveResult {
  status: SaveStatus;
  error: string | null;
  pending: boolean;
  /**
   * Ejecuta una acción y refleja su resultado.
   * Devuelve el resultado para que quien llama pueda actualizar su estado
   * local con el id que asignó el servidor.
   */
  save: <T>(action: () => Promise<ActionResult<T>>) => Promise<ActionResult<T>>;
}

export function useSave(): UseSaveResult {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = useCallback(
    <T,>(action: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> => {
      setStatus("saving");
      setError(null);

      return new Promise((resolve) => {
        startTransition(async () => {
          const result = await action();
          if (result.ok) {
            setStatus("saved");
          } else {
            setStatus("error");
            setError(result.error);
          }
          resolve(result);
        });
      });
    },
    [],
  );

  return { status, error, pending, save };
}

export function SaveIndicator({
  status,
  error,
}: {
  status: SaveStatus;
  error: string | null;
}) {
  const t = useTranslations("budget.actions");

  if (status === "idle") return null;

  if (status === "error") {
    return (
      <p
        role="alert"
        className="text-status-danger flex items-center gap-1.5 text-sm"
      >
        <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
        {error ?? t("saveError")}
      </p>
    );
  }

  return (
    <p
      role="status"
      aria-live="polite"
      className="text-muted-foreground flex items-center gap-1.5 text-sm"
    >
      {status === "saving" ? (
        <>
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          {t("saving")}
        </>
      ) : (
        <>
          <Check className="text-status-ok size-4" aria-hidden="true" />
          {t("saved")}
        </>
      )}
    </p>
  );
}

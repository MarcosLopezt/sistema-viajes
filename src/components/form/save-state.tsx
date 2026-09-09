"use client";

import { useCallback, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, Check, Loader2 } from "lucide-react";

/**
 * Estado de guardado compartido por cualquier wizard con autoguardado por
 * paso o por fila (presupuesto del coordinador, datos de la pasajera).
 *
 * El autoguardado tiene que ser visible sin ser molesto: quien está cargando
 * datos necesita saber que lo que hizo quedó guardado antes de avanzar o
 * cerrar la pestaña, pero un cartel por cada tecla sería ruido. Por eso el
 * indicador es chico y persistente, no un toast — y un guardado que falla
 * se muestra igual de visible, nunca en silencio.
 *
 * El tipo de resultado es estructural a propósito: no importa el
 * `ActionResult` de ninguna ruta puntual, para poder usarse desde
 * cualquier árbol de Server Actions sin acoplar un módulo de componentes a
 * otro.
 */
export type SaveActionResult<T = void> =
  | ({ ok: true } & (T extends void ? { data?: undefined } : { data: T }))
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

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
  save: <T>(action: () => Promise<SaveActionResult<T>>) => Promise<SaveActionResult<T>>;
}

export function useSave(): UseSaveResult {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = useCallback(
    <T,>(action: () => Promise<SaveActionResult<T>>): Promise<SaveActionResult<T>> => {
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
  namespace = "budget.actions",
}: {
  status: SaveStatus;
  error: string | null;
  /** Namespace de i18n con las claves saving/saved/saveError. */
  namespace?: string;
}) {
  const t = useTranslations(namespace);

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

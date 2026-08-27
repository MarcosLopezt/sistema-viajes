"use client";

import { useId } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Campo de formulario con etiqueta, ayuda y error.
 *
 * El error se muestra JUNTO AL CAMPO y en lenguaje humano, nunca como un
 * cartel general arriba del formulario ni con un código. Es un criterio de
 * aceptación, y tenerlo en un componente evita que cada pantalla lo resuelva
 * a su manera.
 *
 * `aria-describedby` enlaza ayuda y error al control para que un lector de
 * pantalla los lea al enfocarlo, no solo quien los ve.
 */
export function Field({
  label,
  help,
  error,
  required,
  className,
  children,
}: {
  label: string;
  help?: string;
  error?: string | undefined;
  required?: boolean;
  className?: string;
  children: (props: {
    id: string;
    "aria-describedby": string | undefined;
    "aria-invalid": boolean;
  }) => React.ReactNode;
}) {
  const id = useId();
  const helpId = help ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id} className="text-base">
        {label}
        {required ? (
          <span aria-hidden="true" className="text-muted-foreground">
            *
          </span>
        ) : null}
      </Label>

      {children({
        id,
        "aria-describedby": describedBy,
        "aria-invalid": Boolean(error),
      })}

      {help ? (
        <p id={helpId} className="text-muted-foreground text-sm">
          {help}
        </p>
      ) : null}

      {/* El error va en 16px, no en 14 como la ayuda. Es el texto que alguien
          TIENE que leer para poder seguir: si hay un solo renglón de esta
          pantalla que no puede quedar chico, es este. */}
      {error ? (
        <p id={errorId} className="text-status-danger text-base">
          {error}
        </p>
      ) : null}
    </div>
  );
}

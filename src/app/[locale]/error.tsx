"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

/**
 * Pantalla de error del panel.
 *
 * Nunca se le muestra al usuario el mensaje crudo del error: podría contener
 * un id, un email o un fragmento de consulta. Se muestra un texto humano y el
 * detalle técnico queda del lado del servidor.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errors");

  useEffect(() => {
    // Solo el digest, que es el identificador anónimo que genera Next para
    // poder cruzar este error con el log del servidor.
    console.error("Error en la interfaz", error.digest);
  }, [error]);

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-5 px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">{t("genericTitle")}</h1>
      <p className="text-muted-foreground max-w-md text-base text-balance">
        {t("genericBody")}
      </p>
      <Button size="lg" onClick={reset}>
        {t("retry")}
      </Button>
    </main>
  );
}

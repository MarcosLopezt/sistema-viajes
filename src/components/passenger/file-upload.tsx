"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Camera, Check, ExternalLink, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { compressImage } from "@/lib/compress-image";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  confirmUploadAction,
  getFileUrlAction,
  requestUploadAction,
} from "@/app/[locale]/(pasajero)/mis-datos/actions";

/**
 * Subida del certificado de cobertura médica.
 *
 * El archivo va DIRECTO del navegador al bucket con una URL firmada; no pasa
 * por el servidor, que en Vercel chocaría con el límite de body y el timeout.
 * El servidor autoriza antes (decide la path) y verifica después (consulta el
 * objeto real): lo que el cliente declara no se le cree.
 *
 * Las imágenes se comprimen antes de salir. Un PDF se sube tal cual.
 */
const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";
const MAX_BYTES = 8 * 1024 * 1024;

type Status = "idle" | "compressing" | "uploading" | "done" | "error";

export function MedicalFileUpload({
  passengerId,
  currentPath,
  onUploaded,
}: {
  passengerId: string;
  currentPath: string | null;
  onUploaded: (path: string) => void;
}) {
  const t = useTranslations("register.step3");
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>(currentPath ? "done" : "idle");
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);

    if (!ACCEPT.split(",").includes(file.type)) {
      setStatus("error");
      setError(t("errorType"));
      return;
    }

    try {
      setStatus("compressing");
      const prepared = await compressImage(file);

      // Se valida el tamaño DESPUÉS de comprimir: una foto de 10 MB que baja
      // a 800 KB es perfectamente válida, y rechazarla antes sería absurdo.
      if (prepared.size > MAX_BYTES) {
        setStatus("error");
        setError(t("errorSize"));
        return;
      }

      setStatus("uploading");

      const authorized = await requestUploadAction(passengerId, {
        contentType: prepared.type,
        size: prepared.size,
      });
      if (!authorized.ok) {
        setStatus("error");
        setError(authorized.error);
        return;
      }

      const supabase = createSupabaseBrowserClient();
      const { error: uploadError } = await supabase.storage
        .from(authorized.data.bucket)
        .uploadToSignedUrl(
          authorized.data.path,
          authorized.data.token,
          prepared,
          { contentType: prepared.type },
        );

      if (uploadError) {
        setStatus("error");
        setError(t("errorGeneric"));
        return;
      }

      const confirmed = await confirmUploadAction(
        passengerId,
        authorized.data.path,
      );
      if (!confirmed.ok) {
        setStatus("error");
        setError(confirmed.error);
        return;
      }

      setStatus("done");
      onUploaded(authorized.data.path);
    } catch {
      setStatus("error");
      setError(t("errorGeneric"));
    }
  }

  async function openFile() {
    if (!currentPath) return;
    const result = await getFileUrlAction(passengerId, currentPath);
    if (result.ok) window.open(result.data, "_blank", "noopener,noreferrer");
  }

  const busy = status === "compressing" || status === "uploading";

  return (
    <div className="space-y-3">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        // `capture` hace que en el celular se abra directamente la cámara,
        // que es como la mayoría va a subir esto.
        capture="environment"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
          event.target.value = "";
        }}
      />

      {status === "done" && currentPath ? (
        <div className="border-status-ok/40 bg-status-ok-surface flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
          <p className="text-status-ok flex items-center gap-2 text-base font-medium">
            <Check className="size-5" aria-hidden="true" />
            {t("uploaded")}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={openFile}>
              <ExternalLink aria-hidden="true" />
              {t("view")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => inputRef.current?.click()}
            >
              {t("replace")}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          size="lg"
          variant="outline"
          className="w-full"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? (
            <>
              <Loader2 className="animate-spin" aria-hidden="true" />
              {status === "compressing" ? t("compressing") : t("uploading")}
            </>
          ) : (
            <>
              <Camera aria-hidden="true" />
              {t("takePhoto")}
            </>
          )}
        </Button>
      )}

      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

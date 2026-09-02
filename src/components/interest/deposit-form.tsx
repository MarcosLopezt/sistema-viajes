"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Camera, Check, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/form/field";
import { Input } from "@/components/ui/input";
import { PlainText } from "@/components/public/plain-text";
import { compressImage } from "@/lib/compress-image";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  requestDepositUploadAction,
  submitDepositAction,
} from "@/app/[locale]/(interesada)/mi-viaje/actions";

/**
 * El formulario de la seña: comprobante más aceptación de la condición.
 *
 * ── Por qué es UN formulario y no dos pasos ───────────────────────────────
 *
 * Porque el modelo no admite una cosa sin la otra: en `DepositProof` el
 * comprobante y el texto aceptado son columnas NOT NULL de la misma fila. Un
 * asistente de dos pasos sugeriría que se puede subir ahora y aceptar después,
 * y eso no existe.
 *
 * El archivo sí se sube antes —va directo al bucket, sin pasar por el
 * servidor— pero hasta que ella no manda el formulario no hay ninguna fila: lo
 * que queda es un objeto huérfano en el bucket, que no es una seña a medias.
 *
 * ── La condición se muestra entera, no se linkea ──────────────────────────
 *
 * Nada de "acepto los términos y condiciones" con un link. El texto está
 * arriba de la casilla, completo y en pantalla, porque es exactamente el que
 * se va a guardar como prueba de lo que leyó. Un link que capaz no abrió
 * volvería inútil todo el registro legal.
 */

const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";
const MAX_BYTES = 8 * 1024 * 1024;

type Status = "idle" | "compressing" | "uploading" | "ready" | "saving";

export function DepositForm({
  terms,
  amountLabel,
}: {
  /** El texto EXACTO de la condición. Se manda de vuelta tal cual. */
  terms: string;
  /** El monto que se le está pidiendo, ya formateado. Solo para mostrar. */
  amountLabel: string;
}) {
  const t = useTranslations("deposit");
  const inputRef = useRef<HTMLInputElement>(null);

  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [proofPath, setProofPath] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("GBP");
  const [transferDate, setTransferDate] = useState("");
  const [accepted, setAccepted] = useState(false);

  async function handleFile(file: File) {
    setError(null);

    if (!ACCEPT.split(",").includes(file.type)) {
      setError(t("errorType"));
      return;
    }

    try {
      setStatus("compressing");
      const prepared = await compressImage(file);

      // Se valida el tamaño DESPUÉS de comprimir: una foto de 10 MB que baja
      // a 800 KB es perfectamente válida.
      if (prepared.size > MAX_BYTES) {
        setStatus("idle");
        setError(t("errorSize"));
        return;
      }

      setStatus("uploading");
      const authorized = await requestDepositUploadAction({
        contentType: prepared.type,
        size: prepared.size,
      });

      if (!authorized.ok) {
        setStatus("idle");
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
        setStatus("idle");
        setError(t("errorGeneric"));
        return;
      }

      setProofPath(authorized.data.path);
      setFileName(file.name);
      setStatus("ready");
    } catch {
      setStatus("idle");
      setError(t("errorGeneric"));
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!proofPath) {
      setError(t("errorNoProof"));
      return;
    }

    setStatus("saving");

    const result = await submitDepositAction({
      amount: amount.trim(),
      currency,
      transferDate,
      proofFileId: proofPath,
      // El texto tal como se lo mostró esta pantalla. El servidor lo compara
      // contra el vigente y rechaza si cambió mientras ella completaba.
      acceptedTermsText: terms,
      acceptsTerms: accepted,
    });

    if (!result.ok) {
      setStatus("ready");
      setError(result.error);
      return;
    }
    // En éxito no se toca el estado: `revalidatePath` vuelve a renderizar la
    // página del servidor y este formulario desaparece, reemplazado por el
    // panel de "en revisión".
  }

  const busy = status === "compressing" || status === "uploading";
  const saving = status === "saving";

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        // En el celular abre la cámara directamente, que es como la mayoría va
        // a mandar la captura de la transferencia.
        capture="environment"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
          event.target.value = "";
        }}
      />

      <div className="space-y-3">
        <p className="text-base font-medium">{t("proofTitle")}</p>

        {proofPath ? (
          <div className="border-status-ok/40 bg-status-ok-surface flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
            <p className="text-status-ok flex items-center gap-2 text-base font-medium">
              <Check className="size-5 shrink-0" aria-hidden="true" />
              <span className="[overflow-wrap:anywhere]">
                {fileName ?? t("proofUploaded")}
              </span>
            </p>
            <Button
              type="button"
              variant="ghost"
              disabled={saving}
              onClick={() => inputRef.current?.click()}
            >
              {t("proofReplace")}
            </Button>
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
                {t("proofButton")}
              </>
            )}
          </Button>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("amount")} help={amountLabel} required>
          {(props) => (
            <Input
              {...props}
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              required
            />
          )}
        </Field>

        <Field label={t("currency")} required>
          {(props) => (
            <select
              {...props}
              className="border-input bg-background h-11 w-full rounded-md border px-3 text-base"
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
            >
              <option value="GBP">GBP</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </select>
          )}
        </Field>
      </div>

      <Field label={t("transferDate")} help={t("transferDateHint")} required>
        {(props) => (
          <Input
            {...props}
            type="date"
            value={transferDate}
            onChange={(event) => setTransferDate(event.target.value)}
            required
          />
        )}
      </Field>

      {/* La condición, completa y en pantalla. Es el texto que se guarda. */}
      <section className="border-border bg-muted/40 space-y-3 rounded-lg border p-4">
        <h3 className="text-base font-medium">{t("termsTitle")}</h3>
        <PlainText text={terms} className="text-sm" />

        <label className="flex cursor-pointer items-start gap-3 pt-1 text-base">
          <input
            type="checkbox"
            className="mt-1 size-5 shrink-0"
            checked={accepted}
            onChange={(event) => setAccepted(event.target.checked)}
            required
          />
          <span>{t("termsAccept")}</span>
        </label>
      </section>

      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={saving || busy || !proofPath || !accepted}
      >
        {saving ? (
          <>
            <Loader2 className="animate-spin" aria-hidden="true" />
            {t("submitting")}
          </>
        ) : (
          t("submit")
        )}
      </Button>
    </form>
  );
}

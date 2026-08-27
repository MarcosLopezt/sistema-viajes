"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Camera, Check, Loader2, Upload } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/form/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { compressImage } from "@/lib/compress-image";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatMoney, type CurrencyCode, type LocaleCode } from "@/lib/format";
import {
  declarePaymentAction,
  requestProofUploadAction,
} from "./actions";

/**
 * El pasajero informa una transferencia.
 *
 * Declara importe, moneda, fecha y comprobante. NO hay campo de tipo de
 * cambio, y eso es a propósito: nadie sabe a cuánto le liquidó el banco hasta
 * que ve el resumen, y si se lo preguntáramos escribiría la cotización de
 * Google. El TC real lo carga el coordinador al revisar.
 *
 * El comprobante va DIRECTO al bucket con una URL firmada, igual que el
 * certificado médico de la fase 3.
 */

const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";
const MAX_BYTES = 8 * 1024 * 1024;
const CURRENCIES: CurrencyCode[] = ["GBP", "USD", "EUR"];

export interface InstallmentOption {
  id: string;
  number: number;
  remaining: string;
  dueDate: string;
}

type Stage = "form" | "compressing" | "uploading" | "saving" | "done";

export function PaymentForm({
  passengerId,
  installments,
  tripCurrency,
  locale,
  defaultInstallmentId,
  onDone,
}: {
  passengerId: string;
  installments: InstallmentOption[];
  tripCurrency: CurrencyCode;
  locale: LocaleCode;
  defaultInstallmentId: string | null;
  onDone: () => void;
}) {
  const t = useTranslations("myPayments");
  const tPayments = useTranslations("payments");
  const inputRef = useRef<HTMLInputElement>(null);

  const [installmentId, setInstallmentId] = useState(
    defaultInstallmentId ?? installments[0]?.id ?? "",
  );
  const [amount, setAmount] = useState(
    installments.find((i) => i.id === defaultInstallmentId)?.remaining ?? "",
  );
  const [currency, setCurrency] = useState<CurrencyCode>(tripCurrency);
  const [transferDate, setTransferDate] = useState("");
  const [proofPath, setProofPath] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>("form");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const busy = stage !== "form" && stage !== "done";

  async function handleFile(file: File) {
    setError(null);

    if (!ACCEPT.split(",").includes(file.type)) {
      setError(tPayments("noProof"));
      return;
    }

    try {
      setStage("compressing");
      const prepared = await compressImage(file);

      // El tamaño se valida DESPUÉS de comprimir: una foto de 10 MB que baja
      // a 800 KB es perfectamente válida.
      if (prepared.size > MAX_BYTES) {
        setStage("form");
        setError(tPayments("noProof"));
        return;
      }

      setStage("uploading");
      const authorized = await requestProofUploadAction(passengerId, {
        contentType: prepared.type,
        size: prepared.size,
      });
      if (!authorized.ok) {
        setStage("form");
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
        setStage("form");
        setError(tPayments("noProof"));
        return;
      }

      setProofPath(authorized.data.path);
      setStage("form");
    } catch {
      setStage("form");
      setError(tPayments("noProof"));
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});

    if (!proofPath) {
      setError(t("formProofHelp"));
      return;
    }

    setStage("saving");
    const result = await declarePaymentAction(passengerId, {
      installmentId,
      amount: amount.trim(),
      currency,
      transferDate,
      proofFileId: proofPath,
    });

    if (!result.ok) {
      setStage("form");
      setError(result.error);
      setFieldErrors(result.fieldErrors ?? {});
      return;
    }

    setStage("done");
    onDone();
  }

  if (stage === "done") {
    return (
      <Alert className="border-status-ok/40 bg-status-ok-surface">
        <Check className="size-5" aria-hidden="true" />
        <AlertDescription className="text-status-ok text-base">
          {t("formSuccess")}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Field
        label={t("formInstallment")}
        required
        error={fieldErrors["installmentId"]?.[0]}
      >
        {(props) => (
          <Select
            value={installmentId}
            onValueChange={(value) => {
              setInstallmentId(value);
              const cuota = installments.find((i) => i.id === value);
              if (cuota) setAmount(cuota.remaining);
            }}
          >
            <SelectTrigger id={props.id} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {installments.map((cuota) => (
                <SelectItem key={cuota.id} value={cuota.id}>
                  {tPayments("installment", { number: cuota.number })} ·{" "}
                  {formatMoney(cuota.remaining, tripCurrency, locale)} ·{" "}
                  {cuota.dueDate}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>

      <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
        <Field
          label={t("formAmount")}
          required
          error={fieldErrors["amount"]?.[0]}
        >
          {(props) => (
            <Input
              {...props}
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          )}
        </Field>

        <Field label={t("formCurrency")} required>
          {(props) => (
            <Select
              value={currency}
              onValueChange={(value) => setCurrency(value as CurrencyCode)}
            >
              <SelectTrigger id={props.id} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((code) => (
                  <SelectItem key={code} value={code}>
                    {code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Field>
      </div>

      {currency !== tripCurrency ? (
        <p className="text-muted-foreground text-sm">{t("formNoRate")}</p>
      ) : null}

      <Field
        label={t("formTransferDate")}
        required
        error={fieldErrors["transferDate"]?.[0]}
      >
        {(props) => (
          <Input
            {...props}
            type="date"
            value={transferDate}
            onChange={(event) => setTransferDate(event.target.value)}
          />
        )}
      </Field>

      <div className="space-y-2">
        <p className="text-base font-medium">{t("formProof")}</p>
        <p className="text-muted-foreground text-sm">{t("formProofHelp")}</p>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          capture="environment"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleFile(file);
            event.target.value = "";
          }}
        />

        {proofPath ? (
          <div className="border-status-ok/40 bg-status-ok-surface flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3">
            <span className="text-status-ok flex items-center gap-2 text-base font-medium">
              <Check className="size-5" aria-hidden="true" />
              {tPayments("proof")}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => inputRef.current?.click()}
            >
              {t("formProof")}
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
            {stage === "compressing" || stage === "uploading" ? (
              <>
                <Loader2 className="animate-spin" aria-hidden="true" />
                {t("formSubmitting")}
              </>
            ) : (
              <>
                <Camera aria-hidden="true" />
                {t("formProof")}
              </>
            )}
          </Button>
        )}
      </div>

      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="lg" disabled={busy || !proofPath}>
          {stage === "saving" ? (
            <>
              <Loader2 className="animate-spin" aria-hidden="true" />
              {t("formSubmitting")}
            </>
          ) : (
            <>
              <Upload aria-hidden="true" />
              {t("formSubmit")}
            </>
          )}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone} disabled={busy}>
          {t("formCancel")}
        </Button>
      </div>
    </form>
  );
}

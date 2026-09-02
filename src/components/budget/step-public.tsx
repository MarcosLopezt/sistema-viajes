"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, ExternalLink, Globe } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { WizardPublicZone } from "./types";

/**
 * Paso 6 — la zona pública.
 *
 * ── Esta pantalla no escribe el tono, lo alberga ──────────────────────────
 *
 * Todos los campos de acá son la voz de la escuela, y la escriben ellas. Lo
 * único que aporta el sistema son los rótulos y una explicación de dónde va a
 * aparecer cada texto: nadie puede escribir bien un mensaje sin saber quién lo
 * lee y cuándo.
 *
 * ── Por qué son textareas y no un editor enriquecido ──────────────────────
 *
 * Porque lo que se guarda se muestra como TEXTO, con los saltos de línea
 * respetados y las URLs convertidas en links. Nunca como HTML. Es la misma
 * decisión que ya tomó el editor de comunicaciones, y acá pesa más: esto sale
 * en una pantalla pública, sin sesión. Ver src/lib/domain/rich-text.ts.
 *
 * El inglés queda opcional en todos los campos: si está vacío se muestra el
 * español. Una escuela que todavía no tradujo su propuesta tiene que poder
 * abrir la inscripción igual.
 */
export function StepPublic({
  values,
  publicUrl,
  disabled,
  onSaveTexts,
  onToggleAccepting,
}: {
  values: WizardPublicZone;
  /** URL de /interes, para copiar al botón de Wix. */
  publicUrl: string;
  disabled?: boolean;
  onSaveTexts: (
    next: WizardPublicZone,
  ) => Promise<{ ok: boolean; error?: string }>;
  onToggleAccepting: (
    accepting: boolean,
  ) => Promise<{ ok: boolean; error?: string }>;
}) {
  const t = useTranslations("budget.publicZone");

  const [draft, setDraft] = useState(values);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof WizardPublicZone, value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));

  async function handleSave() {
    setBusy(true);
    setError(null);
    const result = await onSaveTexts(draft);
    setBusy(false);
    if (!result.ok) setError(result.error ?? t("saveFailed"));
  }

  async function handleToggle() {
    const next = !draft.acceptingInterest;
    setBusy(true);
    setError(null);
    const result = await onToggleAccepting(next);
    setBusy(false);

    if (result.ok) {
      setDraft((current) => ({ ...current, acceptingInterest: next }));
    } else {
      setError(result.error ?? t("toggleFailed"));
    }
  }

  /** Un campo de marca: el español obligatorio en la práctica, el inglés al lado. */
  const pair = (
    keyEs: keyof WizardPublicZone,
    keyEn: keyof WizardPublicZone,
    rows: number,
  ) => (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor={keyEs}>{t("spanish")}</Label>
        <Textarea
          id={keyEs}
          rows={rows}
          disabled={disabled}
          value={String(draft[keyEs])}
          onChange={(e) => set(keyEs, e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={keyEn}>{t("englishOptional")}</Label>
        <Textarea
          id={keyEn}
          rows={rows}
          disabled={disabled}
          value={String(draft[keyEn])}
          onChange={(e) => set(keyEn, e.target.value)}
        />
      </div>
    </div>
  );

  return (
    <div className="space-y-8">
      {/* ---------------------------------------------- el switch de captación */}
      <section className="border-border space-y-3 rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h3 className="flex items-center gap-2 font-semibold">
              <Globe className="size-4" aria-hidden="true" />
              {t("acceptingTitle")}
            </h3>
            <p className="text-muted-foreground text-sm">
              {draft.acceptingInterest ? t("acceptingOn") : t("acceptingOff")}
            </p>
          </div>
          <Button
            type="button"
            variant={draft.acceptingInterest ? "outline" : "default"}
            disabled={disabled || busy}
            onClick={handleToggle}
          >
            {draft.acceptingInterest ? t("closeIntake") : t("openIntake")}
          </Button>
        </div>

        {/* La URL para el botón de Wix. Es lo primero que van a necesitar y no
            tienen por dónde deducirla. */}
        <div className="space-y-1.5">
          <Label htmlFor="publicUrl">{t("linkForWix")}</Label>
          <div className="flex gap-2">
            <Input id="publicUrl" readOnly value={publicUrl} />
            <Button asChild variant="outline" size="icon">
              <a href={publicUrl} target="_blank" rel="noreferrer">
                <ExternalLink aria-hidden="true" />
                <span className="sr-only">{t("openPublicPage")}</span>
              </a>
            </Button>
          </div>
          <p className="text-muted-foreground text-sm">{t("linkHelp")}</p>
        </div>
      </section>

      {error ? (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {/* ------------------------------------------------- los textos de marca */}
      <section className="space-y-2">
        <h3 className="font-semibold">{t("infoTitle")}</h3>
        <p className="text-muted-foreground text-sm">{t("infoHelp")}</p>
        {pair("infoForInterestedEs", "infoForInterestedEn", 10)}
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold">{t("welcomeTitle")}</h3>
        <p className="text-muted-foreground text-sm">{t("welcomeHelp")}</p>
        {pair("welcomeMessageEs", "welcomeMessageEn", 3)}
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold">{t("nextStepTitle")}</h3>
        <p className="text-muted-foreground text-sm">{t("nextStepHelp")}</p>
        {pair("nextStepMessageEs", "nextStepMessageEn", 4)}
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold">{t("signatureTitle")}</h3>
        <p className="text-muted-foreground text-sm">{t("signatureHelp")}</p>
        {pair("emailSignatureEs", "emailSignatureEn", 2)}
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold">{t("depositTermsTitle")}</h3>
        <p className="text-muted-foreground text-sm">{t("depositTermsHelp")}</p>
        {pair("depositTermsEs", "depositTermsEn", 5)}
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold">{t("paymentInstructionsTitle")}</h3>
        <p className="text-muted-foreground text-sm">
          {t("paymentInstructionsHelp")}
        </p>
        {pair("paymentInstructionsEs", "paymentInstructionsEn", 5)}
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold">{t("closedTitle")}</h3>
        <p className="text-muted-foreground text-sm">{t("closedHelp")}</p>
        {pair("closedMessageEs", "closedMessageEn", 3)}
      </section>

      <Button type="button" disabled={disabled || busy} onClick={handleSave}>
        {t("save")}
      </Button>
    </div>
  );
}

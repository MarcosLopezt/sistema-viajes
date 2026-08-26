"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, Check, ExternalLink, Info, Pencil } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/form/field";
import { ConfirmDelete } from "@/components/budget/confirm-delete";
import { getFileUrlAction } from "@/app/[locale]/(pasajero)/mis-datos/actions";
import type { CurrencyCode } from "@/lib/format";
import {
  cancelPassengerAction,
  confirmPassengerAction,
  setPriceOverrideAction,
  updatePassengerDataAction,
} from "../actions";

type EditableValues = Record<string, string>;

/**
 * Ficha editable del pasajero.
 *
 * Editar datos ajenos no es lo mismo que editar los propios, y la pantalla lo
 * dice: hay un aviso explícito de que todo queda registrado y de que el
 * pasajero va a ver la modificación. La transparencia es parte del diseño,
 * no una nota al pie.
 */
export function PassengerEditor({
  tripId,
  passengerId,
  passengerName,
  currency,
  status,
  isCoordinator,
  completionPercentage,
  isComplete,
  blocksConfirmation,
  priceOverride,
  priceOverrideReason,
  values,
  hasDietaryRestrictions,
  hasMobilityRestrictions,
  medicalFilePath,
}: {
  tripId: string;
  passengerId: string;
  passengerName: string;
  currency: CurrencyCode;
  status: "INVITADO" | "REGISTRADO" | "CONFIRMADO" | "CANCELADO";
  isCoordinator: boolean;
  completionPercentage: number;
  isComplete: boolean;
  blocksConfirmation: boolean;
  priceOverride: string | null;
  priceOverrideReason: string | null;
  values: EditableValues;
  hasDietaryRestrictions: boolean;
  hasMobilityRestrictions: boolean;
  medicalFilePath: string | null;
}) {
  const t = useTranslations("passengers");
  const tStep1 = useTranslations("register.step1");
  const tStep2 = useTranslations("register.step2");
  const tStep3 = useTranslations("register.step3");

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(values);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const set = (key: string, value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));

  function save() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await updatePassengerDataAction(tripId, passengerId, {
        ...draft,
        // El coordinador no cambia los booleanos de restricción, solo su
        // detalle: quien declara una restricción es la persona.
      });
      if (result.ok) {
        setEditing(false);
        setMessage(t("saveData"));
      } else {
        setError(result.error);
      }
    });
  }

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await confirmPassengerAction(tripId, passengerId);
      if (!result.ok) setError(result.error);
    });
  }

  async function openFile() {
    if (!medicalFilePath) return;
    const result = await getFileUrlAction(passengerId, medicalFilePath);
    if (result.ok) window.open(result.data, "_blank", "noopener,noreferrer");
  }

  // El botón de confirmar se deshabilita, pero el servicio vuelve a validar:
  // un botón gris no protege nada por sí solo.
  const canConfirm = status === "REGISTRADO" && isComplete && !blocksConfirmation;
  const blockedReason = !isComplete
    ? t("cannotConfirmData")
    : blocksConfirmation
      ? t("cannotConfirmPassport")
      : null;

  return (
    <div className="space-y-6">
      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {message ? (
        <Alert role="status">
          <Check aria-hidden="true" />
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}

      {/* Acciones de estado */}
      {!isCoordinator && status !== "CANCELADO" ? (
        <div className="flex flex-wrap items-center gap-3">
          {status === "REGISTRADO" ? (
            <>
              <Button disabled={!canConfirm || pending} onClick={confirm}>
                {pending ? t("confirming") : t("confirm")}
              </Button>
              {blockedReason ? (
                <p className="text-muted-foreground text-sm text-balance">
                  {blockedReason}
                </p>
              ) : null}
            </>
          ) : null}

          <ConfirmDelete
            label={`${t("cancel")} ${passengerName}`}
            description={t("cancelConfirm", { name: passengerName })}
            onConfirm={() =>
              startTransition(async () => {
                await cancelPassengerAction(tripId, passengerId);
              })
            }
          />
        </div>
      ) : null}

      {/* Datos */}
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3">
          <CardTitle className="text-xl">{t("detailTitle")}</CardTitle>
          {!editing ? (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Pencil aria-hidden="true" />
              {t("editData")}
            </Button>
          ) : null}
        </CardHeader>

        <CardContent className="space-y-5">
          {!isComplete ? (
            <p className="text-muted-foreground text-sm">
              {t("dataIncomplete", { percent: completionPercentage })}
            </p>
          ) : null}

          {editing ? (
            <>
              <Alert role="status">
                <Info aria-hidden="true" />
                <AlertDescription>
                  {t("editWarning", { name: passengerName })}
                </AlertDescription>
              </Alert>

              <div className="grid gap-4 sm:grid-cols-2">
                <TextField label={tStep1("fullName")} field="fullName" draft={draft} set={set} />
                <TextField label={tStep1("nationalityCountry")} field="nationalityCountry" draft={draft} set={set} />
                <TextField label={tStep1("residenceCountry")} field="residenceCountry" draft={draft} set={set} />
                <TextField label={tStep1("residenceCity")} field="residenceCity" draft={draft} set={set} />
                <TextField label={tStep1("residenceAddress")} field="residenceAddress" draft={draft} set={set} />
                <TextField label={tStep1("mobilePhone")} field="mobilePhone" draft={draft} set={set} type="tel" />
                <TextField label={tStep1("documentNumber")} field="documentNumber" draft={draft} set={set} />
                <TextField label={tStep1("passportNumber")} field="passportNumber" draft={draft} set={set} />
                <TextField label={tStep1("passportExpiryDate")} field="passportExpiryDate" draft={draft} set={set} type="date" />
                <TextField label={tStep2("emergencyContactName")} field="emergencyContactName" draft={draft} set={set} />
                <TextField label={tStep2("emergencyContactPhone")} field="emergencyContactPhone" draft={draft} set={set} type="tel" />
                <TextField label={tStep2("medicalAssuranceCompany")} field="medicalAssuranceCompany" draft={draft} set={set} />
                <TextField label={tStep2("medicalAssuranceId")} field="medicalAssuranceId" draft={draft} set={set} />
                <TextField label={tStep2("medicalAssurancePhone")} field="medicalAssurancePhone" draft={draft} set={set} type="tel" />
                <TextField label={tStep2("medicalAssuranceEmail")} field="medicalAssuranceEmail" draft={draft} set={set} type="email" />
              </div>

              {hasDietaryRestrictions ? (
                <Field label={tStep2("dietaryRestrictionsDetail")}>
                  {(props) => (
                    <Textarea
                      {...props}
                      value={draft["dietaryRestrictionsDetail"] ?? ""}
                      onChange={(e) => set("dietaryRestrictionsDetail", e.target.value)}
                    />
                  )}
                </Field>
              ) : null}

              {hasMobilityRestrictions ? (
                <Field label={tStep2("mobilityRestrictionsDetail")}>
                  {(props) => (
                    <Textarea
                      {...props}
                      value={draft["mobilityRestrictionsDetail"] ?? ""}
                      onChange={(e) => set("mobilityRestrictionsDetail", e.target.value)}
                    />
                  )}
                </Field>
              ) : null}

              <Field label={tStep2("otherHealthNotes")}>
                {(props) => (
                  <Textarea
                    {...props}
                    value={draft["otherHealthNotes"] ?? ""}
                    onChange={(e) => set("otherHealthNotes", e.target.value)}
                  />
                )}
              </Field>

              <div className="flex gap-2">
                <Button onClick={save} disabled={pending}>
                  {t("saveData")}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setDraft(values);
                    setEditing(false);
                  }}
                >
                  {tStep3("replace")}
                </Button>
              </div>
            </>
          ) : (
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <ReadOnly label={tStep1("nationalityCountry")} value={values["nationalityCountry"]} />
              <ReadOnly label={tStep1("residenceCity")} value={values["residenceCity"]} />
              <ReadOnly label={tStep1("mobilePhone")} value={values["mobilePhone"]} />
              <ReadOnly label={tStep1("documentNumber")} value={values["documentNumber"]} />
              <ReadOnly label={tStep1("passportNumber")} value={values["passportNumber"]} />
              <ReadOnly label={tStep1("passportExpiryDate")} value={values["passportExpiryDate"]} />
              <ReadOnly label={tStep2("emergencyContactName")} value={values["emergencyContactName"]} />
              <ReadOnly label={tStep2("emergencyContactPhone")} value={values["emergencyContactPhone"]} />
              <ReadOnly label={tStep2("medicalAssuranceCompany")} value={values["medicalAssuranceCompany"]} />
              <ReadOnly label={tStep2("medicalAssuranceId")} value={values["medicalAssuranceId"]} />
              {hasDietaryRestrictions ? (
                <ReadOnly label={tStep2("dietaryRestrictionsDetail")} value={values["dietaryRestrictionsDetail"]} />
              ) : null}
              {hasMobilityRestrictions ? (
                <ReadOnly label={tStep2("mobilityRestrictionsDetail")} value={values["mobilityRestrictionsDetail"]} />
              ) : null}
            </dl>
          )}

          {medicalFilePath ? (
            <Button variant="outline" size="sm" onClick={openFile}>
              <ExternalLink aria-hidden="true" />
              {tStep3("fileLabel")}
            </Button>
          ) : null}
        </CardContent>
      </Card>

      {!isCoordinator ? (
        <PriceOverride
          tripId={tripId}
          passengerId={passengerId}
          currency={currency}
          value={priceOverride}
          reason={priceOverrideReason}
        />
      ) : null}
    </div>
  );
}

function TextField({
  label,
  field,
  draft,
  set,
  type,
}: {
  label: string;
  field: string;
  draft: EditableValues;
  set: (key: string, value: string) => void;
  type?: string;
}) {
  return (
    <Field label={label}>
      {(props) => (
        <Input
          {...props}
          type={type ?? "text"}
          inputMode={type === "tel" ? "tel" : type === "email" ? "email" : undefined}
          value={draft[field] ?? ""}
          onChange={(event) => set(field, event.target.value)}
        />
      )}
    </Field>
  );
}

function ReadOnly({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="text-base">{value?.trim() ? value : "—"}</dd>
    </div>
  );
}

/**
 * Precio pactado para este pasajero.
 *
 * Es donde se resuelve el caso del single sin compañero. El sistema avisa en
 * el listado, pero no toca el precio: la decisión —y el motivo— son del
 * coordinador, y quedan en el AuditLog.
 */
function PriceOverride({
  tripId,
  passengerId,
  currency,
  value,
  reason,
}: {
  tripId: string;
  passengerId: string;
  currency: CurrencyCode;
  value: string | null;
  reason: string | null;
}) {
  const t = useTranslations("passengers");
  const [price, setPrice] = useState(value ?? "");
  const [why, setWhy] = useState(reason ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save(clear: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await setPriceOverrideAction(tripId, passengerId, {
        priceOverride: clear ? null : price,
        reason: clear ? null : why || null,
      });
      if (result.ok && clear) {
        setPrice("");
        setWhy("");
      }
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{t("priceOverrideTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground text-base text-balance">
          {t("priceOverrideHelp")}
        </p>

        {error ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={`${t("priceOverride")} (${currency})`}>
            {(props) => (
              <Input
                {...props}
                inputMode="decimal"
                placeholder="0.00"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
              />
            )}
          </Field>
          <Field label={t("priceOverrideReason")}>
            {(props) => (
              <Input
                {...props}
                value={why}
                onChange={(event) => setWhy(event.target.value)}
              />
            )}
          </Field>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            disabled={pending || price.trim() === ""}
            onClick={() => save(false)}
          >
            {t("priceOverrideSave")}
          </Button>
          {value ? (
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() => save(true)}
            >
              {t("priceOverrideClear")}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

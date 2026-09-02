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
  savePaymentInstructionsAction,
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
  paymentInstructions,
  tripPaymentInstructions,
  values,
  hasDietaryRestrictions,
  hasMobilityRestrictions,
  sensitive,
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
  /** Lo propio de esta pasajera. Null = usa el del viaje. */
  paymentInstructions: string | null;
  /** El del viaje, ya resuelto al idioma. Para mostrar cuál rige hoy. */
  tripPaymentInstructions: string | null;
  values: EditableValues;
  hasDietaryRestrictions: boolean;
  hasMobilityRestrictions: boolean;
  /**
   * Salud emocional: SOLO LECTURA, nunca editable desde acá.
   *
   * No es una limitación de la pantalla, es dónde termina una decisión de
   * diseño. Todo campo que un coordinador puede editar genera una entrada de
   * AuditLog con el valor viejo y el nuevo en claro; para un dato de salud
   * mental eso sería escribirlo en un log, que es exactamente lo que no puede
   * pasar. Se resolvió dejándolos fuera de COORDINATOR_EDITABLE
   * (src/lib/services/passengers.ts), y esto es la consecuencia visible.
   *
   * La pantalla lo dice con todas las letras para que no parezca un bug.
   */
  sensitive: {
    psychTreatment: boolean;
    psychTreatmentDetail: string | null;
    anxietyOrPanic: boolean;
    anxietyOrPanicDetail: string | null;
  };
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
                <TextField label={tStep1("birthDate")} field="birthDate" draft={draft} set={set} type="date" />
                <TextField label={tStep1("nationalityCountry")} field="nationalityCountry" draft={draft} set={set} />
                <TextField label={tStep1("passportIssuingCountry")} field="passportIssuingCountry" draft={draft} set={set} />
                <TextField label={tStep1("residenceCountry")} field="residenceCountry" draft={draft} set={set} />
                <TextField label={tStep1("residenceCity")} field="residenceCity" draft={draft} set={set} />
                <TextField label={tStep1("residenceAddress")} field="residenceAddress" draft={draft} set={set} />
                <TextField label={tStep1("mobilePhone")} field="mobilePhone" draft={draft} set={set} type="tel" />
                <TextField label={tStep1("documentNumber")} field="documentNumber" draft={draft} set={set} />
                <TextField label={tStep1("passportNumber")} field="passportNumber" draft={draft} set={set} />
                <TextField label={tStep1("passportExpiryDate")} field="passportExpiryDate" draft={draft} set={set} type="date" />
                <TextField label={tStep1("profession")} field="profession" draft={draft} set={set} />
                <TextField label={tStep2("emergencyContactName")} field="emergencyContactName" draft={draft} set={set} />
                <TextField label={tStep2("emergencyContactRelationship")} field="emergencyContactRelationship" draft={draft} set={set} />
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
              <ReadOnly label={tStep1("birthDate")} value={values["birthDate"]} />
              <ReadOnly label={tStep1("nationalityCountry")} value={values["nationalityCountry"]} />
              <ReadOnly label={tStep1("passportIssuingCountry")} value={values["passportIssuingCountry"]} />
              <ReadOnly label={tStep1("residenceCity")} value={values["residenceCity"]} />
              <ReadOnly label={tStep1("mobilePhone")} value={values["mobilePhone"]} />
              <ReadOnly label={tStep1("documentNumber")} value={values["documentNumber"]} />
              <ReadOnly label={tStep1("passportNumber")} value={values["passportNumber"]} />
              <ReadOnly label={tStep1("passportExpiryDate")} value={values["passportExpiryDate"]} />
              <ReadOnly label={tStep2("emergencyContactName")} value={values["emergencyContactName"]} />
              <ReadOnly label={tStep2("emergencyContactRelationship")} value={values["emergencyContactRelationship"]} />
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

      {/* Salud emocional, en su propia tarjeta y siempre en solo lectura. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("sensitiveTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <Info aria-hidden="true" />
            <AlertDescription>{t("sensitiveOnlyPassenger")}</AlertDescription>
          </Alert>

          {sensitive.psychTreatment || sensitive.anxietyOrPanic ? (
            <dl className="space-y-3">
              {sensitive.psychTreatment ? (
                <div>
                  <dt className="text-muted-foreground text-sm">
                    {t("psychTreatment")}
                  </dt>
                  <dd className="whitespace-pre-line">
                    {sensitive.psychTreatmentDetail || "—"}
                  </dd>
                </div>
              ) : null}
              {sensitive.anxietyOrPanic ? (
                <div>
                  <dt className="text-muted-foreground text-sm">
                    {t("anxietyOrPanic")}
                  </dt>
                  <dd className="whitespace-pre-line">
                    {sensitive.anxietyOrPanicDetail || "—"}
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : (
            <p className="text-muted-foreground">{t("sensitiveNotDeclared")}</p>
          )}
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

      {!isCoordinator ? (
        <PaymentInstructions
          tripId={tripId}
          passengerId={passengerId}
          value={paymentInstructions}
          tripValue={tripPaymentInstructions}
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

/**
 * Dónde transferir, para esta pasajera.
 *
 * ── Por qué va en su propia tarjeta, lejos del nombre y el pasaporte ─────
 *
 * Porque no es un dato de la persona: es una instrucción de la escuela sobre
 * dónde mandar plata. Editarlo en el mismo bloque que el número de pasaporte
 * sugeriría que es algo que ella declaró y que acá se corrige, cuando es
 * exactamente al revés — lo escribe la coordinadora y ella lo lee.
 *
 * ── Un campo vacío NO quiere decir "no hay instrucciones" ────────────────
 *
 * Quiere decir "usa el del viaje", y esa diferencia importa: alguien que ve un
 * textarea en blanco y no sabe que hay un texto general detrás va a pegar los
 * datos bancarios de nuevo acá, y a partir de ahí van a existir dos copias que
 * se van a desincronizar. Por eso la tarjeta dice SIEMPRE cuál está rigiendo
 * hoy, y cuando rige el del viaje lo muestra entero.
 */
function PaymentInstructions({
  tripId,
  passengerId,
  value,
  tripValue,
}: {
  tripId: string;
  passengerId: string;
  value: string | null;
  tripValue: string | null;
}) {
  const t = useTranslations("passengers");
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState(value ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(value);

  const usingOwn = saved !== null && saved.trim() !== "";

  function save(clear: boolean) {
    setError(null);
    startTransition(async () => {
      const next = clear ? null : text.trim() || null;
      const result = await savePaymentInstructionsAction(
        passengerId,
        tripId,
        next,
      );
      if (result.ok) {
        setSaved(next);
        if (clear) setText("");
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{t("paymentInstructionsTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground text-base text-balance">
          {t("paymentInstructionsHelp")}
        </p>

        {/* Cuál rige HOY. Va arriba del campo y no debajo: es lo que hay que
            saber ANTES de escribir nada. */}
        <div
          className={
            usingOwn
              ? "border-status-warning/40 bg-status-warning-surface space-y-2 rounded-lg border p-4"
              : "border-border bg-muted/40 space-y-2 rounded-lg border p-4"
          }
        >
          <p className="text-base font-medium">
            {usingOwn
              ? t("paymentInstructionsUsingOwn")
              : t("paymentInstructionsUsingTrip")}
          </p>
          {!usingOwn ? (
            tripValue ? (
              <p className="whitespace-pre-line text-sm">{tripValue}</p>
            ) : (
              <p className="text-muted-foreground text-sm">
                {t("paymentInstructionsTripEmpty")}
              </p>
            )
          ) : null}
        </div>

        {error ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <Field label={t("paymentInstructions")}>
          {(props) => (
            <Textarea
              {...props}
              rows={5}
              value={text}
              placeholder={t("paymentInstructionsPlaceholder")}
              onChange={(event) => setText(event.target.value)}
            />
          )}
        </Field>

        <div className="flex flex-wrap gap-2">
          <Button disabled={pending} onClick={() => save(false)}>
            {t("paymentInstructionsSave")}
          </Button>
          {usingOwn ? (
            <Button variant="ghost" disabled={pending} onClick={() => save(true)}>
              {t("paymentInstructionsClear")}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, Check, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field } from "@/components/form/field";
import { SaveIndicator, useSave } from "@/components/form/save-state";
import { evaluatePersonCompleteness } from "@/lib/domain/person";
import { formatMoney, type CurrencyCode } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  finishRegistrationAction,
  saveDraftAction,
  setRoomTypeAction,
} from "@/app/[locale]/(pasajero)/mis-datos/actions";
import { MedicalFileUpload } from "./file-upload";

/**
 * Formulario de datos del pasajero, en tres pasos.
 *
 * Diseñado a 375px y ensanchado después. Un solo botón primario por pantalla.
 *
 * ── Autoguardado ─────────────────────────────────────────────────────────
 *
 * Al pasar de paso se guarda lo que haya, sin validar. La acción usa
 * `personDraftSchema`, que acepta campos vacíos y mal formados. Si en cambio
 * se validara estricto acá, escribir "ana@" en el mail haría fallar el
 * guardado del paso entero y al volver no estaría nada.
 *
 * La validación de verdad corre una sola vez, al tocar "Terminar", y sus
 * errores se muestran al lado del campo que los causó.
 *
 * Si el guardado del borrador falla (red caída, sesión vencida), NO se
 * avanza de paso ni se llega a "Terminar" en silencio: `SaveIndicator`
 * muestra el error y el paso se queda donde está, con lo cargado todavía en
 * memoria. Avanzar igual dejaría a la pasajera un paso más allá de lo que
 * en verdad quedó guardado, y creería que perdió lo que escribió cuando en
 * realidad nunca se fue.
 */

export interface PersonValues {
  fullName: string;
  birthDate: string;
  nationalityCountry: string;
  passportIssuingCountry: string;
  residenceCountry: string;
  residenceAddress: string;
  residenceCity: string;
  mobilePhone: string;
  documentNumber: string;
  passportNumber: string;
  passportExpiryDate: string;
  profession: string;
  emergencyContactName: string;
  emergencyContactRelationship: string;
  emergencyContactPhone: string;
  medicalAssuranceCompany: string;
  medicalAssurancePhone: string;
  medicalAssuranceEmail: string;
  hasDietaryRestrictions: boolean;
  dietaryRestrictionsDetail: string;
  hasMobilityRestrictions: boolean;
  mobilityRestrictionsDetail: string;
  takesMedication: boolean;
  takesMedicationDetail: string;
  psychTreatment: boolean;
  psychTreatmentDetail: string;
  anxietyOrPanic: boolean;
  anxietyOrPanicDetail: string;
  otherHealthNotes: string;
  additionalInfo: string;
  preferredLanguage: "ES" | "EN";
  medicalAssuranceFileId: string | null;
}

const TOTAL_STEPS = 3;

export function RegistrationForm({
  passengerId,
  initialValues,
  roomType,
  passengerStatus,
  currency,
  priceDouble,
  priceSingle,
  onFinished,
}: {
  passengerId: string;
  initialValues: PersonValues;
  /** Null hasta que se elige. Ver el comentario en schema.prisma. */
  roomType: "DOBLE" | "SINGLE" | null;
  passengerStatus: "INVITADO" | "REGISTRADO" | "CONFIRMADO" | "CANCELADO";
  currency: CurrencyCode;
  priceDouble: string | null;
  priceSingle: string | null;
  onFinished?: () => void;
}) {
  const t = useTranslations("register");
  const tCommon = useTranslations("common");
  const [step, setStep] = useState(1);
  const [values, setValues] = useState(initialValues);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [finishing, startFinishTransition] = useTransition();
  const { status: saveStatus, error: saveError, pending: savePending, save } =
    useSave();
  const pending = finishing || savePending;

  const set = <K extends keyof PersonValues>(key: K, value: PersonValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  // El porcentaje sale del MISMO predicado que usa el coordinador para poder
  // confirmar. Si fueran dos cálculos distintos, el pasajero podría ver 100%
  // mientras el botón de confirmar sigue bloqueado.
  const completeness = useMemo(
    () =>
      evaluatePersonCompleteness({
        ...values,
        passportExpiryDate: values.passportExpiryDate
          ? new Date(`${values.passportExpiryDate}T00:00:00.000Z`)
          : null,
        birthDate: values.birthDate
          ? new Date(`${values.birthDate}T00:00:00.000Z`)
          : null,
      }),
    [values],
  );

  /**
   * Guarda lo que haya. No valida: para eso está "Terminar".
   *
   * Devuelve si el guardado tuvo éxito. Quien llama NO debe avanzar de paso
   * si esto da `false`: el error ya quedó visible en `SaveIndicator`, y lo
   * cargado sigue en `values` — no se perdió, solo no llegó todavía al
   * servidor.
   */
  async function saveDraft(): Promise<boolean> {
    const result = await save(() =>
      saveDraftAction(passengerId, {
        fullName: values.fullName,
        birthDate: values.birthDate,
        nationalityCountry: values.nationalityCountry,
        passportIssuingCountry: values.passportIssuingCountry,
        residenceCountry: values.residenceCountry,
        residenceAddress: values.residenceAddress,
        residenceCity: values.residenceCity,
        mobilePhone: values.mobilePhone,
        documentNumber: values.documentNumber,
        passportNumber: values.passportNumber,
        passportExpiryDate: values.passportExpiryDate,
        profession: values.profession,
        emergencyContactName: values.emergencyContactName,
        emergencyContactRelationship: values.emergencyContactRelationship,
        emergencyContactPhone: values.emergencyContactPhone,
        medicalAssuranceCompany: values.medicalAssuranceCompany,
        medicalAssurancePhone: values.medicalAssurancePhone,
        medicalAssuranceEmail: values.medicalAssuranceEmail,
        hasDietaryRestrictions: values.hasDietaryRestrictions,
        dietaryRestrictionsDetail: values.dietaryRestrictionsDetail,
        hasMobilityRestrictions: values.hasMobilityRestrictions,
        mobilityRestrictionsDetail: values.mobilityRestrictionsDetail,
        takesMedication: values.takesMedication,
        takesMedicationDetail: values.takesMedicationDetail,
        psychTreatment: values.psychTreatment,
        psychTreatmentDetail: values.psychTreatmentDetail,
        anxietyOrPanic: values.anxietyOrPanic,
        anxietyOrPanicDetail: values.anxietyOrPanicDetail,
        otherHealthNotes: values.otherHealthNotes,
        additionalInfo: values.additionalInfo,
        preferredLanguage: values.preferredLanguage,
      }),
    );
    return result.ok;
  }

  async function goToStep(next: number) {
    const saved = await saveDraft();
    if (!saved) return;
    setStep(Math.min(Math.max(next, 1), TOTAL_STEPS));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function finish() {
    startFinishTransition(async () => {
      const saved = await saveDraft();
      if (!saved) return;

      const result = await finishRegistrationAction(passengerId, {
        ...values,
        dietaryRestrictionsDetail: values.dietaryRestrictionsDetail || null,
        mobilityRestrictionsDetail: values.mobilityRestrictionsDetail || null,
        takesMedicationDetail: values.takesMedicationDetail || null,
        psychTreatmentDetail: values.psychTreatmentDetail || null,
        anxietyOrPanicDetail: values.anxietyOrPanicDetail || null,
        otherHealthNotes: values.otherHealthNotes || null,
        profession: values.profession || null,
        additionalInfo: values.additionalInfo || null,
      });

      if (result.ok) {
        setDone(true);
        setFieldErrors({});
        setFormError(null);
        onFinished?.();
        return;
      }

      setFieldErrors(result.fieldErrors ?? {});
      setFormError(result.error);

      // Se lo lleva al primer paso donde falta algo, en vez de dejarlo
      // buscando cuál de los tres tiene el problema.
      if (completeness.firstIncompleteStep) {
        setStep(completeness.firstIncompleteStep);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    });
  }

  const errorOf = (field: keyof PersonValues) => fieldErrors[field]?.[0];

  if (done) {
    return (
      <Alert role="status" className="border-status-ok/40 bg-status-ok-surface">
        <Check className="text-status-ok" aria-hidden="true" />
        <AlertDescription className="space-y-1">
          <strong className="text-base font-medium">{t("doneTitle")}</strong>
          <p className="text-base">{t("doneBody")}</p>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <ProgressHeader
        step={step}
        percent={completeness.completionPercentage}
      />

      {formError ? (
        <Alert variant="destructive" role="alert">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      {step === 1 ? (
        <Step1
          passengerId={passengerId}
          values={values}
          set={set}
          errorOf={errorOf}
          roomType={roomType}
          passengerStatus={passengerStatus}
          currency={currency}
          priceDouble={priceDouble}
          priceSingle={priceSingle}
        />
      ) : null}
      {step === 2 ? (
        <Step2 values={values} set={set} errorOf={errorOf} />
      ) : null}
      {step === 3 ? (
        <Step3
          passengerId={passengerId}
          values={values}
          set={set}
          errorOf={errorOf}
        />
      ) : null}

      <div className="space-y-1.5">
        <p className="text-muted-foreground text-sm">
          {t("savedAutomatically")}
        </p>
        <SaveIndicator status={saveStatus} error={saveError} namespace="register" />
      </div>

      <div className="flex items-center gap-3">
        {step > 1 ? (
          <Button
            variant="outline"
            size="lg"
            disabled={pending}
            onClick={() => void goToStep(step - 1)}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
        ) : null}

        {/* Un solo botón primario por pantalla. */}
        {step < TOTAL_STEPS ? (
          <Button
            size="lg"
            className="flex-1"
            disabled={pending}
            onClick={() => void goToStep(step + 1)}
          >
            {pending ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : null}
            {tCommon("next")}
            <ChevronRight aria-hidden="true" />
          </Button>
        ) : (
          <Button
            size="lg"
            className="flex-1"
            disabled={pending}
            onClick={finish}
          >
            {pending ? (
              <>
                <Loader2 className="animate-spin" aria-hidden="true" />
                {t("finishing")}
              </>
            ) : (
              t("finish")
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

function ProgressHeader({ step, percent }: { step: number; percent: number }) {
  const t = useTranslations("register");

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-muted-foreground text-sm">
          {t("stepOf", { current: step })} · {t(`steps.${step}`)}
        </p>
        <p className="text-muted-foreground text-sm tabular-nums">
          {t("progress", { percent })}
        </p>
      </div>
      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t("title")}
        className="bg-muted h-2.5 w-full overflow-hidden rounded-full"
      >
        <div
          className="bg-primary h-full rounded-full transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

type SetValue = <K extends keyof PersonValues>(
  key: K,
  value: PersonValues[K],
) => void;

type ErrorOf = (field: keyof PersonValues) => string | undefined;

function Step1({
  passengerId,
  values,
  set,
  errorOf,
  roomType,
  passengerStatus,
  currency,
  priceDouble,
  priceSingle,
}: {
  passengerId: string;
  values: PersonValues;
  set: SetValue;
  errorOf: ErrorOf;
  roomType: "DOBLE" | "SINGLE" | null;
  passengerStatus: "INVITADO" | "REGISTRADO" | "CONFIRMADO" | "CANCELADO";
  currency: CurrencyCode;
  priceDouble: string | null;
  priceSingle: string | null;
}) {
  const t = useTranslations("register.step1");

  return (
    <div className="space-y-5">
      <p className="text-muted-foreground text-base text-balance">
        {t("intro")}
      </p>

      <RoomTypeChoice
        passengerId={passengerId}
        roomType={roomType}
        passengerStatus={passengerStatus}
        currency={currency}
        priceDouble={priceDouble}
        priceSingle={priceSingle}
      />

      <Field label={t("language")} help={t("languageHelp")}>
        {(props) => (
          <Select
            value={values.preferredLanguage}
            onValueChange={(value) =>
              set("preferredLanguage", value as "ES" | "EN")
            }
          >
            <SelectTrigger id={props.id} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ES">Español</SelectItem>
              <SelectItem value="EN">English</SelectItem>
            </SelectContent>
          </Select>
        )}
      </Field>

      <Field
        label={t("fullName")}
        help={t("fullNameHelp")}
        error={errorOf("fullName")}
        required
      >
        {(props) => (
          <Input
            {...props}
            value={values.fullName}
            autoComplete="name"
            onChange={(e) => set("fullName", e.target.value)}
          />
        )}
      </Field>

      <Field
        label={t("birthDate")}
        error={errorOf("birthDate")}
        required
      >
        {(props) => (
          <Input
            {...props}
            type="date"
            value={values.birthDate}
            autoComplete="bday"
            onChange={(e) => set("birthDate", e.target.value)}
          />
        )}
      </Field>

      <Field
        label={t("nationalityCountry")}
        error={errorOf("nationalityCountry")}
        required
      >
        {(props) => (
          <Input
            {...props}
            value={values.nationalityCountry}
            autoComplete="country-name"
            onChange={(e) => set("nationalityCountry", e.target.value)}
          />
        )}
      </Field>

      <Field
        label={t("residenceCountry")}
        error={errorOf("residenceCountry")}
        required
      >
        {(props) => (
          <Input
            {...props}
            value={values.residenceCountry}
            onChange={(e) => set("residenceCountry", e.target.value)}
          />
        )}
      </Field>

      <Field
        label={t("residenceCity")}
        error={errorOf("residenceCity")}
        required
      >
        {(props) => (
          <Input
            {...props}
            value={values.residenceCity}
            autoComplete="address-level2"
            onChange={(e) => set("residenceCity", e.target.value)}
          />
        )}
      </Field>

      <Field
        label={t("residenceAddress")}
        error={errorOf("residenceAddress")}
        required
      >
        {(props) => (
          <Input
            {...props}
            value={values.residenceAddress}
            autoComplete="street-address"
            onChange={(e) => set("residenceAddress", e.target.value)}
          />
        )}
      </Field>

      <Field
        label={t("mobilePhone")}
        help={t("mobilePhoneHelp")}
        error={errorOf("mobilePhone")}
        required
      >
        {(props) => (
          <Input
            {...props}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={values.mobilePhone}
            onChange={(e) => set("mobilePhone", e.target.value)}
          />
        )}
      </Field>

      <Field
        label={t("documentNumber")}
        error={errorOf("documentNumber")}
        required
      >
        {(props) => (
          <Input
            {...props}
            inputMode="numeric"
            value={values.documentNumber}
            onChange={(e) => set("documentNumber", e.target.value)}
          />
        )}
      </Field>

      <Field
        label={t("passportNumber")}
        error={errorOf("passportNumber")}
        required
      >
        {(props) => (
          <Input
            {...props}
            // El pasaporte es alfanumérico: `numeric` escondería las letras.
            autoCapitalize="characters"
            value={values.passportNumber}
            onChange={(e) => set("passportNumber", e.target.value)}
          />
        )}
      </Field>

      <Field
        label={t("passportIssuingCountry")}
        help={t("passportIssuingCountryHelp")}
        error={errorOf("passportIssuingCountry")}
        required
      >
        {(props) => (
          <Input
            {...props}
            value={values.passportIssuingCountry}
            onChange={(e) => set("passportIssuingCountry", e.target.value)}
          />
        )}
      </Field>

      <Field
        label={t("passportExpiryDate")}
        error={errorOf("passportExpiryDate")}
        required
      >
        {(props) => (
          <Input
            {...props}
            type="date"
            value={values.passportExpiryDate}
            onChange={(e) => set("passportExpiryDate", e.target.value)}
          />
        )}
      </Field>

      {/* Opcional: no baja el porcentaje ni bloquea la confirmación. */}
      <Field label={t("profession")} error={errorOf("profession")}>
        {(props) => (
          <Input
            {...props}
            value={values.profession}
            autoComplete="organization-title"
            onChange={(e) => set("profession", e.target.value)}
          />
        )}
      </Field>
    </div>
  );
}

/**
 * Tipo de habitación.
 *
 * Vive en `Passenger`, no en `Person` —por eso no pasa por `saveDraft()` ni
 * por `saveDraftAction`— y por eso guarda sola, con su propio botón: es un
 * dato de OTRA tabla, con su propia autorización
 * (`setPassengerRoomType`, en lib/services/passengers.ts).
 *
 * Una vez CONFIRMADA, esa misma función la rechaza a ella: acá se muestra
 * de solo lectura en vez de ofrecer un control que el servidor va a negar.
 */
function RoomTypeChoice({
  passengerId,
  roomType,
  passengerStatus,
  currency,
  priceDouble,
  priceSingle,
}: {
  passengerId: string;
  roomType: "DOBLE" | "SINGLE" | null;
  passengerStatus: "INVITADO" | "REGISTRADO" | "CONFIRMADO" | "CANCELADO";
  currency: CurrencyCode;
  priceDouble: string | null;
  priceSingle: string | null;
}) {
  const t = useTranslations("register.step1");
  const tRooms = useTranslations("roomTypes");
  const [pending, startTransition] = useTransition();
  const [choice, setChoice] = useState<"DOBLE" | "SINGLE">(roomType ?? "DOBLE");
  const [saved, setSaved] = useState(roomType);
  const [error, setError] = useState<string | null>(null);

  const priceOf = (option: "DOBLE" | "SINGLE") =>
    option === "DOBLE" ? priceDouble : priceSingle;

  if (passengerStatus === "CONFIRMADO") {
    return (
      <div className="border-border space-y-1 rounded-lg border p-4">
        <p className="text-base font-medium">{t("roomTypeTitle")}</p>
        <p className="text-muted-foreground text-sm">
          {roomType === "DOBLE"
            ? tRooms("doubleExplained")
            : tRooms("singleExplained")}
        </p>
        <p className="text-muted-foreground text-sm">
          {t("roomTypeConfirmedNote")}
        </p>
      </div>
    );
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await setRoomTypeAction(passengerId, choice);
      if (result.ok) setSaved(choice);
      else setError(result.error);
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-base font-medium">{t("roomTypeTitle")}</p>

      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {(["DOBLE", "SINGLE"] as const).map((option) => {
          const price = priceOf(option);
          return (
            <label
              key={option}
              className={cn(
                "border-border cursor-pointer space-y-1 rounded-lg border p-4",
                choice === option && "border-primary bg-primary/5",
              )}
            >
              <span className="flex items-start gap-2">
                <input
                  type="radio"
                  name="roomType"
                  className="mt-1"
                  checked={choice === option}
                  onChange={() => setChoice(option)}
                />
                <span className="text-base font-medium">{tRooms(option)}</span>
              </span>
              <p className="text-muted-foreground text-sm">
                {tRooms(option === "DOBLE" ? "doubleExplained" : "singleExplained")}
              </p>
              <p className="text-base font-medium">
                {price !== null ? formatMoney(price, currency) : "—"}
              </p>
            </label>
          );
        })}
      </div>

      <Button
        type="button"
        variant="outline"
        disabled={pending || saved === choice}
        onClick={save}
      >
        {saved === choice ? (
          <>
            <Check aria-hidden="true" />
            {t("roomTypeSaved")}
          </>
        ) : (
          t("roomTypeSave")
        )}
      </Button>
    </div>
  );
}

function Step2({
  values,
  set,
  errorOf,
}: {
  values: PersonValues;
  set: SetValue;
  errorOf: ErrorOf;
}) {
  const t = useTranslations("register.step2");

  return (
    <div className="space-y-6">
      <p className="text-muted-foreground text-base text-balance">
        {t("intro")}
      </p>

      <section className="space-y-5">
        <h3 className="text-lg font-medium">{t("emergencyTitle")}</h3>

        <Field
          label={t("emergencyContactName")}
          help={t("emergencyContactNameHelp")}
          error={errorOf("emergencyContactName")}
          required
        >
          {(props) => (
            <Input
              {...props}
              value={values.emergencyContactName}
              onChange={(e) => set("emergencyContactName", e.target.value)}
            />
          )}
        </Field>

        <Field
          label={t("emergencyContactRelationship")}
          help={t("emergencyContactRelationshipHelp")}
          error={errorOf("emergencyContactRelationship")}
          required
        >
          {(props) => (
            <Input
              {...props}
              value={values.emergencyContactRelationship}
              onChange={(e) =>
                set("emergencyContactRelationship", e.target.value)
              }
            />
          )}
        </Field>

        <Field
          label={t("emergencyContactPhone")}
          error={errorOf("emergencyContactPhone")}
          required
        >
          {(props) => (
            <Input
              {...props}
              type="tel"
              inputMode="tel"
              value={values.emergencyContactPhone}
              onChange={(e) => set("emergencyContactPhone", e.target.value)}
            />
          )}
        </Field>
      </section>

      <section className="space-y-5">
        <h3 className="text-lg font-medium">{t("assuranceTitle")}</h3>

        <Field
          label={t("medicalAssuranceCompany")}
          error={errorOf("medicalAssuranceCompany")}
          required
        >
          {(props) => (
            <Input
              {...props}
              value={values.medicalAssuranceCompany}
              onChange={(e) => set("medicalAssuranceCompany", e.target.value)}
            />
          )}
        </Field>

        <Field
          label={t("medicalAssurancePhone")}
          error={errorOf("medicalAssurancePhone")}
          required
        >
          {(props) => (
            <Input
              {...props}
              type="tel"
              inputMode="tel"
              value={values.medicalAssurancePhone}
              onChange={(e) => set("medicalAssurancePhone", e.target.value)}
            />
          )}
        </Field>

        <Field
          label={t("medicalAssuranceEmail")}
          error={errorOf("medicalAssuranceEmail")}
          required
        >
          {(props) => (
            <Input
              {...props}
              type="email"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={values.medicalAssuranceEmail}
              onChange={(e) => set("medicalAssuranceEmail", e.target.value)}
            />
          )}
        </Field>
      </section>

      <section className="space-y-5">
        <h3 className="text-lg font-medium">{t("healthTitle")}</h3>

        <CheckboxField
          id="hasDietaryRestrictions"
          label={t("hasDietaryRestrictions")}
          help={t("hasDietaryRestrictionsHelp")}
          checked={values.hasDietaryRestrictions}
          onChange={(checked) => set("hasDietaryRestrictions", checked)}
        />

        {/* El detalle solo aparece si declaró la restricción: pedirlo siempre
            obligaría a escribir "ninguna" para poder terminar. */}
        {values.hasDietaryRestrictions ? (
          <Field
            label={t("dietaryRestrictionsDetail")}
            error={errorOf("dietaryRestrictionsDetail")}
            required
          >
            {(props) => (
              <Textarea
                {...props}
                value={values.dietaryRestrictionsDetail}
                onChange={(e) =>
                  set("dietaryRestrictionsDetail", e.target.value)
                }
              />
            )}
          </Field>
        ) : null}

        <CheckboxField
          id="hasMobilityRestrictions"
          label={t("hasMobilityRestrictions")}
          help={t("hasMobilityRestrictionsHelp")}
          checked={values.hasMobilityRestrictions}
          onChange={(checked) => set("hasMobilityRestrictions", checked)}
        />

        {values.hasMobilityRestrictions ? (
          <Field
            label={t("mobilityRestrictionsDetail")}
            error={errorOf("mobilityRestrictionsDetail")}
            required
          >
            {(props) => (
              <Textarea
                {...props}
                value={values.mobilityRestrictionsDetail}
                onChange={(e) =>
                  set("mobilityRestrictionsDetail", e.target.value)
                }
              />
            )}
          </Field>
        ) : null}

        <CheckboxField
          id="takesMedication"
          label={t("takesMedication")}
          help={t("takesMedicationHelp")}
          checked={values.takesMedication}
          onChange={(checked) => set("takesMedication", checked)}
        />

        {values.takesMedication ? (
          <Field
            label={t("takesMedicationDetail")}
            error={errorOf("takesMedicationDetail")}
            required
          >
            {(props) => (
              <Textarea
                {...props}
                value={values.takesMedicationDetail}
                onChange={(e) => set("takesMedicationDetail", e.target.value)}
              />
            )}
          </Field>
        ) : null}
      </section>

      {/* ------------------------------------------------------------------
          Salud mental.
          ------------------------------------------------------------------
          Va en su propia sección, con borde y con una explicación arriba de
          POR QUÉ se pregunta y QUIÉN lo lee. Pedirle a alguien un dato de
          salud mental en medio de una lista de campos, sin decirle a dónde va
          a parar, es la forma de que no lo conteste o conteste de mentira —
          y entonces el dato no sirve para lo único que tiene que servir, que
          es acompañarla si algo pasa en el viaje.

          El texto de la explicación NO lo escribe el sistema: sale del
          catálogo de i18n y las coordinadoras lo ajustan ahí. */}
      <section className="border-border space-y-5 rounded-lg border p-4">
        <div className="space-y-1">
          <h3 className="text-lg font-medium">{t("mentalHealthTitle")}</h3>
          <p className="text-muted-foreground text-base text-balance">
            {t("mentalHealthWhy")}
          </p>
          <p className="text-base font-medium">{t("mentalHealthWhoSees")}</p>
        </div>

        <CheckboxField
          id="psychTreatment"
          label={t("psychTreatment")}
          help={t("psychTreatmentHelp")}
          checked={values.psychTreatment}
          onChange={(checked) => set("psychTreatment", checked)}
        />

        {values.psychTreatment ? (
          <Field
            label={t("psychTreatmentDetail")}
            error={errorOf("psychTreatmentDetail")}
            required
          >
            {(props) => (
              <Textarea
                {...props}
                value={values.psychTreatmentDetail}
                onChange={(e) => set("psychTreatmentDetail", e.target.value)}
              />
            )}
          </Field>
        ) : null}

        <CheckboxField
          id="anxietyOrPanic"
          label={t("anxietyOrPanic")}
          help={t("anxietyOrPanicHelp")}
          checked={values.anxietyOrPanic}
          onChange={(checked) => set("anxietyOrPanic", checked)}
        />

        {values.anxietyOrPanic ? (
          <Field
            label={t("anxietyOrPanicDetail")}
            error={errorOf("anxietyOrPanicDetail")}
            required
          >
            {(props) => (
              <Textarea
                {...props}
                value={values.anxietyOrPanicDetail}
                onChange={(e) => set("anxietyOrPanicDetail", e.target.value)}
              />
            )}
          </Field>
        ) : null}
      </section>

      <section className="space-y-5">
        <Field
          label={t("otherHealthNotes")}
          help={t("otherHealthNotesHelp")}
        >
          {(props) => (
            <Textarea
              {...props}
              value={values.otherHealthNotes}
              onChange={(e) => set("otherHealthNotes", e.target.value)}
            />
          )}
        </Field>

        {/* Opcional y sin estructura, a propósito: es el lugar para lo que no
            entró en ningún campo. */}
        <Field label={t("additionalInfo")} help={t("additionalInfoHelp")}>
          {(props) => (
            <Textarea
              {...props}
              value={values.additionalInfo}
              onChange={(e) => set("additionalInfo", e.target.value)}
            />
          )}
        </Field>
      </section>
    </div>
  );
}

function Step3({
  passengerId,
  values,
  set,
  errorOf,
}: {
  passengerId: string;
  values: PersonValues;
  set: SetValue;
  errorOf: ErrorOf;
}) {
  const t = useTranslations("register.step3");

  return (
    <div className="space-y-5">
      <p className="text-muted-foreground text-base text-balance">
        {t("intro")}
      </p>

      <div className="space-y-2">
        <p className="text-base font-medium">{t("fileLabel")}</p>
        <p className="text-muted-foreground text-sm">{t("fileHelp")}</p>
      </div>

      <MedicalFileUpload
        passengerId={passengerId}
        currentPath={values.medicalAssuranceFileId}
        onUploaded={(path) => set("medicalAssuranceFileId", path)}
      />

      {errorOf("medicalAssuranceFileId") ? (
        <p role="alert" className="text-status-danger text-sm">
          {errorOf("medicalAssuranceFileId")}
        </p>
      ) : null}
    </div>
  );
}

function CheckboxField({
  id,
  label,
  help,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  help: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="border-border flex items-start gap-3 rounded-lg border p-4">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(value) => onChange(value === true)}
      />
      <div className="space-y-1">
        <Label htmlFor={id} className="text-base leading-snug">
          {label}
        </Label>
        <p className="text-muted-foreground text-sm">{help}</p>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form/field";
import { PlainText } from "@/components/public/plain-text";
import { registerInterestAction } from "./actions";

/**
 * El formulario de /interes. Cinco campos y un botón.
 *
 * ── Por qué no hay autoguardado ───────────────────────────────────────────
 *
 * El formulario de datos personales lo tiene porque son 3 pasos largos que se
 * abandonan a la mitad. Este se completa en cuarenta segundos desde un
 * teléfono: autoguardarlo significaría persistir cuentas a medio crear, que es
 * peor que perder cinco campos.
 *
 * ── El mensaje del mail repetido ──────────────────────────────────────────
 *
 * Cuando el mail ya tiene cuenta se lo decimos, con un link al login. Es una
 * decisión tomada a conciencia: revela que esa dirección está registrada, y a
 * cambio no perdemos a alguien que llegó de Instagram y se habría quedado
 * mirando una pantalla de éxito que no hizo nada. Lo que compensa la
 * enumeración es el rate limiting por mail del servicio.
 *
 * ── El tono ───────────────────────────────────────────────────────────────
 *
 * Los mensajes de éxito los escriben las coordinadoras y llegan desde el
 * servidor. Los de ERROR son literales y salen del catálogo: alguien que se
 * equivocó tipeando su mail necesita saber qué arreglar.
 */
export function InterestForm() {
  const t = useTranslations("interest");

  const [values, setValues] = useState({
    fullName: "",
    email: "",
    password: "",
    residenceCountry: "",
    phone: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alreadyRegistered, setAlreadyRegistered] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [done, setDone] = useState<{
    welcome: string | null;
    nextStep: string | null;
  } | null>(null);

  const set = (key: keyof typeof values, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));

  const errorOf = (field: string) => fieldErrors[field]?.[0];

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setAlreadyRegistered(false);
    setFieldErrors({});

    const result = await registerInterestAction(values);
    setBusy(false);

    if (result.ok) {
      setDone({ welcome: result.welcome, nextStep: result.nextStep });
      return;
    }

    setError(result.error);
    setAlreadyRegistered(result.alreadyRegistered === true);
    setFieldErrors(result.fieldErrors ?? {});
  }

  // ------------------------------------------------------- ya se registró
  if (done) {
    return (
      // El encabezado de la sección vive ACÁ y no en la página justamente por
      // esto: cuando el registro sale bien tiene que dejar de decir «dejanos
      // tus datos». Con el título afuera, la pantalla quedaba diciendo
      // «Dejanos tus datos» arriba de «Listo, recibimos tus datos».
      <div className="space-y-5">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="text-primary mt-1 size-6 shrink-0" aria-hidden="true" />
          <div className="space-y-1">
            <h3 className="text-2xl">{t("doneTitle")}</h3>
            {/* Si las coordinadoras no escribieron el mensaje de bienvenida,
                cae al del catálogo: nadie se queda sin saber que salió bien. */}
            <PlainText
              text={done.welcome ?? t("doneFallback")}
              className="text-lg"
            />
          </div>
        </div>

        {/* ------------------------------------------------------ QUÉ SIGUE
            Sin esto se registra y queda en el aire, que es la peor forma de
            perder a alguien que ya dijo que sí.

            Se renderiza SIEMPRE, con texto de reserva: si las coordinadoras
            todavía no cargaron el suyo, un hueco en blanco la deja sin saber
            qué hacer. El de reserva no puede traer el número de WhatsApp
            —solo ellas lo saben— pero al menos dice que la van a contactar.

            Va por PlainText y no por un <p>: el texto que ellas escriben
            lleva un link de wa.me, y en un párrafo plano no se puede apretar.
            Esta pantalla y la vista permanente tienen que mostrarlo igual. */}
        <div className="border-border bg-card rounded-lg border p-4">
          <h4 className="mb-1 font-semibold">{t("nextStepTitle")}</h4>
          <PlainText text={done.nextStep ?? t("nextStepFallback")} />
        </div>

        <Button asChild variant="outline">
          <Link href="/login">{t("goToLogin")}</Link>
        </Button>
      </div>
    );
  }

  // -------------------------------------------------------- el formulario
  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div className="mb-6 space-y-1">
        <h2 className="text-2xl">{t("formTitle")}</h2>
        <p className="text-muted-foreground">{t("formSubtitle")}</p>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden="true" />
          <AlertDescription className="space-y-3">
            <span>{error}</span>
            {/* Botón y no un link de texto: es LA acción de quien ya tiene
                cuenta, y un renglón subrayado de 24px de alto es un target
                que se falla con el pulgar. Va en 44px como el resto. */}
            {alreadyRegistered ? (
              <Button asChild variant="outline">
                <Link href="/login">{t("goToLogin")}</Link>
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      <Field label={t("fullName")} required error={errorOf("fullName")}>
        {(props) => (
          <Input
            {...props}
            name="fullName"
            autoComplete="name"
            value={values.fullName}
            onChange={(e) => set("fullName", e.target.value)}
          />
        )}
      </Field>

      <Field label={t("email")} required error={errorOf("email")}>
        {(props) => (
          <Input
            {...props}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={values.email}
            onChange={(e) => set("email", e.target.value)}
          />
        )}
      </Field>

      <Field
        label={t("password")}
        required
        help={t("passwordHint")}
        error={errorOf("password")}
      >
        {(props) => (
          <Input
            {...props}
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={values.password}
            onChange={(e) => set("password", e.target.value)}
          />
        )}
      </Field>

      <Field
        label={t("residenceCountry")}
        required
        error={errorOf("residenceCountry")}
      >
        {(props) => (
          <Input
            {...props}
            name="residenceCountry"
            autoComplete="country-name"
            value={values.residenceCountry}
            onChange={(e) => set("residenceCountry", e.target.value)}
          />
        )}
      </Field>

      <Field label={t("phone")} help={t("phoneHint")} error={errorOf("phone")}>
        {(props) => (
          <Input
            {...props}
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={values.phone}
            onChange={(e) => set("phone", e.target.value)}
          />
        )}
      </Field>

      <Button type="submit" disabled={busy} className="w-full" size="lg">
        {busy ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}

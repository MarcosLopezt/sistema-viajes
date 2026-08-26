"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "@/i18n/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const MIN_PASSWORD_LENGTH = 8;

/**
 * Único formulario que habla con Supabase desde el navegador.
 *
 * El motivo es que la sesión de recuperación la establece el link en el
 * cliente: mandar la contraseña nueva a una Server Action la haría viajar de
 * más sin ganar nada. La validación de longitud igual la vuelve a aplicar
 * Supabase del lado del servidor.
 */
export function ResetForm() {
  const t = useTranslations("auth.reset");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirm = String(form.get("passwordConfirm") ?? "");

    if (password.length < MIN_PASSWORD_LENGTH) {
      setErrorKey("tooShort");
      return;
    }
    if (password !== confirm) {
      setErrorKey("mismatch");
      return;
    }

    setErrorKey(null);
    startTransition(async () => {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.updateUser({ password });

      if (error) {
        // El caso frecuente es que el link ya se usó o venció: la sesión de
        // recuperación no existe y Supabase rechaza el cambio.
        setErrorKey("linkExpired");
        return;
      }

      setDone(true);
      router.replace("/");
    });
  }

  if (done) {
    return (
      <Alert role="status">
        <CheckCircle2 aria-hidden="true" />
        <AlertDescription>{t("success")}</AlertDescription>
      </Alert>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {errorKey ? (
        <Alert variant="destructive" role="alert">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{t(errorKey)}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="password" className="text-base">
          {t("password")}
        </Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="passwordConfirm" className="text-base">
          {t("passwordConfirm")}
        </Label>
        <Input
          id="passwordConfirm"
          name="passwordConfirm"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
        />
      </div>

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}

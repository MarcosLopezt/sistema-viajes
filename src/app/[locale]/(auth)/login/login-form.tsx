"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginAction, type AuthFormState } from "../actions";

const INITIAL: AuthFormState = {};

export function LoginForm() {
  const t = useTranslations("auth.login");
  const [state, formAction, pending] = useActionState(loginAction, INITIAL);

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {state.errorKey ? (
        <Alert variant="destructive" role="alert">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>
            {/* El mensaje se traduce en el cliente: la Server Action devuelve
                una clave, no un texto, así el error sale en el idioma que el
                usuario está viendo. */}
            {t(state.errorKey, state.errorValues)}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="email" className="text-base">
          {t("email")}
        </Label>
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder={t("emailPlaceholder")}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password" className="text-base">
          {t("password")}
        </Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>

      {/* Un solo botón primario por pantalla. */}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}

"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { recoverPasswordAction, type AuthFormState } from "../actions";

const INITIAL: AuthFormState = {};

export function RecoverForm() {
  const t = useTranslations("auth.recover");
  const [state, formAction, pending] = useActionState(
    recoverPasswordAction,
    INITIAL,
  );

  // Se confirma el envío exista o no la casilla. Si dijéramos "ese email no
  // está registrado", cualquiera podría usar este formulario para averiguar
  // quién viaja.
  if (state.ok) {
    return (
      <Alert role="status">
        <CheckCircle2 aria-hidden="true" />
        <AlertDescription>{t("sent")}</AlertDescription>
      </Alert>
    );
  }

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {state.errorKey ? (
        <Alert variant="destructive" role="alert">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{t(state.errorKey)}</AlertDescription>
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
          required
        />
      </div>

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}

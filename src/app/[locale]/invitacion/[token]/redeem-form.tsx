"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form/field";
import { redeemAction, type RedeemState } from "../actions";

/**
 * Creación de la cuenta al canjear la invitación.
 *
 * El email no se pide ni se puede editar: viene de la invitación. Va como
 * campo oculto y se muestra al lado, para que la persona confirme que es su
 * casilla sin poder cambiarla por otra.
 */
export function RedeemForm({
  token,
  email,
}: {
  token: string;
  email: string;
}) {
  const t = useTranslations("redeem");
  const [state, formAction, pending] = useActionState(
    redeemAction.bind(null, token),
    undefined as RedeemState | undefined,
  );

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {state?.errorKey || state?.error ? (
        <Alert variant="destructive" role="alert">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>
            {state.errorKey ? t(state.errorKey) : state.error}
          </AlertDescription>
        </Alert>
      ) : null}

      <input type="hidden" name="email" value={email} />

      <div className="space-y-1">
        <p className="text-muted-foreground text-sm">Email</p>
        <p className="text-base font-medium break-all">{email}</p>
      </div>

      <div className="space-y-1">
        <p className="text-base font-medium">{t("createPassword")}</p>
        <p className="text-muted-foreground text-sm">{t("passwordHelp")}</p>
      </div>

      <Field label={t("password")} required>
        {(props) => (
          <Input
            {...props}
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        )}
      </Field>

      <Field label={t("passwordConfirm")} required>
        {(props) => (
          <Input
            {...props}
            name="passwordConfirm"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        )}
      </Field>

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? t("accepting") : t("accept")}
      </Button>
    </form>
  );
}

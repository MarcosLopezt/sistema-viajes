"use server";

import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  InvitationError,
  redeemInvitation,
} from "@/lib/services/invitations";

/**
 * Canje de la invitación.
 *
 * Es la única puerta de entrada al sistema para alguien sin cuenta. No existe
 * registro abierto: sin un token válido no se puede crear un usuario.
 */

export interface RedeemState {
  /** Clave de i18n del error, para traducirlo en el cliente. */
  errorKey?: string;
  /** Mensaje ya escrito, cuando viene del servicio. */
  error?: string;
}

export async function redeemAction(
  token: string,
  _prev: RedeemState | undefined,
  formData: FormData,
): Promise<RedeemState> {
  const password = formData.get("password");
  const confirm = formData.get("passwordConfirm");

  const hasPasswordFields = typeof password === "string" && password.length > 0;

  if (hasPasswordFields) {
    if (password.length < 8) return { errorKey: "tooShort" };
    if (password !== confirm) return { errorKey: "mismatch" };
  }

  try {
    // El resultado no se usa: el destino es siempre el formulario de datos.
    // Lo que importa es que no haya tirado InvitationError.
    await redeemInvitation(token, hasPasswordFields ? password : null);
  } catch (error) {
    if (error instanceof InvitationError) {
      return { error: error.message };
    }
    console.error("[invitacion] canje fallido", (error as Error).message);
    return { error: "No pudimos completar el registro. Probá de nuevo." };
  }

  const locale = await getLocale();

  // Si acabamos de crear la cuenta, la dejamos logueada: pedirle que vaya al
  // login y escriba de nuevo la contraseña que eligió hace treinta segundos
  // sería un paso de más justo en el momento más frágil del flujo.
  if (hasPasswordFields) {
    const supabase = await createSupabaseServerClient();
    const email = formData.get("email");
    if (typeof email === "string") {
      await supabase.auth.signInWithPassword({ email, password });
    }
  }

  redirect({ href: "/mis-datos", locale });
}

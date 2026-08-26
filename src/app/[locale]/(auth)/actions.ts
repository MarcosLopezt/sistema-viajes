"use server";

import { z } from "zod";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { syncUserFromAuth } from "@/lib/auth/sync";

/**
 * Server Actions de autenticación.
 *
 * Todo lo sensible pasa por acá y no por el cliente: el rate limiting sería
 * decorativo si se pudiera saltear llamando a Supabase directamente desde el
 * navegador. El cliente solo maneja el estado del formulario.
 *
 * NO existe una acción de registro. Al sistema se entra únicamente por una
 * invitación con token (fase 3) o por un link de recuperación. Nunca se
 * mandan contraseñas por mail.
 */

export interface AuthFormState {
  /** Clave de i18n del error, para que el mensaje se traduzca en el cliente. */
  errorKey?: string;
  /** Parámetros del mensaje (ej. minutos de espera del rate limit). */
  errorValues?: Record<string, string | number>;
  ok?: boolean;
}

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export async function loginAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  // No distinguimos "email mal escrito" de "credenciales incorrectas": decirle
  // a quien prueba credenciales cuál de las dos falló le ahorra la mitad del
  // trabajo.
  if (!parsed.success) {
    return { errorKey: "invalidCredentials" };
  }

  const { email, password } = parsed.data;

  const limit = await checkRateLimit("login", email);
  if (!limit.allowed) {
    return {
      errorKey: "rateLimited",
      errorValues: { minutes: Math.ceil(limit.retryAfterSeconds / 60) },
    };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.user) {
    return { errorKey: "invalidCredentials" };
  }

  await syncUserFromAuth(data.user.id, data.user.email ?? email);

  // El destino según el rol lo resuelve la home: acá no hace falta saberlo.
  // Se usa el redirect de next-intl para conservar el idioma que el usuario
  // estaba viendo; el de next/navigation lo mandaría siempre al default.
  redirect({ href: "/", locale: await getLocale() });
}

const recoverSchema = z.object({ email: z.email() });

export async function recoverPasswordAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = recoverSchema.safeParse({ email: formData.get("email") });

  // Respuesta idéntica exista o no la casilla: si dijéramos "ese email no
  // está registrado" cualquiera podría averiguar quién viaja.
  if (!parsed.success) {
    return { ok: true };
  }

  const { email } = parsed.data;

  const limit = await checkRateLimit("passwordRecovery", email);
  if (!limit.allowed) {
    return { errorKey: "rateLimited" };
  }

  const supabase = await createSupabaseServerClient();
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/auth/callback?next=/reset`,
  });

  return { ok: true };
}

export async function logoutAction(): Promise<never> {
  const locale = await getLocale();
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect({ href: "/login", locale });
}

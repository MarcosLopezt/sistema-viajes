"use server";

import { getLocale } from "next-intl/server";
import { InterestError, registerInterest } from "@/lib/services/interest";
import { registerInterestSchema } from "@/lib/validation/interest";

/**
 * Server Action del registro público.
 *
 * Cáscara fina, como todas: valida con Zod y delega. La autorización no existe
 * acá porque no hay a quién pedírsela — es una persona anónima anotándose. Lo
 * que acota el endpoint vive en el servicio (rate limiting en tres capas y la
 * exigencia de que haya un viaje aceptando), y no en esta capa.
 *
 * NO inicia sesión al terminar. La cuenta queda creada y con contraseña, pero
 * entrar es un acto aparte: quien se registró desde el teléfono de un tercero
 * no debería quedar logueada sin haberlo pedido.
 */

export type RegisterResult =
  | { ok: true; welcome: string | null; nextStep: string | null }
  | {
      ok: false;
      error: string;
      /** Distingue el caso "ya tenés cuenta" para poder ofrecer el login. */
      alreadyRegistered?: boolean;
      fieldErrors?: Record<string, string[]>;
    };

export async function registerInterestAction(
  input: unknown,
): Promise<RegisterResult> {
  const parsed = registerInterestSchema.safeParse(input);

  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors as Record<
      string,
      string[]
    >;
    const first = Object.values(fieldErrors)[0]?.[0];
    return {
      ok: false,
      error: first ?? "Revisá los datos.",
      fieldErrors,
    };
  }

  const locale = await getLocale();

  try {
    const result = await registerInterest({ ...parsed.data, locale });
    return {
      ok: true,
      welcome: result.welcomeMessage,
      nextStep: result.nextStepMessage,
    };
  } catch (error) {
    if (error instanceof InterestError) {
      return {
        ok: false,
        error: error.message,
        alreadyRegistered: error.reason === "EMAIL_YA_REGISTRADO",
      };
    }
    // No se loguea el input: trae mail, nombre y contraseña.
    console.error(
      "[interes] falló el registro:",
      error instanceof Error ? error.message : "error desconocido",
    );
    return { ok: false, error: "No pudimos completar tu registro." };
  }
}

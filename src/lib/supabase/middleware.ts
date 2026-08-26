import { createServerClient } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";

/**
 * Refresca el token de Supabase y reescribe las cookies en la respuesta.
 *
 * Tiene que correr en el middleware: los Server Components no pueden escribir
 * cookies, así que si el refresco no pasa por acá la sesión se cae sola cuando
 * vence el access token y el usuario aparece deslogueado sin motivo.
 *
 * Recibe la respuesta que ya armó el middleware de i18n para escribir las
 * cookies sobre ESA respuesta y no sobre una nueva: si se creara otra se
 * perderían los headers de routing de locale.
 */
export async function updateSession(
  request: NextRequest,
  response: NextResponse,
): Promise<NextResponse> {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // getUser() valida el token contra Supabase y dispara el refresco si hace
  // falta. No borrar esta llamada: sin ella no hay refresco.
  await supabase.auth.getUser();

  return response;
}

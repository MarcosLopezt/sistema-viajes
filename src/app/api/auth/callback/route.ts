import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { syncUserFromAuth } from "@/lib/auth/sync";

/**
 * Canje del código de los links de Supabase (recuperación de contraseña y
 * confirmación de mail) por una sesión.
 *
 * Está fuera de `/[locale]` porque la URL la arma Supabase y no lleva prefijo
 * de idioma. Al redirigir se manda a una ruta sin prefijo y el middleware de
 * i18n le agrega el locale que corresponda.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  // Solo rutas internas: sin esto, `?next=https://otro-sitio` convertiría este
  // endpoint en un redirector abierto para phishing.
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";

  if (!code) {
    return NextResponse.redirect(`${origin}/login`);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    return NextResponse.redirect(`${origin}/login`);
  }

  await syncUserFromAuth(data.user.id, data.user.email ?? "");

  return NextResponse.redirect(`${origin}${safeNext}`);
}

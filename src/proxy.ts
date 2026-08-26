import createIntlMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";
import { routing } from "@/i18n/routing";
import { updateSession } from "@/lib/supabase/middleware";

const intlMiddleware = createIntlMiddleware(routing);

/**
 * Se llama `proxy` y no `middleware` porque Next 16 renombró la convención.
 *
 * Dos responsabilidades, en este orden:
 *   1. i18n resuelve el locale y, si hace falta, redirige a `/es/...`.
 *   2. Supabase refresca el token sobre ESA misma respuesta.
 *
 * NO decide permisos. La autorización se valida en el servidor en cada
 * request, en src/lib/auth/guards.ts. Un proxy que redirige por rol da una
 * falsa sensación de seguridad: no protege las Server Actions ni los Route
 * Handlers, que es justamente por donde se filtran los datos.
 */
export default async function proxy(request: NextRequest) {
  const response = intlMiddleware(request);
  return updateSession(request, response);
}

export const config = {
  // Se excluyen /api (protegidas por su propio guard o por el secreto de
  // cron), los assets de Next y cualquier archivo con extensión.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};

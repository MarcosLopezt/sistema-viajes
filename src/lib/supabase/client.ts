"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Cliente de Supabase para el navegador. Solo anon key: nunca la service role.
 * Se usa para login, logout, recuperación de contraseña y subida directa de
 * archivos con signed upload URL.
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

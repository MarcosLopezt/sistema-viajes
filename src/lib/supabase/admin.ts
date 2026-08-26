import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Cliente con service role. Bypassea toda restricción de Supabase.
 *
 * Se usa para dos cosas y nada más: crear usuarios de Auth al canjear una
 * invitación, y firmar URLs del bucket privado. Nunca se expone al navegador
 * —la key no lleva prefijo NEXT_PUBLIC_— y ningún componente lo importa.
 *
 * Cada llamada crea un cliente nuevo a propósito: es liviano, no abre
 * conexiones persistentes, y así no queda un objeto con credenciales de
 * administrador viviendo en el ámbito del módulo entre requests.
 */
export function createSupabaseAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY. Ver .env.example.",
    );
  }

  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Nombre del bucket privado donde viven comprobantes y certificados. */
export function storageBucket(): string {
  return process.env.SUPABASE_STORAGE_BUCKET ?? "documentos";
}

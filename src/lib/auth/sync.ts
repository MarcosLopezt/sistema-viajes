import "server-only";

import { prisma } from "@/lib/db/prisma";
import type { UserModel } from "@/generated/prisma/models";

/**
 * Mantiene en sincronía `auth.users` (Supabase) con `public.User` (Prisma).
 *
 * Existen dos tablas porque Supabase Auth guarda la identidad en su propio
 * schema `auth`, al que Prisma no puede referenciar con una foreign key. El
 * precio de usar Supabase Auth —que a cambio nos da recuperación de
 * contraseña, verificación de mail y rate limiting propios— es esta
 * sincronización explícita.
 *
 * Se llama en dos momentos: al canjear una invitación (ahí se crea la fila) y
 * en cada login (por si quedó desincronizada). Nunca asigna roles: el rol se
 * define al invitar o desde el panel de admin. Un usuario que aparece por
 * primera vez entra como USER, que es el rol sin privilegios.
 */
export async function syncUserFromAuth(
  authUserId: string,
  email: string,
): Promise<UserModel> {
  return prisma.user.upsert({
    where: { id: authUserId },
    // El email puede cambiar en Supabase; el rol NO se toca acá.
    update: { email },
    create: { id: authUserId, email, role: "USER" },
  });
}

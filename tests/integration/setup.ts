import "dotenv/config";
import { vi } from "vitest";

/**
 * Infraestructura de los tests de integración.
 *
 * Lo ÚNICO que se mockea es la resolución de la sesión de Supabase: no hay
 * navegador ni cookies en un test. Todo lo demás —los guards, la política de
 * autorización, los servicios y las consultas— corre de verdad contra la base
 * real.
 *
 * Esa distinción importa: un test de aislamiento con Prisma mockeado no prueba
 * aislamiento, prueba que el mock hace lo que le dijimos. Acá, si un `where`
 * se olvida de acotar el alcance, el test lo ve.
 */

/** Usuario "logueado" en este momento. Lo cambia `actAs()`. */
let currentAuthUser: { id: string; email: string } | null = null;

export function actAs(user: { id: string; email: string } | null): void {
  currentAuthUser = user;
}

export function actAsAnonymous(): void {
  currentAuthUser = null;
}

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: currentAuthUser },
        error: null,
      }),
    },
  }),
}));

// `server-only` aborta si se importa fuera de un Server Component. En un test
// de Node no hay tal contexto, así que se neutraliza.
vi.mock("server-only", () => ({}));

/**
 * `headers()` de Next tira fuera de un request. El rate limiting del canje de
 * invitaciones la usa para sacar la IP, así que devolvemos una vacía: sin IP
 * cae al fallback por token, que es exactamente el camino que queremos
 * ejercitar en los tests.
 */
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    getAll: () => [],
    set: () => undefined,
  }),
}));

/**
 * `revalidatePath` solo tiene sentido dentro del render de Next. Los tests
 * llaman a los servicios directamente, pero algunas acciones la invocan.
 */
vi.mock("next/cache", () => ({
  revalidatePath: () => undefined,
  revalidateTag: () => undefined,
}));

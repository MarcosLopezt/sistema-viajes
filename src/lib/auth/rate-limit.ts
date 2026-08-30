import "server-only";

import { createHash } from "node:crypto";
import { prisma } from "@/lib/db/prisma";

/**
 * Rate limiting para login, recuperación de contraseña y canje de invitaciones.
 *
 * Vive en la base y no en memoria porque en Vercel cada request puede caer en
 * una instancia distinta (y las lambdas se reciclan): un Map en memoria no
 * limita nada en producción.
 *
 * Solo se persiste el SHA-256 de la clave. La clave incluye el email o la IP,
 * y esos son datos personales: guardar el hash alcanza para contar intentos y
 * cumple con "no loguear nunca datos personales".
 */

export interface RateLimitRule {
  /** Máximo de intentos permitidos dentro de la ventana. */
  limit: number;
  /** Duración de la ventana, en segundos. */
  windowSeconds: number;
}

export const RATE_LIMITS = {
  /** Login: tolera un par de tipeos, corta el fuerza bruta. */
  login: { limit: 8, windowSeconds: 15 * 60 },
  /** Recuperación: además evita usarnos para spamear una casilla ajena. */
  passwordRecovery: { limit: 4, windowSeconds: 60 * 60 },
  /** Canje de invitación: frena la prueba de tokens al voleo. */
  invitationRedeem: { limit: 10, windowSeconds: 60 * 60 },

  // ── Registro público de interesadas ──────────────────────────────────────
  //
  // La primera superficie del sistema que crea usuarios SIN invitación. Los
  // otros límites protegen credenciales; estos protegen algo distinto: que
  // nadie use el formulario de /interes como una máquina de crear cuentas en
  // Supabase Auth. Por eso son tres capas y no una.

  /** Por IP. Deja probar de nuevo si se equivocó, corta el script. */
  interestSignup: { limit: 5, windowSeconds: 60 * 60 },
  /**
   * Por mail. Evita que reintentar con la misma casilla sirva para sondear
   * si esa cuenta existe, que es la contracara de haber elegido decirle
   * "ya tenés una cuenta" en vez de una pantalla de éxito falsa.
   */
  interestSignupEmail: { limit: 3, windowSeconds: 60 * 60 },
  /**
   * TOPE GLOBAL DIARIO, contra una sola clave compartida por todos.
   *
   * Los dos de arriba se esquivan rotando IP y casilla, que es exactamente lo
   * que hace un alta automatizada. Este no: cuenta el total del día, venga de
   * donde venga.
   *
   * 200 sale de la escala real. La escuela hace 2 viajes por año con ~14
   * pasajeras; el embudo entero son decenas de interesadas anuales. Doscientas
   * en UN día es dos órdenes de magnitud más que el uso legítimo y varios
   * menos que un ataque que valga la pena. El costo de equivocarse hacia
   * arriba es una cuota de Supabase Auth agotada y descubrirlo por el lado
   * peor; hacia abajo, una campaña de Instagram que funcionó demasiado bien
   * y unas horas de espera.
   *
   * Si alguna vez se corta por uso real, subilo: no es una medida de
   * seguridad fina, es un fusible.
   */
  interestSignupGlobal: { limit: 200, windowSeconds: 24 * 60 * 60 },
} as const satisfies Record<string, RateLimitRule>;

/** Clave única del tope global: todos los intentos del día caen en el mismo contador. */
export const INTEREST_SIGNUP_GLOBAL_KEY = "global";

export type RateLimitAction = keyof typeof RATE_LIMITS;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Segundos hasta que se libere un intento. 0 si está permitido. */
  retryAfterSeconds: number;
}

function hashKey(action: RateLimitAction, identifier: string): string {
  return createHash("sha256")
    .update(`${action}:${identifier.trim().toLowerCase()}`)
    .digest("hex");
}

/**
 * Registra un intento y dice si se puede seguir.
 *
 * Se cuenta ANTES de decidir (el intento fallido también consume cupo), que es
 * lo que hace que sirva contra fuerza bruta.
 */
export async function checkRateLimit(
  action: RateLimitAction,
  identifier: string,
): Promise<RateLimitResult> {
  const rule = RATE_LIMITS[action];
  const keyHash = hashKey(action, identifier);
  const windowStart = new Date(Date.now() - rule.windowSeconds * 1000);

  await prisma.rateLimitHit.create({ data: { keyHash } });

  const hits = await prisma.rateLimitHit.findMany({
    where: { keyHash, createdAt: { gte: windowStart } },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });

  if (hits.length <= rule.limit) {
    return {
      allowed: true,
      remaining: rule.limit - hits.length,
      retryAfterSeconds: 0,
    };
  }

  // El cupo se libera cuando el intento más viejo sale de la ventana.
  const oldest = hits[0]?.createdAt ?? new Date();
  const freeAt = oldest.getTime() + rule.windowSeconds * 1000;
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((freeAt - Date.now()) / 1000),
  );

  return { allowed: false, remaining: 0, retryAfterSeconds };
}

/**
 * Purga los intentos que ya no le sirven a ninguna ventana.
 * La llama el cron diario; sin esto la tabla crece para siempre.
 */
export async function purgeExpiredRateLimitHits(): Promise<number> {
  const longestWindow = Math.max(
    ...Object.values(RATE_LIMITS).map((r) => r.windowSeconds),
  );
  const cutoff = new Date(Date.now() - longestWindow * 1000);
  const { count } = await prisma.rateLimitHit.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return count;
}

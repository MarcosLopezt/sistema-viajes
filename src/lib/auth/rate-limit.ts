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
} as const satisfies Record<string, RateLimitRule>;

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

import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { prisma } from "@/lib/db/prisma";
import { requireCapability, getSessionUser } from "@/lib/auth/guards";
import { ForbiddenError } from "@/lib/auth/errors";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { RoomType } from "@/generated/prisma/enums";

/**
 * Invitaciones.
 *
 * El token viaja en el link y NUNCA se guarda en claro: en la base va su
 * SHA-256. Si la base se filtrara, los links seguirían sin poder canjearse.
 * Como consecuencia, el token en claro existe una sola vez —en el momento de
 * crearlo— y por eso `createInvitation` lo devuelve: es la única oportunidad
 * de mostrarlo o mandarlo.
 */

const TOKEN_BYTES = 32; // 256 bits → 43 caracteres en base64url
const EXPIRY_DAYS = 14;

export class InvitationError extends Error {
  constructor(
    message: string,
    readonly reason:
      | "INVALIDA"
      | "VENCIDA"
      | "USADA"
      | "REVOCADA"
      | "DEMASIADOS_INTENTOS",
  ) {
    super(message);
    this.name = "InvitationError";
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function expiryDate(): Date {
  return new Date(Date.now() + EXPIRY_DAYS * 24 * 60 * 60 * 1000);
}

/** Link que se manda por mail o se copia para WhatsApp. */
export function invitationUrl(token: string, locale = "es"): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base}/${locale}/invitacion/${token}`;
}

// ------------------------------ Alta ---------------------------------------

export interface CreatedInvitation {
  id: string;
  email: string;
  /** En claro. Solo existe en este momento: después queda solo el hash. */
  token: string;
  url: string;
  expiresAt: Date;
}

export async function createInvitation(
  tripId: string,
  email: string,
  roomType: RoomType,
  locale = "es",
): Promise<CreatedInvitation> {
  const viewer = await requireCapability(tripId, "passenger:invite");

  const normalizedEmail = email.trim().toLowerCase();
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const expiresAt = expiryDate();

  const invitation = await prisma.invitation.create({
    data: {
      tripId,
      email: normalizedEmail,
      tokenHash: hashToken(token),
      roomType,
      expiresAt,
      createdById: viewer.userId,
    },
    select: { id: true },
  });

  return {
    id: invitation.id,
    email: normalizedEmail,
    token,
    url: invitationUrl(token, locale),
    expiresAt,
  };
}

/**
 * Reenvía una invitación: revoca la anterior y emite un token nuevo.
 *
 * Revocar es obligatorio, no una cortesía. Si el link viejo siguiera vivo
 * habría dos tokens válidos para la misma persona, y el que se filtró por
 * error —el motivo habitual del reenvío— seguiría sirviendo.
 */
export async function resendInvitation(
  invitationId: string,
  locale = "es",
): Promise<CreatedInvitation> {
  const previous = await prisma.invitation.findUnique({
    where: { id: invitationId },
    select: { id: true, tripId: true, email: true, roomType: true, usedAt: true },
  });

  if (!previous) throw new ForbiddenError();
  await requireCapability(previous.tripId, "passenger:invite");

  if (previous.usedAt) {
    throw new InvitationError(
      "Esta invitación ya fue usada: la persona ya está en el viaje.",
      "USADA",
    );
  }

  await prisma.invitation.update({
    where: { id: invitationId },
    data: { revokedAt: new Date() },
  });

  return createInvitation(
    previous.tripId,
    previous.email,
    previous.roomType,
    locale,
  );
}

export async function revokeInvitation(invitationId: string): Promise<void> {
  const invitation = await prisma.invitation.findUnique({
    where: { id: invitationId },
    select: { tripId: true },
  });
  if (!invitation) throw new ForbiddenError();

  await requireCapability(invitation.tripId, "passenger:invite");
  await prisma.invitation.update({
    where: { id: invitationId },
    data: { revokedAt: new Date() },
  });
}

export type InvitationState = "PENDIENTE" | "USADA" | "VENCIDA" | "REVOCADA";

export interface InvitationListItem {
  id: string;
  email: string;
  roomType: RoomType;
  state: InvitationState;
  expiresAt: Date;
  createdAt: Date;
}

export async function listInvitations(
  tripId: string,
): Promise<InvitationListItem[]> {
  await requireCapability(tripId, "passenger:viewAll");

  const rows = await prisma.invitation.findMany({
    where: { tripId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      roomType: true,
      expiresAt: true,
      usedAt: true,
      revokedAt: true,
      createdAt: true,
    },
  });

  return rows.map(({ usedAt, revokedAt, ...row }) => ({
    ...row,
    state: usedAt
      ? "USADA"
      : revokedAt
        ? "REVOCADA"
        : row.expiresAt.getTime() < Date.now()
          ? "VENCIDA"
          : "PENDIENTE",
  }));
}

// ------------------------------ Canje --------------------------------------

export interface InvitationPreview {
  email: string;
  roomType: RoomType;
  trip: { id: string; name: string; startDate: Date; endDate: Date };
  /** Ya existe un usuario con ese email: tiene que iniciar sesión. */
  hasAccount: boolean;
  /**
   * Datos que ya cargó en otro viaje. Se precargan para que confirme o
   * actualice en vez de escribir todo de nuevo.
   */
  prefill: { fullName: string | null; hasData: boolean } | null;
}

/**
 * Identificador para el rate limiting del canje.
 *
 * Se prefiere la IP: limitar por token no sirve contra alguien que prueba
 * tokens al azar, porque cada intento tendría una clave distinta.
 */
async function redeemRateKey(token: string): Promise<string> {
  const headerList = await headers();
  const forwarded = headerList.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() ?? headerList.get("x-real-ip");
  return ip ?? `token:${hashToken(token)}`;
}

async function findValidInvitation(token: string) {
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      email: true,
      roomType: true,
      tripId: true,
      expiresAt: true,
      usedAt: true,
      revokedAt: true,
      trip: {
        select: { id: true, name: true, startDate: true, endDate: true },
      },
    },
  });

  if (!invitation) {
    throw new InvitationError(
      "Este link no es válido. Pedile al coordinador que te mande uno nuevo.",
      "INVALIDA",
    );
  }
  if (invitation.usedAt) {
    throw new InvitationError(
      "Este link ya se usó. Si ya te registraste, entrá con tu email y contraseña.",
      "USADA",
    );
  }
  if (invitation.revokedAt) {
    throw new InvitationError(
      "Este link fue reemplazado por uno más nuevo. Buscá el último mail que te mandaron.",
      "REVOCADA",
    );
  }
  if (invitation.expiresAt.getTime() < Date.now()) {
    throw new InvitationError(
      "Este link venció. Pedile al coordinador que te mande uno nuevo.",
      "VENCIDA",
    );
  }

  return invitation;
}

/** Datos del link, sin canjearlo. Lo usa la pantalla de bienvenida. */
export async function peekInvitation(
  token: string,
): Promise<InvitationPreview> {
  const limit = await checkRateLimit("invitationRedeem", await redeemRateKey(token));
  if (!limit.allowed) {
    throw new InvitationError(
      "Demasiados intentos. Probá de nuevo en un rato.",
      "DEMASIADOS_INTENTOS",
    );
  }

  const invitation = await findValidInvitation(token);

  const existing = await prisma.user.findUnique({
    where: { email: invitation.email },
    select: { id: true, person: { select: { fullName: true, updatedAt: true, createdAt: true } } },
  });

  return {
    email: invitation.email,
    roomType: invitation.roomType,
    trip: invitation.trip,
    hasAccount: existing !== null,
    prefill: existing?.person
      ? {
          fullName: existing.person.fullName,
          // Si la fila se tocó después de crearse, ya cargó algo.
          hasData:
            existing.person.updatedAt.getTime() >
            existing.person.createdAt.getTime(),
        }
      : null,
  };
}

export interface RedeemResult {
  tripId: string;
  passengerId: string;
  /** true si se reutilizaron datos de otro viaje. */
  prefilled: boolean;
}

/**
 * Canjea la invitación.
 *
 * Dos caminos:
 *
 *  - Sin cuenta previa: se crea el usuario en Supabase Auth con la contraseña
 *    que eligió, más su Person vacía.
 *  - Con cuenta previa: NO se crea nada de identidad. Tiene que estar logueado
 *    con ese mismo email, y se reutiliza su Person: así llega al formulario
 *    con los datos del viaje anterior ya cargados.
 *
 * Todo el canje va en una transacción con el marcado de `usedAt`: si algo
 * falla a mitad de camino, el token sigue disponible en vez de quedar quemado.
 */
export async function redeemInvitation(
  token: string,
  password: string | null,
): Promise<RedeemResult> {
  const limit = await checkRateLimit("invitationRedeem", await redeemRateKey(token));
  if (!limit.allowed) {
    throw new InvitationError(
      "Demasiados intentos. Probá de nuevo en un rato.",
      "DEMASIADOS_INTENTOS",
    );
  }

  const invitation = await findValidInvitation(token);

  const existingUser = await prisma.user.findUnique({
    where: { email: invitation.email },
    select: { id: true, personId: true },
  });

  let userId: string;
  let personId: string;
  let prefilled = false;

  if (existingUser) {
    // Ya tiene cuenta: exigimos que esté logueado con ESE email. Sin esto,
    // cualquiera con el link podría sumar la cuenta de otro a un viaje.
    const session = await getSessionUser();
    if (!session || session.id !== existingUser.id) {
      throw new InvitationError(
        "Ya tenés una cuenta con este email. Iniciá sesión y volvé a abrir el link.",
        "INVALIDA",
      );
    }

    userId = existingUser.id;
    prefilled = existingUser.personId !== null;

    if (existingUser.personId) {
      personId = existingUser.personId;
    } else {
      const person = await prisma.person.create({
        data: {},
        select: { id: true },
      });
      personId = person.id;
      await prisma.user.update({
        where: { id: userId },
        data: { personId },
      });
    }
  } else {
    if (!password || password.length < 8) {
      throw new InvitationError(
        "Elegí una contraseña de al menos 8 caracteres.",
        "INVALIDA",
      );
    }

    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.auth.admin.createUser({
      email: invitation.email,
      password,
      // El link de invitación ya prueba que la casilla es suya: pedirle
      // además que confirme el mail sería un paso de más para nada.
      email_confirm: true,
    });

    if (error || !data.user) {
      throw new InvitationError(
        "No pudimos crear tu cuenta. Probá de nuevo en un momento.",
        "INVALIDA",
      );
    }

    userId = data.user.id;

    const person = await prisma.person.create({
      data: {},
      select: { id: true },
    });
    personId = person.id;

    await prisma.user.create({
      data: { id: userId, email: invitation.email, role: "USER", personId },
    });
  }

  const passenger = await prisma.$transaction(async (tx) => {
    // El update condicionado a `usedAt: null` es lo que hace atómico el canje:
    // si dos pestañas mandan el mismo token a la vez, la segunda no encuentra
    // fila para actualizar y no llega a crear un Passenger duplicado.
    const marked = await tx.invitation.updateMany({
      where: { id: invitation.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    if (marked.count === 0) {
      throw new InvitationError("Este link ya se usó.", "USADA");
    }

    await tx.tripMember.upsert({
      where: { tripId_userId: { tripId: invitation.tripId, userId } },
      update: {},
      create: { tripId: invitation.tripId, userId, role: "PASAJERO" },
    });

    return tx.passenger.upsert({
      where: {
        tripId_personId: { tripId: invitation.tripId, personId },
      },
      update: {},
      create: {
        tripId: invitation.tripId,
        personId,
        roomType: invitation.roomType,
        status: "INVITADO",
      },
      select: { id: true },
    });
  });

  return { tripId: invitation.tripId, passengerId: passenger.id, prefilled };
}

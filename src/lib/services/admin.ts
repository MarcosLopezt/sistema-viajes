import "server-only";

import { prisma } from "@/lib/db/prisma";
import { requireAdmin } from "@/lib/auth/guards";
import { ForbiddenError } from "@/lib/auth/errors";
import { recordAudit } from "./audit";
import type { GlobalRole, TripRole } from "@/generated/prisma/enums";

/**
 * Gestión de usuarios, roles y auditoría. Todo lo de acá es exclusivo de
 * ADMIN: cada función abre con `requireAdmin()`, sin excepción.
 *
 * Lo mínimo para operar y nada más: asignar a alguien como coordinador o
 * pasajero de un viaje, cambiar el rol global, y leer el AuditLog con filtros.
 * No hay alta ni baja de usuarios desde acá — los usuarios nacen al canjear
 * una invitación, que es el único camino de entrada al sistema.
 *
 * Los cambios de rol se auditan. Es el privilegio más alto que se puede
 * otorgar en la aplicación: si alguien se vuelve ADMIN, tiene que quedar
 * escrito quién lo hizo y cuándo.
 */

// ------------------------------- Usuarios ----------------------------------

export interface AdminUserRow {
  id: string;
  email: string;
  role: GlobalRole;
  fullName: string | null;
  createdAt: Date;
  memberships: {
    tripId: string;
    tripName: string;
    role: TripRole;
  }[];
}

/** Todos los usuarios, con sus viajes y el rol en cada uno. */
export async function listUsers(): Promise<AdminUserRow[]> {
  await requireAdmin();

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      email: true,
      role: true,
      createdAt: true,
      person: { select: { fullName: true } },
      tripMemberships: {
        orderBy: { trip: { startDate: "desc" } },
        select: {
          role: true,
          trip: { select: { id: true, name: true } },
        },
      },
    },
  });

  return users.map((user) => ({
    id: user.id,
    email: user.email,
    role: user.role,
    fullName: user.person?.fullName ?? null,
    createdAt: user.createdAt,
    memberships: user.tripMemberships.map((membership) => ({
      tripId: membership.trip.id,
      tripName: membership.trip.name,
      role: membership.role,
    })),
  }));
}

/**
 * Cambia el rol global de un usuario.
 *
 * Un ADMIN no puede quitarse el rol a sí mismo. No es paternalismo: si el
 * único administrador se degrada por error, no queda nadie que pueda
 * devolverle el permiso y hay que entrar a la base a mano. El caso legítimo
 * —dejar de ser admin— lo resuelve otro admin.
 */
export async function setGlobalRole(
  userId: string,
  role: GlobalRole,
): Promise<void> {
  const actor = await requireAdmin();

  if (userId === actor.id) {
    throw new ForbiddenError(
      "No podés cambiar tu propio rol. Pedíselo a otro administrador.",
    );
  }

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });

  if (!target) throw new ForbiddenError();
  if (target.role === role) return;

  await prisma.user.update({ where: { id: userId }, data: { role } });

  await recordAudit(actor.id, [
    {
      entity: "User",
      entityId: userId,
      field: "role",
      oldValue: target.role,
      newValue: role,
    },
  ]);
}

// ----------------------------- Miembros de viaje ---------------------------

/**
 * Asigna a un usuario como miembro de un viaje, o le cambia el rol si ya lo
 * era. Es la única forma de crear un coordinador: el rol de viaje no se hereda
 * del rol global ni se deduce de tener un Passenger.
 */
export async function assignTripMember(
  tripId: string,
  userId: string,
  role: TripRole,
): Promise<void> {
  const actor = await requireAdmin();

  const [trip, user, existing] = await Promise.all([
    prisma.trip.findUnique({ where: { id: tripId }, select: { id: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { id: true } }),
    prisma.tripMember.findUnique({
      where: { tripId_userId: { tripId, userId } },
      select: { role: true },
    }),
  ]);

  if (!trip || !user) throw new ForbiddenError();
  if (existing?.role === role) return;

  await prisma.tripMember.upsert({
    where: { tripId_userId: { tripId, userId } },
    create: { tripId, userId, role },
    update: { role },
  });

  await recordAudit(actor.id, [
    {
      entity: "TripMember",
      entityId: `${tripId}:${userId}`,
      field: "role",
      oldValue: existing?.role ?? null,
      newValue: role,
    },
  ]);
}

/**
 * Saca a un usuario de un viaje.
 *
 * No toca su Passenger: alguien puede dejar de coordinar un viaje y seguir
 * viajando en él. Borrar el Passenger desde acá perdería datos personales sin
 * que nadie lo haya pedido.
 */
export async function removeTripMember(
  tripId: string,
  userId: string,
): Promise<void> {
  const actor = await requireAdmin();

  const existing = await prisma.tripMember.findUnique({
    where: { tripId_userId: { tripId, userId } },
    select: { role: true },
  });

  if (!existing) return;

  await prisma.tripMember.delete({
    where: { tripId_userId: { tripId, userId } },
  });

  await recordAudit(actor.id, [
    {
      entity: "TripMember",
      entityId: `${tripId}:${userId}`,
      field: "role",
      oldValue: existing.role,
      newValue: null,
    },
  ]);
}

/** Viajes disponibles para asignar, en el desplegable del panel. */
export async function listTripsForAssignment(): Promise<
  { id: string; name: string }[]
> {
  await requireAdmin();

  return prisma.trip.findMany({
    orderBy: { startDate: "desc" },
    select: { id: true, name: true },
  });
}

// ------------------------------- Auditoría ---------------------------------

export interface AuditFilters {
  entity?: string;
  entityId?: string;
  actorUserId?: string;
  /** Fechas de calendario ISO (YYYY-MM-DD), inclusivas en ambos extremos. */
  from?: string;
  to?: string;
}

export interface AuditRow {
  id: string;
  entity: string;
  entityId: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  createdAt: Date;
  actorEmail: string | null;
  actorName: string | null;
}

export interface AuditPage {
  rows: AuditRow[];
  total: number;
  /** Entidades presentes en el log, para poblar el filtro sin inventarlas. */
  entities: string[];
}

/** Tope duro de filas por consulta. El log crece sin límite. */
const AUDIT_PAGE_SIZE = 100;

/**
 * Lee el AuditLog con filtros por entidad, actor y rango de fechas.
 *
 * El rango se interpreta en días de calendario completos: `to` incluye todo
 * ese día. Sin esto, filtrar "hasta el 3 de marzo" dejaría afuera todo lo que
 * pasó ese día después de medianoche, que es casi todo.
 */
export async function listAuditLog(
  filters: AuditFilters = {},
  page = 0,
): Promise<AuditPage> {
  await requireAdmin();

  const where: {
    entity?: string;
    entityId?: string;
    actorUserId?: string;
    createdAt?: { gte?: Date; lt?: Date };
  } = {};

  if (filters.entity) where.entity = filters.entity;
  if (filters.entityId) where.entityId = filters.entityId;
  if (filters.actorUserId) where.actorUserId = filters.actorUserId;

  if (filters.from || filters.to) {
    where.createdAt = {};
    if (filters.from) where.createdAt.gte = new Date(`${filters.from}T00:00:00Z`);
    if (filters.to) {
      // Exclusivo sobre el día siguiente: incluye el día `to` entero.
      const next = new Date(`${filters.to}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      where.createdAt.lt = next;
    }
  }

  const [rows, total, entities] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: page * AUDIT_PAGE_SIZE,
      take: AUDIT_PAGE_SIZE,
      select: {
        id: true,
        entity: true,
        entityId: true,
        field: true,
        oldValue: true,
        newValue: true,
        createdAt: true,
        actor: {
          select: { email: true, person: { select: { fullName: true } } },
        },
      },
    }),
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      distinct: ["entity"],
      orderBy: { entity: "asc" },
      select: { entity: true },
    }),
  ]);

  return {
    rows: rows.map((row) => ({
      id: row.id,
      entity: row.entity,
      entityId: row.entityId,
      field: row.field,
      oldValue: row.oldValue,
      newValue: row.newValue,
      createdAt: row.createdAt,
      actorEmail: row.actor?.email ?? null,
      actorName: row.actor?.person?.fullName ?? null,
    })),
    total,
    entities: entities.map((e) => e.entity),
  };
}

/** Actores que aparecen en el log, para el filtro por actor. */
export async function listAuditActors(): Promise<
  { id: string; email: string; fullName: string | null }[]
> {
  await requireAdmin();

  const users = await prisma.user.findMany({
    where: { auditLogs: { some: {} } },
    orderBy: { email: "asc" },
    select: {
      id: true,
      email: true,
      person: { select: { fullName: true } },
    },
  });

  return users.map((user) => ({
    id: user.id,
    email: user.email,
    fullName: user.person?.fullName ?? null,
  }));
}

export { AUDIT_PAGE_SIZE };

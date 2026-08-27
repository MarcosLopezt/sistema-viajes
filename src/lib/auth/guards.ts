import "server-only";

import { prisma } from "@/lib/db/prisma";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { bootstrapPassengerLookup } from "@/lib/auth/passenger-bootstrap";
import { ForbiddenError, UnauthorizedError } from "@/lib/auth/errors";
import {
  can,
  canEditPassenger,
  canViewPassenger,
  isAdmin,
  isCoordinator,
  type Capability,
  type ViewerContext,
} from "@/lib/auth/policy";
import type { GlobalRole, TripRole } from "@/generated/prisma/enums";

/**
 * Guards del servidor. Son cáscaras finas: resuelven quién es el usuario y
 * delegan la decisión en src/lib/auth/policy.ts.
 *
 * Regla que no se negocia: NINGUNA de estas funciones acepta un identificador
 * de identidad (userId, personId, passengerId propio) que venga del cliente.
 * El viewer se deriva siempre de la sesión. Los ids que sí llegan del cliente
 * son los del RECURSO al que se quiere acceder, y se validan contra el viewer.
 * Eso elimina de raíz la clase entera de bugs de IDOR.
 *
 * Este módulo NO consulta Passenger ni Person. Lo poco que necesita para
 * armar el viewer sale de `bootstrapPassengerLookup()`, que vive en su propio
 * archivo justamente para que la excepción sea una sola, tenga nombre y se
 * pueda verificar. Ver lib/auth/passenger-bootstrap.ts.
 */

export interface SessionUser {
  id: string;
  email: string;
  role: GlobalRole;
  personId: string | null;
}

/** Usuario de la sesión, o `null` si no hay sesión válida. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await createSupabaseServerClient();

  // getUser() revalida el token contra Supabase. getSession() lee la cookie sin
  // verificarla, así que no sirve para decidir permisos.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { id: true, email: true, role: true, personId: true },
  });

  return dbUser;
}

export async function requireSessionUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireSessionUser();
  if (user.role !== "ADMIN") {
    throw new ForbiddenError("Esta sección es solo para administradores.");
  }
  return user;
}

/**
 * Arma el contexto de autorización para un viaje puntual.
 *
 * `ownPassengerId` sale de la base a partir del userId de la sesión: es el
 * único lugar donde se resuelve, y por eso el pasajero no puede inflarlo.
 */
export async function getTripViewer(tripId: string): Promise<ViewerContext> {
  const user = await requireSessionUser();

  const [membership, ownPassenger] = await Promise.all([
    prisma.tripMember.findUnique({
      where: { tripId_userId: { tripId, userId: user.id } },
      select: { role: true },
    }),
    user.personId
      ? bootstrapPassengerLookup({ tripId, personId: user.personId })
      : Promise.resolve(null),
  ]);

  return {
    userId: user.id,
    globalRole: user.role,
    tripRole: membership?.role ?? null,
    ownPassengerId: ownPassenger?.id ?? null,
  };
}

/** Exige una capability sobre un viaje. Devuelve el viewer ya resuelto. */
export async function requireCapability(
  tripId: string,
  capability: Capability,
): Promise<ViewerContext> {
  const viewer = await getTripViewer(tripId);
  if (!can(viewer, capability)) {
    throw new ForbiddenError();
  }
  return viewer;
}

/**
 * Exige un rol sobre un viaje. Es el guard de entrada de todo el módulo de
 * presupuesto: ninguna operación sobre Trip, itinerario o costos se ejecuta
 * sin pasar por acá.
 *
 * Un ADMIN pasa siempre, sin necesidad de ser miembro del viaje.
 *
 * `requireTripRole` y `requireCapability` no son reglas paralelas: las dos
 * consultan la misma matriz de src/lib/auth/policy.ts. Esta es la forma corta
 * para el caso frecuente ("¿es coordinador de este viaje?"); la otra es la
 * granular, para cuando importa la acción puntual.
 */
export async function requireTripRole(
  tripId: string,
  role: TripRole = "COORDINADOR",
): Promise<ViewerContext> {
  const viewer = await getTripViewer(tripId);

  if (isAdmin(viewer)) return viewer;

  if (role === "COORDINADOR" && !isCoordinator(viewer)) {
    throw new ForbiddenError();
  }
  // Para PASAJERO alcanza con ser miembro del viaje, en cualquier rol.
  if (viewer.tripRole === null) {
    throw new ForbiddenError();
  }

  return viewer;
}

/**
 * Exige acceso a un pasajero concreto.
 *
 * Resuelve el viaje a partir del pasajero (no lo toma del cliente) para que no
 * se pueda pedir el pasajero de un viaje pasando el tripId de otro.
 */
export async function requirePassengerAccess(
  passengerId: string,
  mode: "view" | "edit" = "view",
): Promise<{ viewer: ViewerContext; tripId: string }> {
  const passenger = await bootstrapPassengerLookup({ passengerId });

  if (!passenger) throw new ForbiddenError();

  const viewer = await getTripViewer(passenger.tripId);
  const allowed =
    mode === "edit"
      ? canEditPassenger(viewer, passenger.id)
      : canViewPassenger(viewer, passenger.id);

  if (!allowed) throw new ForbiddenError();

  return { viewer, tripId: passenger.tripId };
}

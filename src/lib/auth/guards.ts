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
 *
 * Devuelve también el `personId`, que es con lo que `services/storage.ts` arma
 * el prefijo de la carpeta del bucket (`{tripId}/{personId}/`). Es un id y sale
 * de la misma lectura que ya hacía el guard: no hay una consulta nueva ni un
 * dato personal nuevo. Ver la nota en `passenger-bootstrap.ts`.
 */
export async function requirePassengerAccess(
  passengerId: string,
  mode: "view" | "edit" = "view",
): Promise<{ viewer: ViewerContext; tripId: string; personId: string }> {
  const passenger = await bootstrapPassengerLookup({ passengerId });

  if (!passenger) throw new ForbiddenError();

  const viewer = await getTripViewer(passenger.tripId);
  const allowed =
    mode === "edit"
      ? canEditPassenger(viewer, passenger.id)
      : canViewPassenger(viewer, passenger.id);

  if (!allowed) throw new ForbiddenError();

  return { viewer, tripId: passenger.tripId, personId: passenger.personId };
}

/**
 * Exige que quien mira sea una interesada, y devuelve LO SUYO.
 *
 * ── No recibe ningún identificador, y eso es el punto ─────────────────────
 *
 * Ni interestId, ni tripId, ni personId. Todo sale de la sesión. Es la misma
 * regla que el resto del módulo —el viewer nunca llega del cliente— llevada a
 * su forma más estricta: acá no hay un "recurso" que validar contra el viewer,
 * porque el recurso ES el viewer. Una interesada no puede pedir la Interest de
 * otra ni equivocándose de id, porque no hay id que pasar.
 *
 * ── Por qué NO exige `acceptingInterest` ─────────────────────────────────
 *
 * Porque `acceptingInterest` controla quién ENTRA al embudo, no quién puede
 * COMPLETAR el que ya empezó. Son dos preguntas distintas y confundirlas rompe
 * el flujo normal del negocio, no un borde:
 *
 *   se registra → coordinan el Zoom por WhatsApp → la reunión es dos semanas
 *   después → recién ahí paga la seña
 *
 * Con catorce lugares, las coordinadoras van a cerrar la captación mientras
 * todavía hay gente a mitad de camino. Si el cierre le cerrara también la
 * puerta a quien ya está adentro, esa persona queda sin poder pagar y sin
 * entender por qué — y nadie del otro lado se entera hasta que escribe.
 *
 * Entonces lo que se exige es lo que de verdad hace falta para cobrarle:
 *
 *   · una Interest suya que no esté DESCARTADA — descartada es "no sigue", y
 *     alguien que no sigue no tiene por qué poder mandar plata;
 *   · un viaje en un estado que admita cobrar: ABIERTO o CERRADO. BORRADOR
 *     todavía no es un viaje, y FINALIZADO ya pasó.
 *
 * Quien NO tiene Interest previa sigue sin poder hacer nada acá, y para
 * registrarse tiene que ir a `/interes`, que sí exige `acceptingInterest`. Esa
 * es la puerta de entrada y no se movió.
 *
 * Devuelve solo ids, igual que el bootstrap del pasajero, y por la misma
 * razón: quien llama los usa para construir una path o una consulta, nunca
 * para saltear una verificación.
 */
export interface InterestAccess {
  userId: string;
  interestId: string;
  tripId: string;
  /** El segundo segmento de sus paths en el bucket. Ver domain/storage-paths.ts. */
  personId: string;
}

/** Estados de viaje en los que todavía tiene sentido cobrar una seña. */
const TRIP_STATES_THAT_COLLECT = ["ABIERTO", "CERRADO"] as const;

export async function requireInterestAccess(): Promise<InterestAccess> {
  const user = await requireSessionUser();

  // `personId` es una columna de User, no una consulta a Person: es la clave
  // foránea que ya trae la sesión.
  if (!user.personId) throw new ForbiddenError();

  const interest = await prisma.interest.findFirst({
    where: {
      userId: user.id,
      status: { not: "DESCARTADA" },
      trip: { status: { in: [...TRIP_STATES_THAT_COLLECT] } },
    },
    // La más reciente: una misma persona puede haberse anotado en el viaje del
    // año pasado y en el de este.
    orderBy: { createdAt: "desc" },
    select: { id: true, tripId: true },
  });

  if (!interest) throw new ForbiddenError();

  return {
    userId: user.id,
    interestId: interest.id,
    tripId: interest.tripId,
    personId: user.personId,
  };
}

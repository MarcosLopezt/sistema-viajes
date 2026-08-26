import "server-only";

import { prisma } from "@/lib/db/prisma";
import {
  getTripViewer,
  requirePassengerAccess,
  requireCapability,
} from "@/lib/auth/guards";
import { passengerVisibilityFilter } from "@/lib/auth/policy";
import { ForbiddenError } from "@/lib/auth/errors";
import type { PassengerMixInput } from "@/lib/domain/pricing";

/**
 * ÚNICO punto de acceso a Passenger y Person.
 *
 * Ninguna página, Server Action ni servicio consulta esas dos tablas por
 * fuera de este módulo. La razón es que el aislamiento entre pasajeros
 * depende de que `passengerVisibilityFilter()` se aplique SIEMPRE, y una
 * regla que hay que acordarse de repetir en cada consulta es una regla que
 * tarde o temprano se olvida en alguna.
 *
 * Si aparece una consulta a `prisma.passenger` o `prisma.person` en otro
 * archivo, es un bug de seguridad, no un atajo.
 *
 * Regla que se repite en todas las funciones: el identificador del viewer
 * sale de la sesión; el que llega del cliente es el del recurso.
 */

/** Campos de Person que puede ver un coordinador en el listado. */
const PERSON_LIST_FIELDS = {
  id: true,
  fullName: true,
  nationalityCountry: true,
  passportNumber: true,
  passportExpiryDate: true,
  preferredLanguage: true,
  hasDietaryRestrictions: true,
  hasMobilityRestrictions: true,
} as const;

export interface PassengerListItem {
  id: string;
  roomType: "DOBLE" | "SINGLE";
  status: "INVITADO" | "REGISTRADO" | "CONFIRMADO" | "CANCELADO";
  isCoordinator: boolean;
  roomId: string | null;
  person: {
    id: string;
    fullName: string | null;
    nationalityCountry: string | null;
    passportNumber: string | null;
    passportExpiryDate: Date | null;
    preferredLanguage: "ES" | "EN";
    hasDietaryRestrictions: boolean;
    hasMobilityRestrictions: boolean;
  };
}

/**
 * Pasajeros del viaje que el viewer tiene derecho a ver.
 *
 * Un coordinador ve a todos; un pasajero se ve solo a sí mismo. El alcance lo
 * impone el `where`, no un filtrado posterior en memoria: así una fila ajena
 * nunca llega siquiera a salir de la base.
 */
export async function listPassengers(
  tripId: string,
): Promise<PassengerListItem[]> {
  const viewer = await getTripViewer(tripId);

  // Alguien que no es miembro del viaje ni admin no ve absolutamente nada.
  if (viewer.tripRole === null && viewer.globalRole !== "ADMIN") {
    throw new ForbiddenError();
  }

  return prisma.passenger.findMany({
    where: { tripId, ...passengerVisibilityFilter(viewer) },
    orderBy: [{ isCoordinator: "desc" }, { person: { fullName: "asc" } }],
    select: {
      id: true,
      roomType: true,
      status: true,
      isCoordinator: true,
      roomId: true,
      person: { select: PERSON_LIST_FIELDS },
    },
  });
}

/**
 * Un pasajero puntual, con sus datos personales completos.
 * `requirePassengerAccess` resuelve el viaje desde el pasajero, así que no se
 * puede pedir el pasajero de un viaje pasando el tripId de otro.
 */
export async function getPassenger(passengerId: string) {
  await requirePassengerAccess(passengerId, "view");

  return prisma.passenger.findUnique({
    where: { id: passengerId },
    select: {
      id: true,
      tripId: true,
      roomType: true,
      roomId: true,
      status: true,
      isCoordinator: true,
      priceOverride: true,
      priceOverrideReason: true,
      person: true,
      trip: {
        select: {
          id: true,
          name: true,
          endDate: true,
          currency: true,
          passportValidityMonths: true,
          requireFullPassportValidity: true,
        },
      },
    },
  });
}

/**
 * Distribución de pasajeros para el cálculo del margen total.
 *
 * Exige `trip:viewFinancials`, no solo pertenencia al viaje: esto alimenta un
 * número que el pasajero nunca debe ver. Devuelve lo mínimo que el motor
 * necesita —tipo de habitación, estado, si es coordinador y el precio
 * pactado— y ningún dato personal.
 */
export async function getPassengerMix(
  tripId: string,
): Promise<PassengerMixInput[]> {
  await requireCapability(tripId, "trip:viewFinancials");

  const rows = await prisma.passenger.findMany({
    where: { tripId },
    select: {
      roomType: true,
      isCoordinator: true,
      status: true,
      priceOverride: true,
    },
  });

  return rows.map((row) => ({
    roomType: row.roomType,
    isCoordinator: row.isCoordinator,
    status: row.status,
    priceOverride: row.priceOverride?.toString() ?? null,
  }));
}

/** Conteo por estado, para las tarjetas del panel del coordinador. */
export async function countPassengersByStatus(
  tripId: string,
): Promise<Record<string, number>> {
  await requireCapability(tripId, "passenger:viewAll");

  const grouped = await prisma.passenger.groupBy({
    by: ["status"],
    where: { tripId, isCoordinator: false },
    _count: { _all: true },
  });

  return Object.fromEntries(
    grouped.map((row) => [row.status, row._count._all]),
  );
}

/**
 * El Passenger propio del usuario en un viaje, o `null` si no viaja.
 * Se resuelve desde la sesión: es la función que usa la home del pasajero.
 */
export async function getOwnPassenger(tripId: string) {
  const viewer = await getTripViewer(tripId);
  if (viewer.ownPassengerId === null) return null;
  return getPassenger(viewer.ownPassengerId);
}

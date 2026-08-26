import "server-only";

import { prisma } from "@/lib/db/prisma";
import {
  requireSessionUser,
  requireTripRole,
  requireCapability,
} from "@/lib/auth/guards";
import { ForbiddenError } from "@/lib/auth/errors";
import { auditMoney, auditValue, recordAudit } from "./audit";
import { getPassengerMix } from "./passengers";
import {
  calculateTripCost,
  calculateTripMargin,
  type TripCostBreakdown,
  type TripMarginResult,
} from "@/lib/domain/pricing";
import {
  toBusinessDate,
  type AccommodationInput,
  type DirectCostInput,
  type IndirectCostInput,
  type ItineraryStopInput,
  type TripGeneralInput,
  type TripPricesInput,
} from "@/lib/validation/trip";
import type { TripStatus } from "@/generated/prisma/enums";

/**
 * Servicios del módulo de viajes y presupuesto.
 *
 * Toda la autorización entra por `requireTripRole` / `requireCapability`, y
 * ninguna función acepta un identificador de identidad que venga del cliente:
 * el actor se resuelve siempre desde la sesión.
 *
 * Las Server Actions y las páginas son cáscaras finas sobre esto. La lógica
 * vive acá para poder testearla sin HTTP.
 */

// ------------------------------ Estados ------------------------------------

/**
 * Qué se puede hacer en cada estado del viaje.
 *
 *   BORRADOR    editable, invisible para los pasajeros. Es donde se arma.
 *   ABIERTO     se invita y se cobra. El presupuesto sigue editable porque en
 *               la práctica los precios del mayorista cambian con el viaje ya
 *               abierto; cada cambio queda auditado.
 *   CERRADO     no se invita más, se sigue cobrando.
 *   FINALIZADO  solo lectura.
 */
const EDITABLE_STATUSES: readonly TripStatus[] = [
  "BORRADOR",
  "ABIERTO",
  "CERRADO",
];

/** Transiciones permitidas. Cualquier otra se rechaza. */
const ALLOWED_TRANSITIONS: Readonly<Record<TripStatus, readonly TripStatus[]>> =
  {
    BORRADOR: ["ABIERTO"],
    ABIERTO: ["CERRADO", "BORRADOR"],
    CERRADO: ["FINALIZADO", "ABIERTO"],
    FINALIZADO: [],
  };

export class TripStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TripStateError";
  }
}

async function requireEditableTrip(tripId: string) {
  const viewer = await requireTripRole(tripId, "COORDINADOR");

  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: { id: true, status: true, budgetedPassengers: true },
  });

  if (!trip) throw new ForbiddenError();

  if (!EDITABLE_STATUSES.includes(trip.status)) {
    throw new TripStateError(
      "Este viaje está finalizado y ya no se puede modificar.",
    );
  }

  return { viewer, trip };
}

// ------------------------------ Listado ------------------------------------

export interface TripListItem {
  id: string;
  name: string;
  startDate: Date;
  endDate: Date;
  status: TripStatus;
  currency: "GBP" | "USD" | "EUR";
  budgetedPassengers: number;
  passengerCount: number;
}

/**
 * Viajes que el usuario puede ver.
 *
 * El ADMIN ve todos; el resto, solo aquellos donde tiene un TripMember. El
 * alcance se arma en el `where`: nunca se traen todos los viajes para
 * descartarlos después.
 */
export async function listTripsForViewer(): Promise<TripListItem[]> {
  const user = await requireSessionUser();

  const trips = await prisma.trip.findMany({
    where:
      user.role === "ADMIN"
        ? {}
        : { members: { some: { userId: user.id, role: "COORDINADOR" } } },
    orderBy: { startDate: "desc" },
    select: {
      id: true,
      name: true,
      startDate: true,
      endDate: true,
      status: true,
      currency: true,
      budgetedPassengers: true,
      _count: { select: { passengers: { where: { isCoordinator: false } } } },
    },
  });

  return trips.map(({ _count, ...trip }) => ({
    ...trip,
    passengerCount: _count.passengers,
  }));
}

// ------------------------- Alta y datos generales --------------------------

/**
 * Crea el viaje en BORRADOR y deja al creador como coordinador.
 *
 * El viaje se crea desde el paso 1 del wizard, no al final: así cada paso
 * siguiente puede autoguardar contra un id que ya existe, y el coordinador
 * puede abandonar y retomar sin perder nada.
 */
export async function createTripDraft(
  input: TripGeneralInput,
): Promise<{ id: string }> {
  const user = await requireSessionUser();

  return prisma.$transaction(async (tx) => {
    const trip = await tx.trip.create({
      data: {
        name: input.name,
        startDate: toBusinessDate(input.startDate),
        endDate: toBusinessDate(input.endDate),
        currency: input.currency,
        minPassengers: input.minPassengers,
        maxPassengers: input.maxPassengers,
        budgetedPassengers: input.budgetedPassengers,
        coordinatorCount: input.coordinatorCount,
        passportValidityMonths: input.passportValidityMonths,
        requireFullPassportValidity: input.requireFullPassportValidity,
        status: "BORRADOR",
      },
      select: { id: true },
    });

    // Sin esto el creador no podría volver a entrar a su propio viaje: la
    // autorización mira TripMember, no quién ejecutó el create.
    await tx.tripMember.create({
      data: { tripId: trip.id, userId: user.id, role: "COORDINADOR" },
    });

    return trip;
  });
}

export async function updateTripGeneral(
  tripId: string,
  input: TripGeneralInput,
): Promise<void> {
  const { viewer } = await requireEditableTrip(tripId);

  const before = await prisma.trip.findUniqueOrThrow({
    where: { id: tripId },
    select: { budgetedPassengers: true },
  });

  await prisma.trip.update({
    where: { id: tripId },
    data: {
      name: input.name,
      startDate: toBusinessDate(input.startDate),
      endDate: toBusinessDate(input.endDate),
      currency: input.currency,
      minPassengers: input.minPassengers,
      maxPassengers: input.maxPassengers,
      budgetedPassengers: input.budgetedPassengers,
      coordinatorCount: input.coordinatorCount,
      passportValidityMonths: input.passportValidityMonths,
      requireFullPassportValidity: input.requireFullPassportValidity,
    },
  });

  // budgetedPassengers mueve el costo de todos los pasajeros, así que se
  // audita igual que un cambio de precio.
  await recordAudit(viewer.userId, [
    {
      entity: "Trip",
      entityId: tripId,
      field: "budgetedPassengers",
      oldValue: auditValue(before.budgetedPassengers),
      newValue: auditValue(input.budgetedPassengers),
    },
  ]);
}

export async function updateTripStatus(
  tripId: string,
  status: TripStatus,
): Promise<void> {
  const viewer = await requireTripRole(tripId, "COORDINADOR");

  const trip = await prisma.trip.findUniqueOrThrow({
    where: { id: tripId },
    select: { status: true },
  });

  if (!ALLOWED_TRANSITIONS[trip.status].includes(status)) {
    throw new TripStateError(
      `No se puede pasar de ${trip.status} a ${status}.`,
    );
  }

  await prisma.trip.update({ where: { id: tripId }, data: { status } });

  await recordAudit(viewer.userId, [
    {
      entity: "Trip",
      entityId: tripId,
      field: "status",
      oldValue: trip.status,
      newValue: status,
    },
  ]);
}

// ------------------------------- Precios -----------------------------------

/**
 * Fija el precio de lista del viaje.
 *
 * Todo cambio de precio queda auditado con el valor anterior: es plata, y
 * "¿cuándo pasó de 3990 a 4100?" es una pregunta que se va a hacer.
 */
export async function setTripPrices(
  tripId: string,
  input: TripPricesInput,
): Promise<void> {
  const viewer = await requireCapability(tripId, "payment:definePlan");

  const before = await prisma.trip.findUniqueOrThrow({
    where: { id: tripId },
    select: { priceDouble: true, priceSingle: true, status: true },
  });

  if (!EDITABLE_STATUSES.includes(before.status)) {
    throw new TripStateError(
      "Este viaje está finalizado y ya no se puede modificar.",
    );
  }

  await prisma.trip.update({
    where: { id: tripId },
    data: { priceDouble: input.priceDouble, priceSingle: input.priceSingle },
  });

  await recordAudit(viewer.userId, [
    {
      entity: "Trip",
      entityId: tripId,
      field: "priceDouble",
      oldValue: auditMoney(before.priceDouble),
      newValue: auditMoney(input.priceDouble),
    },
    {
      entity: "Trip",
      entityId: tripId,
      field: "priceSingle",
      oldValue: auditMoney(before.priceSingle),
      newValue: auditMoney(input.priceSingle),
    },
  ]);
}

/**
 * Precio pactado para un pasajero puntual.
 *
 * Es lo que resuelve el caso del pasajero en base doble que se queda sin
 * compañero: el sistema avisa, pero la decisión —y el precio— son del
 * coordinador. También queda auditado.
 */
export async function setPassengerPriceOverride(
  passengerId: string,
  priceOverride: string | null,
  reason: string | null,
): Promise<void> {
  const passenger = await prisma.passenger.findUnique({
    where: { id: passengerId },
    select: { id: true, tripId: true, priceOverride: true },
  });

  if (!passenger) throw new ForbiddenError();

  const viewer = await requireCapability(passenger.tripId, "payment:definePlan");

  await prisma.passenger.update({
    where: { id: passengerId },
    data: { priceOverride, priceOverrideReason: reason },
  });

  await recordAudit(viewer.userId, [
    {
      entity: "Passenger",
      entityId: passengerId,
      field: "priceOverride",
      oldValue: auditMoney(passenger.priceOverride),
      newValue: auditMoney(priceOverride),
    },
  ]);
}

// -------------------- Itinerario, hospedajes y costos ----------------------

export async function upsertItineraryStop(
  tripId: string,
  input: ItineraryStopInput,
): Promise<{ id: string }> {
  await requireEditableTrip(tripId);

  const data = {
    tripId,
    order: input.order,
    city: input.city,
    country: input.country,
    fromDate: toBusinessDate(input.fromDate),
    toDate: toBusinessDate(input.toDate),
    notes: input.notes ?? null,
  };

  if (input.id) {
    // El `where` incluye tripId: sin eso se podría editar la parada de otro
    // viaje pasando un id ajeno.
    const updated = await prisma.itineraryStop.updateMany({
      where: { id: input.id, tripId },
      data,
    });
    if (updated.count === 0) throw new ForbiddenError();
    return { id: input.id };
  }

  return prisma.itineraryStop.create({ data, select: { id: true } });
}

export async function deleteItineraryStop(
  tripId: string,
  stopId: string,
): Promise<void> {
  await requireEditableTrip(tripId);
  const { count } = await prisma.itineraryStop.deleteMany({
    where: { id: stopId, tripId },
  });
  if (count === 0) throw new ForbiddenError();
}

export async function upsertAccommodation(
  tripId: string,
  stopId: string,
  input: AccommodationInput,
): Promise<{ id: string }> {
  await requireEditableTrip(tripId);

  // La parada tiene que pertenecer a este viaje.
  const stop = await prisma.itineraryStop.findFirst({
    where: { id: stopId, tripId },
    select: { id: true },
  });
  if (!stop) throw new ForbiddenError();

  const data = {
    stopId,
    hotelName: input.hotelName,
    nights: input.nights,
    pricePerNightDouble: input.pricePerNightDouble,
    pricePerNightSingle: input.pricePerNightSingle,
    notes: input.notes ?? null,
  };

  if (input.id) {
    const updated = await prisma.accommodation.updateMany({
      where: { id: input.id, stopId },
      data,
    });
    if (updated.count === 0) throw new ForbiddenError();
    return { id: input.id };
  }

  return prisma.accommodation.create({ data, select: { id: true } });
}

export async function deleteAccommodation(
  tripId: string,
  accommodationId: string,
): Promise<void> {
  await requireEditableTrip(tripId);
  const { count } = await prisma.accommodation.deleteMany({
    where: { id: accommodationId, stop: { tripId } },
  });
  if (count === 0) throw new ForbiddenError();
}

export async function upsertDirectCost(
  tripId: string,
  input: DirectCostInput,
): Promise<{ id: string }> {
  await requireEditableTrip(tripId);

  const data = {
    tripId,
    stopId: input.stopId ?? null,
    concept: input.concept,
    amountPerPassenger: input.amountPerPassenger,
    type: input.type,
  };

  if (input.id) {
    const updated = await prisma.directCost.updateMany({
      where: { id: input.id, tripId },
      data,
    });
    if (updated.count === 0) throw new ForbiddenError();
    return { id: input.id };
  }

  return prisma.directCost.create({ data, select: { id: true } });
}

export async function deleteDirectCost(
  tripId: string,
  costId: string,
): Promise<void> {
  await requireEditableTrip(tripId);
  const { count } = await prisma.directCost.deleteMany({
    where: { id: costId, tripId },
  });
  if (count === 0) throw new ForbiddenError();
}

export async function upsertIndirectCost(
  tripId: string,
  input: IndirectCostInput,
): Promise<{ id: string }> {
  await requireEditableTrip(tripId);

  const data = {
    tripId,
    concept: input.concept,
    totalAmount: input.totalAmount,
    type: input.type,
  };

  if (input.id) {
    const updated = await prisma.indirectCost.updateMany({
      where: { id: input.id, tripId },
      data,
    });
    if (updated.count === 0) throw new ForbiddenError();
    return { id: input.id };
  }

  return prisma.indirectCost.create({ data, select: { id: true } });
}

export async function deleteIndirectCost(
  tripId: string,
  costId: string,
): Promise<void> {
  await requireEditableTrip(tripId);
  const { count } = await prisma.indirectCost.deleteMany({
    where: { id: costId, tripId },
  });
  if (count === 0) throw new ForbiddenError();
}

// ---------------------------- Lectura completa -----------------------------

/**
 * Todo lo que el wizard de presupuesto necesita, en una sola consulta.
 *
 * Exige `trip:viewFinancials`: acá viajan costos y márgenes, que el pasajero
 * no puede ver bajo ninguna circunstancia. Los Decimal se serializan a string
 * antes de salir, porque los Client Components no pueden recibirlos.
 */
export async function getTripBudget(tripId: string) {
  await requireCapability(tripId, "trip:viewFinancials");

  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: {
      id: true,
      name: true,
      startDate: true,
      endDate: true,
      currency: true,
      status: true,
      minPassengers: true,
      maxPassengers: true,
      budgetedPassengers: true,
      coordinatorCount: true,
      priceDouble: true,
      priceSingle: true,
      passportValidityMonths: true,
      requireFullPassportValidity: true,
      stops: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          order: true,
          city: true,
          country: true,
          fromDate: true,
          toDate: true,
          notes: true,
          accommodations: {
            select: {
              id: true,
              hotelName: true,
              nights: true,
              pricePerNightDouble: true,
              pricePerNightSingle: true,
              notes: true,
            },
          },
        },
      },
      directCosts: {
        orderBy: { concept: "asc" },
        select: {
          id: true,
          stopId: true,
          concept: true,
          amountPerPassenger: true,
          type: true,
        },
      },
      indirectCosts: {
        orderBy: { concept: "asc" },
        select: { id: true, concept: true, totalAmount: true, type: true },
      },
    },
  });

  if (!trip) throw new ForbiddenError();

  const accommodations = trip.stops.flatMap((stop) =>
    stop.accommodations.map((a) => ({
      nights: a.nights,
      pricePerNightDouble: a.pricePerNightDouble.toString(),
      pricePerNightSingle: a.pricePerNightSingle.toString(),
    })),
  );

  const breakdown = calculateTripCost({
    budgetedPassengers: trip.budgetedPassengers,
    accommodations,
    directCosts: trip.directCosts.map((c) => ({
      amountPerPassenger: c.amountPerPassenger.toString(),
    })),
    indirectCosts: trip.indirectCosts.map((c) => ({
      totalAmount: c.totalAmount.toString(),
    })),
  });

  const margin = calculateTripMargin(
    breakdown,
    {
      priceDouble: trip.priceDouble?.toString() ?? null,
      priceSingle: trip.priceSingle?.toString() ?? null,
    },
    await getPassengerMix(tripId),
    trip.budgetedPassengers,
  );

  // Cuántos pasajeros ya tienen un plan de pagos generado.
  //
  // Un plan congela su totalAmount y sus cuotas al crearse: cambiar el precio
  // del viaje NO los toca. Eso es deliberado —nadie quiere que a alguien que
  // ya pagó dos cuotas se le reescriba la deuda— pero es invisible si no se
  // dice, así que este número alimenta la advertencia del paso de precios.
  const passengersWithActivePlan = await prisma.passenger.count({
    where: { tripId, isCoordinator: false, paymentPlan: { isNot: null } },
  });

  return {
    trip: serializeTrip(trip),
    breakdown: serializeBreakdown(breakdown),
    margin: serializeMargin(margin),
    passengersWithActivePlan,
  };
}

export type TripBudget = Awaited<ReturnType<typeof getTripBudget>>;

// --------------------------- Serialización ---------------------------------
// Prisma.Decimal no cruza la frontera servidor→cliente: React no sabe
// serializarlo. Se convierte a string una sola vez, acá, en lugar de que cada
// componente se acuerde de hacerlo.

function serializeTrip(trip: {
  id: string;
  name: string;
  startDate: Date;
  endDate: Date;
  currency: "GBP" | "USD" | "EUR";
  status: TripStatus;
  minPassengers: number;
  maxPassengers: number;
  budgetedPassengers: number;
  coordinatorCount: number;
  priceDouble: { toString(): string } | null;
  priceSingle: { toString(): string } | null;
  passportValidityMonths: number;
  requireFullPassportValidity: boolean;
  stops: readonly {
    id: string;
    order: number;
    city: string;
    country: string;
    fromDate: Date;
    toDate: Date;
    notes: string | null;
    accommodations: readonly {
      id: string;
      hotelName: string;
      nights: number;
      pricePerNightDouble: { toString(): string };
      pricePerNightSingle: { toString(): string };
      notes: string | null;
    }[];
  }[];
  directCosts: readonly {
    id: string;
    stopId: string | null;
    concept: string;
    amountPerPassenger: { toString(): string };
    type: "COMIDA" | "EVENTO" | "TRANSPORTE" | "OTRO";
  }[];
  indirectCosts: readonly {
    id: string;
    concept: string;
    totalAmount: { toString(): string };
    type: "CHARTER" | "TRANSFER" | "HOSPEDAJE_COORDINADOR" | "OTRO";
  }[];
}) {
  return {
    ...trip,
    priceDouble: trip.priceDouble?.toString() ?? null,
    priceSingle: trip.priceSingle?.toString() ?? null,
    stops: trip.stops.map((stop) => ({
      ...stop,
      accommodations: stop.accommodations.map((a) => ({
        ...a,
        pricePerNightDouble: a.pricePerNightDouble.toString(),
        pricePerNightSingle: a.pricePerNightSingle.toString(),
      })),
    })),
    directCosts: trip.directCosts.map((c) => ({
      ...c,
      amountPerPassenger: c.amountPerPassenger.toString(),
    })),
    indirectCosts: trip.indirectCosts.map((c) => ({
      ...c,
      totalAmount: c.totalAmount.toString(),
    })),
  };
}

export interface SerializedBreakdown {
  directDouble: string;
  directSingle: string;
  indirectTotal: string;
  indirectPerPassenger: string;
  totalDouble: string;
  totalSingle: string;
  roundingResidue: string;
}

export function serializeBreakdown(
  breakdown: TripCostBreakdown,
): SerializedBreakdown {
  return {
    directDouble: breakdown.directDouble.toString(),
    directSingle: breakdown.directSingle.toString(),
    indirectTotal: breakdown.indirectTotal.toString(),
    indirectPerPassenger: breakdown.indirectPerPassenger.toString(),
    totalDouble: breakdown.totalDouble.toString(),
    totalSingle: breakdown.totalSingle.toString(),
    roundingResidue: breakdown.roundingResidue.toString(),
  };
}

export interface SerializedUnitMargin {
  price: string;
  cost: string;
  margin: string;
  marginPercent: string;
}

export interface SerializedTotalMargin {
  basis: TripMarginResult["totals"][number]["basis"];
  revenue: string;
  cost: string;
  margin: string;
  marginPercent: string;
}

export interface SerializedMargin {
  perPassengerDouble: SerializedUnitMargin | null;
  perPassengerSingle: SerializedUnitMargin | null;
  totals: SerializedTotalMargin[];
}

export function serializeMargin(margin: TripMarginResult): SerializedMargin {
  const unit = (
    value: TripMarginResult["perPassengerDouble"],
  ): SerializedUnitMargin | null =>
    value === null
      ? null
      : {
          price: value.price.toString(),
          cost: value.cost.toString(),
          margin: value.margin.toString(),
          marginPercent: value.marginPercent.toString(),
        };

  return {
    perPassengerDouble: unit(margin.perPassengerDouble),
    perPassengerSingle: unit(margin.perPassengerSingle),
    totals: margin.totals.map((total) => ({
      basis: total.basis,
      revenue: total.revenue.toString(),
      cost: total.cost.toString(),
      margin: total.margin.toString(),
      marginPercent: total.marginPercent.toString(),
    })),
  };
}

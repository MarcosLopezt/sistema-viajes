import "server-only";

import { prisma } from "@/lib/db/prisma";
import {
  getSessionUser,
  getTripViewer,
  requirePassengerAccess,
  requireCapability,
} from "@/lib/auth/guards";
import { editRequiresAudit, passengerVisibilityFilter } from "@/lib/auth/policy";
import { ForbiddenError } from "@/lib/auth/errors";
import { auditValue, recordAudit, type AuditEntry } from "./audit";
import { confirmUpload, removeFile } from "./storage";
import {
  evaluatePassport,
  type PassportEvaluation,
} from "@/lib/domain/passport";
import {
  evaluatePersonCompleteness,
  isPersonComplete,
  type PersonCompleteness,
} from "@/lib/domain/person";
import type { PassengerMixInput } from "@/lib/domain/pricing";
import { toCalendarDate, type CalendarDate } from "@/lib/domain/calendar";
import type { PersonDraftInput } from "@/lib/validation/person";
import type { PassengerStatus, RoomType } from "@/generated/prisma/enums";

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

export class PassengerStateError extends Error {
  constructor(
    message: string,
    readonly reason: "DATOS_INCOMPLETOS" | "PASAPORTE" | "TRANSICION" | "CUARTO",
  ) {
    super(message);
    this.name = "PassengerStateError";
  }
}

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

/** Campos que alimentan `isPersonComplete`. Se traen siempre juntos. */
const PERSON_COMPLETENESS_FIELDS = {
  fullName: true,
  nationalityCountry: true,
  residenceCountry: true,
  residenceAddress: true,
  residenceCity: true,
  mobilePhone: true,
  documentNumber: true,
  passportNumber: true,
  passportExpiryDate: true,
  emergencyContactName: true,
  emergencyContactPhone: true,
  medicalAssuranceCompany: true,
  medicalAssuranceId: true,
  medicalAssurancePhone: true,
  medicalAssuranceEmail: true,
  hasDietaryRestrictions: true,
  dietaryRestrictionsDetail: true,
  hasMobilityRestrictions: true,
  mobilityRestrictionsDetail: true,
  medicalAssuranceFileId: true,
} as const;

// ------------------------------ Listado ------------------------------------

export interface PassengerListItem {
  id: string;
  roomType: RoomType;
  status: PassengerStatus;
  isCoordinator: boolean;
  roomId: string | null;
  roomLabel: string | null;
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
  /** Semáforo: datos completos. */
  completeness: PersonCompleteness;
  /** Semáforo: pasaporte. */
  passport: PassportEvaluation;
  /** Está en base doble y sin compañero asignado. */
  needsRoommate: boolean;
}

/**
 * Pasajeros del viaje que el viewer tiene derecho a ver, con los tres
 * indicadores del semáforo ya resueltos.
 *
 * Un coordinador ve a todos; un pasajero se ve solo a sí mismo. El alcance lo
 * impone el `where`, no un filtrado posterior en memoria: así una fila ajena
 * nunca llega siquiera a salir de la base.
 */
export async function listPassengers(
  tripId: string,
): Promise<PassengerListItem[]> {
  const viewer = await getTripViewer(tripId);

  if (viewer.tripRole === null && viewer.globalRole !== "ADMIN") {
    throw new ForbiddenError();
  }

  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: {
      endDate: true,
      passportValidityMonths: true,
      requireFullPassportValidity: true,
    },
  });
  if (!trip) throw new ForbiddenError();

  const rows = await prisma.passenger.findMany({
    where: { tripId, ...passengerVisibilityFilter(viewer) },
    orderBy: [{ isCoordinator: "desc" }, { person: { fullName: "asc" } }],
    select: {
      id: true,
      roomType: true,
      status: true,
      isCoordinator: true,
      roomId: true,
      room: { select: { label: true, _count: { select: { passengers: true } } } },
      person: {
        select: { ...PERSON_LIST_FIELDS, ...PERSON_COMPLETENESS_FIELDS },
      },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    roomType: row.roomType,
    status: row.status,
    isCoordinator: row.isCoordinator,
    roomId: row.roomId,
    roomLabel: row.room?.label ?? null,
    person: {
      id: row.person.id,
      fullName: row.person.fullName,
      nationalityCountry: row.person.nationalityCountry,
      passportNumber: row.person.passportNumber,
      passportExpiryDate: row.person.passportExpiryDate,
      preferredLanguage: row.person.preferredLanguage,
      hasDietaryRestrictions: row.person.hasDietaryRestrictions,
      hasMobilityRestrictions: row.person.hasMobilityRestrictions,
    },
    completeness: evaluatePersonCompleteness(row.person),
    passport: evaluatePassport(row.person.passportExpiryDate, {
      tripEndDate: trip.endDate,
      passportValidityMonths: trip.passportValidityMonths,
      requireFullPassportValidity: trip.requireFullPassportValidity,
    }),
    // Alerta, no acción: el precio NO cambia solo. La decisión de qué hacer
    // con quien quedó sin compañero es del coordinador.
    needsRoommate:
      !row.isCoordinator &&
      row.roomType === "DOBLE" &&
      (row.room?._count.passengers ?? 0) < 2,
  }));
}

// ------------------------------ Detalle ------------------------------------

/**
 * Un pasajero puntual, con todo lo que hace falta para su ficha.
 *
 * `requirePassengerAccess` resuelve el viaje desde el pasajero, así que no se
 * puede pedir el pasajero de un viaje pasando el tripId de otro.
 */
export async function getPassenger(passengerId: string) {
  const { viewer } = await requirePassengerAccess(passengerId, "view");

  const passenger = await prisma.passenger.findUnique({
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
      room: {
        select: {
          id: true,
          label: true,
          passengers: {
            select: {
              id: true,
              person: { select: { fullName: true } },
            },
          },
        },
      },
      trip: {
        select: {
          id: true,
          name: true,
          startDate: true,
          endDate: true,
          currency: true,
          status: true,
          passportValidityMonths: true,
          requireFullPassportValidity: true,
        },
      },
    },
  });

  if (!passenger) throw new ForbiddenError();

  const passport = evaluatePassport(passenger.person.passportExpiryDate, {
    tripEndDate: passenger.trip.endDate,
    passportValidityMonths: passenger.trip.passportValidityMonths,
    requireFullPassportValidity: passenger.trip.requireFullPassportValidity,
  });

  /**
   * Del compañero de habitación se expone SOLO el nombre.
   *
   * Es información que va a saber igual apenas llegue al hotel, y tenerla
   * antes le ahorra una consulta al coordinador. Ningún otro dato de esa
   * persona —ni mail, ni teléfono, ni nada de salud— sale de acá.
   */
  const roommateName =
    passenger.room?.passengers.find((p) => p.id !== passenger.id)?.person
      .fullName ?? null;

  return {
    ...passenger,
    priceOverride: passenger.priceOverride?.toString() ?? null,
    room: passenger.room
      ? { id: passenger.room.id, label: passenger.room.label }
      : null,
    roommateName,
    completeness: evaluatePersonCompleteness(passenger.person),
    passport,
    /** Si es su propia ficha, el viewer es el pasajero mismo. */
    isOwnRecord: viewer.ownPassengerId === passenger.id,
  };
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

/** El viaje activo del usuario logueado, sin necesidad de saber el tripId. */
export async function getMyActivePassenger() {
  const user = await getSessionUser();
  if (!user?.personId) return null;

  const passenger = await prisma.passenger.findFirst({
    where: { personId: user.personId, status: { not: "CANCELADO" } },
    orderBy: { trip: { startDate: "desc" } },
    select: { id: true },
  });

  return passenger ? getPassenger(passenger.id) : null;
}

// ------------------------- Datos del pasajero ------------------------------

/**
 * Autoguardado. Acepta datos parciales, incompletos y mal formados.
 *
 * Este método NO valida contenido a propósito: lo que llega ya pasó por
 * `personDraftSchema`, que solo normaliza y acota longitudes. Si acá se
 * aplicara la validación estricta, un mail a medio escribir haría fallar el
 * guardado del paso entero y el pasajero perdería todo lo demás.
 *
 * La validación de verdad corre al finalizar el registro.
 */
export async function savePersonDraft(
  passengerId: string,
  draft: PersonDraftInput,
): Promise<void> {
  await requirePassengerAccess(passengerId, "edit");

  const passenger = await prisma.passenger.findUnique({
    where: { id: passengerId },
    select: { personId: true },
  });
  if (!passenger) throw new ForbiddenError();

  await prisma.person.update({
    where: { id: passenger.personId },
    data: {
      ...draft,
      passportExpiryDate: draft.passportExpiryDate
        ? new Date(`${draft.passportExpiryDate}T00:00:00.000Z`)
        : null,
    },
  });
}

/**
 * Finaliza el registro: pasa de INVITADO a REGISTRADO.
 *
 * Exige `isPersonComplete`, que es el MISMO predicado que alimenta el
 * porcentaje que ve el pasajero. Si fueran dos definiciones distintas,
 * llegaría al 100% y el botón seguiría sin dejarlo terminar.
 */
export async function finalizeRegistration(passengerId: string): Promise<void> {
  await requirePassengerAccess(passengerId, "edit");

  const passenger = await prisma.passenger.findUnique({
    where: { id: passengerId },
    select: {
      status: true,
      person: { select: PERSON_COMPLETENESS_FIELDS },
    },
  });
  if (!passenger) throw new ForbiddenError();

  if (!isPersonComplete(passenger.person)) {
    throw new PassengerStateError(
      "Todavía faltan datos obligatorios.",
      "DATOS_INCOMPLETOS",
    );
  }

  if (passenger.status === "INVITADO") {
    await prisma.passenger.update({
      where: { id: passengerId },
      data: { status: "REGISTRADO" },
    });
  }
}

/** Guarda la path del certificado médico, verificándola contra el bucket. */
export async function attachMedicalFile(
  passengerId: string,
  uploadedPath: string,
): Promise<void> {
  await requirePassengerAccess(passengerId, "edit");

  // `confirmUpload` consulta el objeto real: tipo y tamaño no salen de lo que
  // dijo el cliente.
  const path = await confirmUpload(passengerId, uploadedPath);

  const passenger = await prisma.passenger.findUnique({
    where: { id: passengerId },
    select: {
      personId: true,
      person: { select: { medicalAssuranceFileId: true } },
    },
  });
  if (!passenger) throw new ForbiddenError();

  const previous = passenger.person.medicalAssuranceFileId;

  await prisma.person.update({
    where: { id: passenger.personId },
    data: { medicalAssuranceFileId: path },
  });

  // El anterior se borra DESPUÉS de guardar el nuevo: si el borrado falla
  // queda un huérfano, que es mejor que perder el archivo que sí vale.
  if (previous && previous !== path) {
    await removeFile(previous).catch(() => {});
  }
}

// --------------------------- Edición por el coordinador --------------------

/** Campos que el coordinador puede editar de un pasajero. */
const COORDINATOR_EDITABLE = [
  "fullName",
  "nationalityCountry",
  "residenceCountry",
  "residenceAddress",
  "residenceCity",
  "mobilePhone",
  "documentNumber",
  "passportNumber",
  "passportExpiryDate",
  "emergencyContactName",
  "emergencyContactPhone",
  "medicalAssuranceCompany",
  "medicalAssuranceId",
  "medicalAssurancePhone",
  "medicalAssuranceEmail",
  "dietaryRestrictionsDetail",
  "mobilityRestrictionsDetail",
  "otherHealthNotes",
] as const;

/**
 * Edición de los datos de un pasajero por parte de un coordinador.
 *
 * Cada campo que cambia genera una entrada de AuditLog. El pasajero ve
 * después un aviso de que sus datos fueron modificados y cuándo: que alguien
 * más toque tu número de pasaporte sin que te enteres no es aceptable.
 */
export async function updatePersonByCoordinator(
  passengerId: string,
  changes: PersonDraftInput,
): Promise<number> {
  const { viewer } = await requirePassengerAccess(passengerId, "edit");

  const passenger = await prisma.passenger.findUnique({
    where: { id: passengerId },
    select: { personId: true, person: true },
  });
  if (!passenger) throw new ForbiddenError();

  const before = passenger.person as unknown as Record<string, unknown>;
  const entries: AuditEntry[] = [];
  const data: Record<string, unknown> = {};

  for (const field of COORDINATOR_EDITABLE) {
    if (!(field in changes)) continue;

    const raw = (changes as Record<string, unknown>)[field];
    const next =
      field === "passportExpiryDate" && typeof raw === "string" && raw !== ""
        ? new Date(`${raw}T00:00:00.000Z`)
        : (raw ?? null);

    data[field] = next;

    entries.push({
      entity: "Person",
      entityId: passenger.personId,
      field,
      oldValue: normalizeForAudit(before[field]),
      newValue: normalizeForAudit(next),
    });
  }

  if (Object.keys(data).length === 0) return 0;

  await prisma.person.update({ where: { id: passenger.personId }, data });

  // El pasajero editando lo suyo no genera auditoría: se audita lo que hace
  // un tercero sobre sus datos.
  if (!editRequiresAudit(viewer, passengerId)) return 0;

  return recordAudit(viewer.userId, entries);
}

function normalizeForAudit(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value).trim();
  return text === "" ? null : text;
}

export interface CoordinatorEdit {
  field: string;
  at: Date;
}

/**
 * Ediciones recientes hechas por un tercero sobre los datos del pasajero.
 * Alimenta el aviso "un coordinador actualizó tus datos el DD/MM/AAAA".
 */
export async function getRecentCoordinatorEdits(
  passengerId: string,
): Promise<CoordinatorEdit[]> {
  const { viewer } = await requirePassengerAccess(passengerId, "view");

  const passenger = await prisma.passenger.findUnique({
    where: { id: passengerId },
    select: { personId: true },
  });
  if (!passenger) return [];

  const logs = await prisma.auditLog.findMany({
    where: {
      entity: "Person",
      entityId: passenger.personId,
      // Lo que hizo el propio pasajero no es una novedad para él.
      actorUserId: { not: viewer.userId },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { field: true, createdAt: true },
  });

  return logs.map((log) => ({ field: log.field, at: log.createdAt }));
}

// ----------------------------- Estados -------------------------------------

const ALLOWED_TRANSITIONS: Readonly<
  Record<PassengerStatus, readonly PassengerStatus[]>
> = {
  INVITADO: ["REGISTRADO", "CANCELADO"],
  REGISTRADO: ["CONFIRMADO", "CANCELADO"],
  CONFIRMADO: ["CANCELADO"],
  // Volver de CANCELADO se hace re-invitando: así queda registro de la baja.
  CANCELADO: [],
};

/**
 * Confirma a un pasajero.
 *
 * Dos condiciones, las dos validadas ACÁ y no en la UI: los datos tienen que
 * estar completos y el pasaporte no puede ser bloqueante. Un botón
 * deshabilitado en pantalla no protege nada.
 */
export async function confirmPassenger(passengerId: string): Promise<void> {
  const passenger = await prisma.passenger.findUnique({
    where: { id: passengerId },
    select: {
      tripId: true,
      status: true,
      person: { select: PERSON_COMPLETENESS_FIELDS },
      trip: {
        select: {
          endDate: true,
          passportValidityMonths: true,
          requireFullPassportValidity: true,
        },
      },
    },
  });
  if (!passenger) throw new ForbiddenError();

  const viewer = await requireCapability(passenger.tripId, "passenger:editAny");

  if (!ALLOWED_TRANSITIONS[passenger.status].includes("CONFIRMADO")) {
    throw new PassengerStateError(
      `No se puede confirmar a alguien en estado ${passenger.status}.`,
      "TRANSICION",
    );
  }

  if (!isPersonComplete(passenger.person)) {
    throw new PassengerStateError(
      "Le faltan datos obligatorios. No se puede confirmar todavía.",
      "DATOS_INCOMPLETOS",
    );
  }

  const passport = evaluatePassport(passenger.person.passportExpiryDate, {
    tripEndDate: passenger.trip.endDate,
    passportValidityMonths: passenger.trip.passportValidityMonths,
    requireFullPassportValidity: passenger.trip.requireFullPassportValidity,
  });

  if (passport.blocksConfirmation) {
    throw new PassengerStateError(
      "El pasaporte no cumple los requisitos del viaje.",
      "PASAPORTE",
    );
  }

  await prisma.passenger.update({
    where: { id: passengerId },
    data: { status: "CONFIRMADO" },
  });

  await recordAudit(viewer.userId, [
    {
      entity: "Passenger",
      entityId: passengerId,
      field: "status",
      oldValue: passenger.status,
      newValue: "CONFIRMADO",
    },
  ]);
}

export async function cancelPassenger(passengerId: string): Promise<void> {
  const passenger = await prisma.passenger.findUnique({
    where: { id: passengerId },
    select: { tripId: true, status: true },
  });
  if (!passenger) throw new ForbiddenError();

  const viewer = await requireCapability(passenger.tripId, "passenger:editAny");

  if (passenger.status === "CANCELADO") return;

  await prisma.passenger.update({
    where: { id: passengerId },
    data: { status: "CANCELADO", roomId: null },
  });

  await recordAudit(viewer.userId, [
    {
      entity: "Passenger",
      entityId: passengerId,
      field: "status",
      oldValue: passenger.status,
      newValue: "CANCELADO",
    },
  ]);
}

// ----------------------------- Habitaciones --------------------------------

const MAX_PER_ROOM = 2;

export interface RoomListItem {
  id: string;
  label: string;
  occupants: { id: string; fullName: string | null }[];
}

export async function listRooms(tripId: string): Promise<RoomListItem[]> {
  await requireCapability(tripId, "passenger:viewAll");

  const rooms = await prisma.room.findMany({
    where: { tripId },
    orderBy: { label: "asc" },
    select: {
      id: true,
      label: true,
      passengers: {
        select: { id: true, person: { select: { fullName: true } } },
      },
    },
  });

  return rooms.map((room) => ({
    id: room.id,
    label: room.label,
    occupants: room.passengers.map((p) => ({
      id: p.id,
      fullName: p.person.fullName,
    })),
  }));
}

export async function createRoom(
  tripId: string,
  label: string,
): Promise<{ id: string }> {
  await requireCapability(tripId, "passenger:editAny");
  return prisma.room.create({
    data: { tripId, label: label.trim() },
    select: { id: true },
  });
}

/**
 * Asigna un pasajero a una habitación, o lo saca si `roomId` es null.
 *
 * El tope de dos se valida dentro de una transacción con el update: sin eso,
 * dos asignaciones simultáneas podrían dejar tres personas en el mismo cuarto.
 */
export async function assignRoom(
  passengerId: string,
  roomId: string | null,
): Promise<void> {
  const passenger = await prisma.passenger.findUnique({
    where: { id: passengerId },
    select: { tripId: true, roomId: true },
  });
  if (!passenger) throw new ForbiddenError();

  const viewer = await requireCapability(passenger.tripId, "passenger:editAny");

  await prisma.$transaction(async (tx) => {
    if (roomId !== null) {
      const room = await tx.room.findFirst({
        where: { id: roomId, tripId: passenger.tripId },
        select: { id: true, _count: { select: { passengers: true } } },
      });

      // La habitación tiene que ser de ESTE viaje.
      if (!room) throw new ForbiddenError();

      const alreadyThere = passenger.roomId === roomId;
      if (!alreadyThere && room._count.passengers >= MAX_PER_ROOM) {
        throw new PassengerStateError(
          "Esa habitación ya tiene dos personas.",
          "CUARTO",
        );
      }
    }

    await tx.passenger.update({
      where: { id: passengerId },
      data: { roomId },
    });
  });

  await recordAudit(viewer.userId, [
    {
      entity: "Passenger",
      entityId: passengerId,
      field: "roomId",
      oldValue: auditValue(passenger.roomId),
      newValue: auditValue(roomId),
    },
  ]);
}

// ------------------------- Datos para el presupuesto -----------------------

/**
 * Distribución de pasajeros para el cálculo del margen total.
 *
 * Exige `trip:viewFinancials`, no solo pertenencia al viaje: esto alimenta un
 * número que el pasajero nunca debe ver. Devuelve lo mínimo que el motor
 * necesita y ningún dato personal.
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

// --------------------------- Datos para pagos ------------------------------

/**
 * Lo que el módulo de pagos necesita saber de un pasajero y su viaje.
 *
 * Existe porque `lib/services/payments.ts` NO puede consultar `prisma.passenger`
 * ni `prisma.person`: ese es el invariante que hace que el aislamiento entre
 * pasajeros dependa de un solo archivo y no de que cada consulta nueva se
 * acuerde de acotarse. En vez de abrir una excepción "chica" —que es como
 * empiezan todas— el módulo de pagos pide acá lo que necesita, y lo que
 * necesita es esto y nada más: ningún dato personal, ninguno de salud.
 *
 * La autorización es de LECTURA: un coordinador pasa, y el pasajero pasa solo
 * para sí mismo. Las operaciones de escritura suman su propia capability en
 * el servicio de pagos.
 */
export interface PassengerForPayments {
  id: string;
  tripId: string;
  status: PassengerStatus;
  isCoordinator: boolean;
  roomType: RoomType;
  /** Precio pactado que pisa el de lista. String o null. */
  priceOverride: string | null;
  fullName: string | null;
  preferredLanguage: "ES" | "EN";
  trip: {
    id: string;
    name: string;
    currency: "GBP" | "USD" | "EUR";
    /** Fecha de calendario: el módulo de pagos no razona con instantes. */
    startDate: CalendarDate;
    priceDouble: string | null;
    priceSingle: string | null;
    paymentToleranceAmount: string;
    /** Zona en la que se decide qué día es "hoy". Ver lib/domain/calendar.ts. */
    timezone: string;
  };
  /** El viewer es este mismo pasajero. */
  isOwnRecord: boolean;
}

export async function getPassengerForPayments(
  passengerId: string,
): Promise<PassengerForPayments> {
  const { viewer } = await requirePassengerAccess(passengerId, "view");

  const row = await prisma.passenger.findUnique({
    where: { id: passengerId },
    select: {
      id: true,
      tripId: true,
      status: true,
      isCoordinator: true,
      roomType: true,
      priceOverride: true,
      person: { select: { fullName: true, preferredLanguage: true } },
      trip: {
        select: {
          id: true,
          name: true,
          currency: true,
          startDate: true,
          priceDouble: true,
          priceSingle: true,
          paymentToleranceAmount: true,
          timezone: true,
        },
      },
    },
  });

  if (!row) throw new ForbiddenError();

  return {
    id: row.id,
    tripId: row.tripId,
    status: row.status,
    isCoordinator: row.isCoordinator,
    roomType: row.roomType,
    priceOverride: row.priceOverride?.toString() ?? null,
    fullName: row.person.fullName,
    preferredLanguage: row.person.preferredLanguage,
    trip: {
      id: row.trip.id,
      name: row.trip.name,
      currency: row.trip.currency,
      startDate: toCalendarDate(row.trip.startDate),
      priceDouble: row.trip.priceDouble?.toString() ?? null,
      priceSingle: row.trip.priceSingle?.toString() ?? null,
      paymentToleranceAmount: row.trip.paymentToleranceAmount.toString(),
      timezone: row.trip.timezone,
    },
    isOwnRecord: viewer.ownPassengerId === row.id,
  };
}

export interface PassengerForPaymentsList {
  id: string;
  fullName: string | null;
  status: PassengerStatus;
  roomType: RoomType;
}

/**
 * Pasajeros facturables de un viaje, para la vista de pagos del coordinador.
 *
 * Excluye a los coordinadores porque no generan plan (decisión 2). El alcance
 * lo sigue imponiendo `passengerVisibilityFilter`: si esto lo llamara un
 * pasajero, se vería solo a sí mismo en vez de a todo el viaje.
 */
export async function listPassengersForPayments(
  tripId: string,
): Promise<PassengerForPaymentsList[]> {
  const viewer = await getTripViewer(tripId);

  if (viewer.tripRole === null && viewer.globalRole !== "ADMIN") {
    throw new ForbiddenError();
  }

  const rows = await prisma.passenger.findMany({
    where: {
      tripId,
      isCoordinator: false,
      ...passengerVisibilityFilter(viewer),
    },
    orderBy: { person: { fullName: "asc" } },
    select: {
      id: true,
      status: true,
      roomType: true,
      person: { select: { fullName: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    fullName: row.person.fullName,
    status: row.status,
    roomType: row.roomType,
  }));
}

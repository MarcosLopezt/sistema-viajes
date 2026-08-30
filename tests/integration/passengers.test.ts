import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actAs, actAsAnonymous } from "./setup";
import { prisma, disconnectDb } from "@/lib/db/prisma";
import { ForbiddenError, UnauthorizedError } from "@/lib/auth/errors";
import {
  createInvitation,
  InvitationError,
  listInvitations,
  peekInvitation,
  redeemInvitation,
  resendInvitation,
} from "@/lib/services/invitations";
import {
  assignRoom,
  cancelPassenger,
  confirmPassenger,
  createRoom,
  finalizeRegistration,
  getPassenger,
  getRecentCoordinatorEdits,
  listPassengers,
  PassengerStateError,
  savePersonDraft,
  updatePersonByCoordinator,
} from "@/lib/services/passengers";
import { createSignedDownloadUrl } from "@/lib/services/storage";

/**
 * Fase 3 contra la base real: invitaciones, registro, estados, habitaciones y
 * aislamiento. Solo la sesión de Supabase está mockeada.
 */

const SUFFIX = randomUUID().slice(0, 8);
const email = (name: string) => `${name}-${SUFFIX}@test.invalid`;

interface Actor {
  id: string;
  email: string;
  personId: string;
}

let tripId: string;
let coordinator: Actor;
let ana: Actor;
let beto: Actor;
let anaPassengerId: string;
let betoPassengerId: string;

/** Datos completos, para poder confirmar sin pelear con el predicado. */
const COMPLETE_PERSON = {
  fullName: `Ana ${SUFFIX}`,
  // Los tres obligatorios que agregó la fase 7. Sin ellos el predicado de
  // completitud da false y el gate a CONFIRMADO bloquea, que es exactamente
  // lo que tiene que hacer.
  birthDate: new Date("1990-06-21T00:00:00.000Z"),
  passportIssuingCountry: "Argentina",
  nationalityCountry: "Argentina",
  residenceCountry: "Argentina",
  residenceAddress: "Av. Siempreviva 742",
  residenceCity: "Buenos Aires",
  mobilePhone: "+54 9 11 5555 5555",
  documentNumber: "30123456",
  passportNumber: "AAF123456",
  emergencyContactName: "Juan",
  emergencyContactRelationship: "Hermano",
  emergencyContactPhone: "+54 9 11 4444 4444",
  medicalAssuranceCompany: "Cobertura SA",
  medicalAssuranceId: "POL-99881",
  medicalAssurancePhone: "+54 11 3333 3333",
  medicalAssuranceEmail: "asistencia@cobertura.example",
  hasDietaryRestrictions: false,
  hasMobilityRestrictions: false,
  medicalAssuranceFileId: "ruta/al/certificado.pdf",
};

async function makeActor(name: string): Promise<Actor> {
  const person = await prisma.person.create({
    data: { fullName: `${name} ${SUFFIX}` },
    select: { id: true },
  });
  const user = await prisma.user.create({
    data: {
      id: randomUUID(),
      email: email(name),
      role: "USER",
      personId: person.id,
    },
    select: { id: true, email: true },
  });
  return { ...user, personId: person.id };
}

beforeAll(async () => {
  coordinator = await makeActor("coord");
  ana = await makeActor("ana");
  beto = await makeActor("beto");

  const trip = await prisma.trip.create({
    data: {
      name: `Viaje fase 3 ${SUFFIX}`,
      startDate: new Date("2027-05-10T00:00:00.000Z"),
      endDate: new Date("2027-05-24T00:00:00.000Z"),
      currency: "GBP",
      minPassengers: 10,
      maxPassengers: 14,
      budgetedPassengers: 14,
      status: "ABIERTO",
      passportValidityMonths: 3,
      requireFullPassportValidity: false,
    },
    select: { id: true },
  });
  tripId = trip.id;

  await prisma.tripMember.createMany({
    data: [
      { tripId, userId: coordinator.id, role: "COORDINADOR" },
      { tripId, userId: ana.id, role: "PASAJERO" },
      { tripId, userId: beto.id, role: "PASAJERO" },
    ],
  });

  const [anaPassenger, betoPassenger] = await Promise.all([
    prisma.passenger.create({
      data: { tripId, personId: ana.personId, roomType: "DOBLE" },
      select: { id: true },
    }),
    prisma.passenger.create({
      data: { tripId, personId: beto.personId, roomType: "DOBLE" },
      select: { id: true },
    }),
  ]);
  anaPassengerId = anaPassenger.id;
  betoPassengerId = betoPassenger.id;
}, 60_000);

afterAll(async () => {
  if (tripId) await prisma.trip.deleteMany({ where: { id: tripId } });
  await prisma.user.deleteMany({
    where: { email: { endsWith: `-${SUFFIX}@test.invalid` } },
  });
  await prisma.person.deleteMany({ where: { fullName: { contains: SUFFIX } } });
  await prisma.auditLog.deleteMany({
    where: { entityId: { in: [anaPassengerId, betoPassengerId] } },
  });
  await disconnectDb();
}, 60_000);

// ---------------------------------------------------------------------------

describe("invitaciones", () => {
  it("guarda el hash del token, nunca el token en claro", async () => {
    actAs(coordinator);
    const invitation = await createInvitation(
      tripId,
      email("nueva"),
      "DOBLE",
    );

    const stored = await prisma.invitation.findUniqueOrThrow({
      where: { id: invitation.id },
      select: { tokenHash: true },
    });

    expect(stored.tokenHash).toBe(
      createHash("sha256").update(invitation.token).digest("hex"),
    );
    // Si la base se filtrara, el token en claro no está por ningún lado.
    expect(stored.tokenHash).not.toBe(invitation.token);
  });

  it("el token es largo y aleatorio", async () => {
    actAs(coordinator);
    const a = await createInvitation(tripId, email("a1"), "DOBLE");
    const b = await createInvitation(tripId, email("a2"), "DOBLE");

    expect(a.token.length).toBeGreaterThanOrEqual(40);
    expect(a.token).not.toBe(b.token);
  });

  it("vence a los 14 días", async () => {
    actAs(coordinator);
    const invitation = await createInvitation(tripId, email("a3"), "SINGLE");
    const days =
      (invitation.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(Math.round(days)).toBe(14);
  });

  it("un token inválido se rechaza", async () => {
    actAsAnonymous();
    await expect(peekInvitation("no-existe-este-token")).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof InvitationError && error.reason === "INVALIDA",
    );
  });

  it("un token vencido se rechaza", async () => {
    actAs(coordinator);
    const invitation = await createInvitation(tripId, email("vencida"), "DOBLE");

    await prisma.invitation.update({
      where: { id: invitation.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(peekInvitation(invitation.token)).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof InvitationError && error.reason === "VENCIDA",
    );
  });

  it("un token ya usado se rechaza", async () => {
    actAs(coordinator);
    const invitation = await createInvitation(tripId, email("usada"), "DOBLE");

    await prisma.invitation.update({
      where: { id: invitation.id },
      data: { usedAt: new Date() },
    });

    await expect(peekInvitation(invitation.token)).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof InvitationError && error.reason === "USADA",
    );
  });

  it("reenviar invalida el token anterior y emite uno nuevo", async () => {
    actAs(coordinator);
    const original = await createInvitation(
      tripId,
      email("reenvio"),
      "DOBLE",
    );

    // El original sirve antes del reenvío.
    await expect(peekInvitation(original.token)).resolves.toBeDefined();

    const replacement = await resendInvitation(original.id);

    expect(replacement.token).not.toBe(original.token);

    // El viejo deja de servir aunque no haya vencido: si se reenvía es
    // justamente porque el anterior se filtró o se perdió.
    await expect(peekInvitation(original.token)).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof InvitationError && error.reason === "REVOCADA",
    );

    await expect(peekInvitation(replacement.token)).resolves.toBeDefined();
  });

  it("el listado refleja el estado de cada invitación", async () => {
    actAs(coordinator);
    const invitations = await listInvitations(tripId);
    const states = new Set(invitations.map((i) => i.state));

    expect(invitations.length).toBeGreaterThan(0);
    expect(states.has("PENDIENTE")).toBe(true);
    expect(states.has("REVOCADA")).toBe(true);
  });

  it("un pasajero no puede invitar", async () => {
    actAs(ana);
    await expect(
      createInvitation(tripId, email("intruso"), "DOBLE"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("quien ya tiene cuenta no puede canjear sin estar logueado", async () => {
    // Sin esto, cualquiera con el link podría sumar la cuenta de otro.
    actAs(coordinator);
    const invitation = await createInvitation(tripId, beto.email, "DOBLE");

    actAsAnonymous();
    await expect(
      redeemInvitation(invitation.token, null),
    ).rejects.toBeInstanceOf(InvitationError);
  });

  it("quien ya tiene Person de otro viaje la reutiliza al canjear", async () => {
    // Es el caso "precargá sus datos": no se crea una Person nueva.
    actAs(coordinator);

    const otherTrip = await prisma.trip.create({
      data: {
        name: `Segundo viaje ${SUFFIX}`,
        startDate: new Date("2028-01-10T00:00:00.000Z"),
        endDate: new Date("2028-01-24T00:00:00.000Z"),
        currency: "GBP",
        minPassengers: 5,
        maxPassengers: 10,
        budgetedPassengers: 10,
        status: "ABIERTO",
      },
      select: { id: true },
    });

    await prisma.tripMember.create({
      data: { tripId: otherTrip.id, userId: coordinator.id, role: "COORDINADOR" },
    });

    const invitation = await createInvitation(
      otherTrip.id,
      ana.email,
      "SINGLE",
    );

    actAs(ana);
    const result = await redeemInvitation(invitation.token, null);

    expect(result.prefilled).toBe(true);

    const passenger = await prisma.passenger.findUniqueOrThrow({
      where: { id: result.passengerId },
      select: { personId: true, roomType: true, status: true },
    });

    // MISMA Person: llega al formulario con los datos del viaje anterior.
    expect(passenger.personId).toBe(ana.personId);
    expect(passenger.roomType).toBe("SINGLE");
    expect(passenger.status).toBe("INVITADO");

    await prisma.trip.delete({ where: { id: otherTrip.id } });
  });
});

// ---------------------------------------------------------------------------

describe("autoguardado del formulario", () => {
  it("persiste datos parciales y mal formados", async () => {
    // El corazón del requisito: el draft NO valida. Si validara, este guardado
    // fallaría entero y el pasajero perdería lo que sí había cargado.
    actAs(ana);

    await savePersonDraft(anaPassengerId, {
      fullName: "Ana a medio escribir",
      medicalAssuranceEmail: "ana@",
      mobilePhone: "todavía no sé",
      passportExpiryDate: null,
    });

    const person = await prisma.person.findUniqueOrThrow({
      where: { id: ana.personId },
      select: {
        fullName: true,
        medicalAssuranceEmail: true,
        mobilePhone: true,
      },
    });

    expect(person.fullName).toBe("Ana a medio escribir");
    expect(person.medicalAssuranceEmail).toBe("ana@");
    expect(person.mobilePhone).toBe("todavía no sé");
  });

  it("guardar de a un paso no borra lo del paso anterior", async () => {
    actAs(ana);

    await savePersonDraft(anaPassengerId, { fullName: `Ana ${SUFFIX}` });
    await savePersonDraft(anaPassengerId, { residenceCity: "Rosario" });

    const person = await prisma.person.findUniqueOrThrow({
      where: { id: ana.personId },
      select: { fullName: true, residenceCity: true },
    });

    expect(person.fullName).toBe(`Ana ${SUFFIX}`);
    expect(person.residenceCity).toBe("Rosario");
  });

  it("no deja finalizar con datos incompletos", async () => {
    actAs(ana);
    await expect(finalizeRegistration(anaPassengerId)).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof PassengerStateError &&
        error.reason === "DATOS_INCOMPLETOS",
    );
  });

  it("deja finalizar cuando está todo cargado", async () => {
    actAs(ana);

    await prisma.person.update({
      where: { id: ana.personId },
      data: {
        ...COMPLETE_PERSON,
        passportExpiryDate: new Date("2032-01-01T00:00:00.000Z"),
      },
    });

    await finalizeRegistration(anaPassengerId);

    const passenger = await prisma.passenger.findUniqueOrThrow({
      where: { id: anaPassengerId },
      select: { status: true },
    });
    expect(passenger.status).toBe("REGISTRADO");
  });

  it("un pasajero no puede tocar los datos de otro", async () => {
    actAs(ana);
    await expect(
      savePersonDraft(betoPassengerId, { fullName: "Hackeado" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

// ---------------------------------------------------------------------------

describe("transición a CONFIRMADO", () => {
  it("se bloquea si faltan datos", async () => {
    actAs(coordinator);

    // Beto no cargó nada todavía.
    await prisma.passenger.update({
      where: { id: betoPassengerId },
      data: { status: "REGISTRADO" },
    });

    await expect(confirmPassenger(betoPassengerId)).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof PassengerStateError &&
        error.reason === "DATOS_INCOMPLETOS",
    );
  });

  it("se bloquea por pasaporte vencido antes del viaje", async () => {
    actAs(coordinator);

    await prisma.person.update({
      where: { id: beto.personId },
      data: {
        ...COMPLETE_PERSON,
        fullName: `Beto ${SUFFIX}`,
        // Valores propios de Beto: sirven para comprobar que NADA suyo se
        // filtra en la respuesta que recibe su compañera de habitación.
        medicalAssuranceId: `SOLO-BETO-${SUFFIX}`,
        documentNumber: `99${SUFFIX.slice(0, 6)}`,
        // Vence el 01/05/2027, antes de que el viaje termine (24/05/2027).
        passportExpiryDate: new Date("2027-05-01T00:00:00.000Z"),
      },
    });

    await expect(confirmPassenger(betoPassengerId)).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof PassengerStateError && error.reason === "PASAPORTE",
    );
  });

  it("con el flag apagado, la advertencia NO bloquea", async () => {
    actAs(coordinator);

    await prisma.person.update({
      where: { id: beto.personId },
      data: {
        // Vence dentro de los 3 meses posteriores: 🟡 con el flag apagado.
        passportExpiryDate: new Date("2027-07-15T00:00:00.000Z"),
      },
    });

    await confirmPassenger(betoPassengerId);

    const passenger = await prisma.passenger.findUniqueOrThrow({
      where: { id: betoPassengerId },
      select: { status: true },
    });
    expect(passenger.status).toBe("CONFIRMADO");
  });

  it("con el flag prendido, la MISMA fecha sí bloquea", async () => {
    actAs(coordinator);

    // Se vuelve atrás para poder reintentar la confirmación.
    await prisma.passenger.update({
      where: { id: betoPassengerId },
      data: { status: "REGISTRADO" },
    });
    await prisma.trip.update({
      where: { id: tripId },
      data: { requireFullPassportValidity: true },
    });

    await expect(confirmPassenger(betoPassengerId)).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof PassengerStateError && error.reason === "PASAPORTE",
    );

    await prisma.trip.update({
      where: { id: tripId },
      data: { requireFullPassportValidity: false },
    });
  });

  it("no se puede confirmar a alguien INVITADO", async () => {
    actAs(coordinator);
    await prisma.passenger.update({
      where: { id: betoPassengerId },
      data: { status: "INVITADO" },
    });

    await expect(confirmPassenger(betoPassengerId)).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof PassengerStateError && error.reason === "TRANSICION",
    );

    await prisma.passenger.update({
      where: { id: betoPassengerId },
      data: { status: "CONFIRMADO" },
    });
  });

  it("un pasajero no puede confirmarse a sí mismo", async () => {
    // La validación vive en el servicio, no en un botón deshabilitado.
    actAs(ana);
    await expect(confirmPassenger(anaPassengerId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("dar de baja libera la habitación", async () => {
    actAs(coordinator);
    const room = await createRoom(tripId, `Baja ${SUFFIX}`);
    await assignRoom(betoPassengerId, room.id);

    await cancelPassenger(betoPassengerId);

    const passenger = await prisma.passenger.findUniqueOrThrow({
      where: { id: betoPassengerId },
      select: { status: true, roomId: true },
    });
    expect(passenger.status).toBe("CANCELADO");
    expect(passenger.roomId).toBeNull();

    await prisma.passenger.update({
      where: { id: betoPassengerId },
      data: { status: "CONFIRMADO" },
    });
  });
});

// ---------------------------------------------------------------------------

describe("habitaciones", () => {
  it("no admite una tercera persona", async () => {
    actAs(coordinator);

    const room = await createRoom(tripId, `Llena ${SUFFIX}`);
    await assignRoom(anaPassengerId, room.id);
    await assignRoom(betoPassengerId, room.id);

    const tercero = await makeActor("tercero");
    await prisma.tripMember.create({
      data: { tripId, userId: tercero.id, role: "PASAJERO" },
    });
    const terceroPassenger = await prisma.passenger.create({
      data: { tripId, personId: tercero.personId, roomType: "DOBLE" },
      select: { id: true },
    });

    await expect(
      assignRoom(terceroPassenger.id, room.id),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof PassengerStateError && error.reason === "CUARTO",
    );

    const occupants = await prisma.passenger.count({
      where: { roomId: room.id },
    });
    expect(occupants).toBe(2);
  });

  it("reasignar a la misma habitación no cuenta como tercero", async () => {
    actAs(coordinator);
    const room = await prisma.room.findFirstOrThrow({
      where: { tripId, label: `Llena ${SUFFIX}` },
      select: { id: true },
    });
    await expect(assignRoom(anaPassengerId, room.id)).resolves.toBeUndefined();
  });

  it("no se puede asignar a una habitación de otro viaje", async () => {
    actAs(coordinator);

    const otherTrip = await prisma.trip.create({
      data: {
        name: `Otro ${SUFFIX}`,
        startDate: new Date("2028-03-01T00:00:00.000Z"),
        endDate: new Date("2028-03-10T00:00:00.000Z"),
        currency: "GBP",
        minPassengers: 2,
        maxPassengers: 4,
        budgetedPassengers: 4,
      },
      select: { id: true },
    });
    const foreignRoom = await prisma.room.create({
      data: { tripId: otherTrip.id, label: "Ajena" },
      select: { id: true },
    });

    await expect(
      assignRoom(anaPassengerId, foreignRoom.id),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await prisma.trip.delete({ where: { id: otherTrip.id } });
  });

  it("el pasajero ve el nombre de su compañera y nada más", async () => {
    actAs(ana);
    const passenger = await getPassenger(anaPassengerId);

    expect(passenger.roommateName).toBe(`Beto ${SUFFIX}`);

    // Del compañero solo sale el nombre: ningún otro dato suyo viaja en la
    // respuesta. Se buscan valores que son exclusivamente de Beto.
    const serialized = JSON.stringify(passenger);
    expect(serialized).not.toContain(beto.email);
    expect(serialized).not.toContain(`SOLO-BETO-${SUFFIX}`);
    expect(serialized).not.toContain(`99${SUFFIX.slice(0, 6)}`);
  });

  it("marca a quien quedó solo en habitación compartida", async () => {
    actAs(coordinator);
    await assignRoom(betoPassengerId, null);

    const passengers = await listPassengers(tripId);
    const ana2 = passengers.find((p) => p.id === anaPassengerId);
    expect(ana2?.needsRoommate).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("edición por el coordinador", () => {
  it("audita cada campo y el pasajero ve el aviso", async () => {
    actAs(coordinator);

    const changed = await updatePersonByCoordinator(anaPassengerId, {
      passportNumber: "NUEVO12345",
      residenceCity: "Córdoba",
    });
    expect(changed).toBe(2);

    actAs(ana);
    const edits = await getRecentCoordinatorEdits(anaPassengerId);
    const fields = edits.map((edit) => edit.field);

    expect(fields).toContain("passportNumber");
    expect(fields).toContain("residenceCity");
  });

  it("lo que edita el propio pasajero no genera aviso", async () => {
    actAs(ana);
    const before = await getRecentCoordinatorEdits(anaPassengerId);

    await updatePersonByCoordinator(anaPassengerId, {
      residenceCity: "Mendoza",
    });

    const after = await getRecentCoordinatorEdits(anaPassengerId);
    expect(after.length).toBe(before.length);
  });

  it("un pasajero no puede editar a otro", async () => {
    actAs(ana);
    await expect(
      updatePersonByCoordinator(betoPassengerId, { fullName: "Hackeado" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

// ---------------------------------------------------------------------------

describe("aislamiento de datos y archivos", () => {
  it("un pasajero no llega a la ficha de otro", async () => {
    actAs(ana);
    await expect(getPassenger(betoPassengerId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("un pasajero no llega al ARCHIVO de otro", async () => {
    actAs(ana);
    await expect(
      createSignedDownloadUrl(
        betoPassengerId,
        `${tripId}/${betoPassengerId}/cobertura-medica-x.pdf`,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("tampoco pidiendo el archivo de otro desde su propio pasajero", async () => {
    // El intento de colarse: id propio, path ajena.
    actAs(ana);
    await expect(
      createSignedDownloadUrl(
        anaPassengerId,
        `${tripId}/${betoPassengerId}/cobertura-medica-x.pdf`,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("ni con una path que sale de la carpeta", async () => {
    actAs(ana);
    await expect(
      createSignedDownloadUrl(
        anaPassengerId,
        `${tripId}/${anaPassengerId}/../${betoPassengerId}/archivo.pdf`,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("el listado del pasajero solo lo trae a él", async () => {
    actAs(ana);
    const passengers = await listPassengers(tripId);
    expect(passengers).toHaveLength(1);
    expect(passengers[0]!.id).toBe(anaPassengerId);
  });

  it("sin sesión no se llega a nada", async () => {
    actAsAnonymous();
    await expect(getPassenger(anaPassengerId)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });
});

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actAs, actAsAnonymous } from "./setup";
import { prisma, disconnectDb } from "@/lib/db/prisma";
import { ForbiddenError, UnauthorizedError } from "@/lib/auth/errors";
import {
  buildPassengerListExport,
  buildPaymentsExport,
  buildRoomingExport,
} from "@/lib/services/exports";

/**
 * Exportaciones a Excel, contra la base real.
 *
 * Lo que se prueba acá es lo que un test unitario no puede: QUIÉN puede
 * descargar el archivo, QUÉ datos salen y que la descarga quede auditada.
 *
 * La forma del .xlsx se prueba en tests/domain/xlsx.test.ts, sin base.
 *
 * El caso que más importa es el pasajero: si la exportación aplicara el filtro
 * de visibilidad en vez de exigir la capability, un pasajero se llevaría un
 * archivo con una sola fila —la suya— en lugar de recibir un rechazo. Eso es
 * peor que fallar, porque parece que funcionó.
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
let ajeno: Actor;

/** Lee una hoja del .xlsx sin descomprimir: las entradas van en STORE. */
function sheetText(bytes: Uint8Array, sheet = 1): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const wanted = `xl/worksheets/sheet${sheet}.xml`;

  let offset = 0;
  while (offset + 4 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLength));
    if (name === wanted) {
      return decoder.decode(bytes.subarray(dataStart, dataStart + size));
    }
    offset = dataStart + size;
  }
  throw new Error(`no encontré ${wanted} en el paquete`);
}

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
  ajeno = await makeActor("ajeno");

  const trip = await prisma.trip.create({
    data: {
      name: `Viaje exportación ${SUFFIX}`,
      startDate: new Date("2027-05-10T00:00:00.000Z"),
      endDate: new Date("2027-05-24T00:00:00.000Z"),
      currency: "GBP",
      minPassengers: 10,
      maxPassengers: 14,
      budgetedPassengers: 14,
      status: "ABIERTO",
      passportValidityMonths: 3,
      requireFullPassportValidity: false,
      timezone: "America/Argentina/Buenos_Aires",
    },
    select: { id: true },
  });
  tripId = trip.id;

  await prisma.tripMember.createMany({
    data: [
      { tripId, userId: coordinator.id, role: "COORDINADOR" },
      { tripId, userId: ana.id, role: "PASAJERO" },
    ],
  });

  // Datos con los que se va a poder afirmar algo concreto en el archivo.
  await prisma.person.update({
    where: { id: ana.personId },
    data: {
      nationalityCountry: "Argentina",
      documentNumber: "30123456",
      passportNumber: "AAF999888",
      passportExpiryDate: new Date("2030-01-15T00:00:00.000Z"),
      emergencyContactName: `Emergencia ${SUFFIX}`,
      emergencyContactPhone: "+54 9 11 4444 4444",
      hasDietaryRestrictions: true,
      dietaryRestrictionsDetail: "Celíaca",
      hasMobilityRestrictions: false,
    },
  });

  const room = await prisma.room.create({
    data: { tripId, label: "101" },
    select: { id: true },
  });

  await prisma.passenger.create({
    data: {
      tripId,
      personId: ana.personId,
      roomType: "DOBLE",
      roomId: room.id,
      status: "CONFIRMADO",
    },
  });
}, 60_000);

afterAll(async () => {
  if (tripId) {
    await prisma.auditLog.deleteMany({ where: { entityId: tripId } });
    await prisma.trip.deleteMany({ where: { id: tripId } });
  }
  await prisma.user.deleteMany({
    where: { email: { endsWith: `-${SUFFIX}@test.invalid` } },
  });
  await prisma.person.deleteMany({ where: { fullName: { contains: SUFFIX } } });
  await disconnectDb();
}, 60_000);

// ---------------------------------------------------------------------------

describe("quién puede exportar", () => {
  it("el coordinador puede, y el archivo es un .xlsx", async () => {
    actAs(coordinator);
    const result = await buildPassengerListExport(tripId);

    expect(result.filename).toMatch(/^pasajeros-.*\.xlsx$/);
    // Firma de un ZIP: "PK\x03\x04".
    expect(Array.from(result.bytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it("un PASAJERO del viaje NO puede exportar el listado", async () => {
    actAs(ana);
    // Falla en vez de devolver un archivo con una sola fila. Un archivo
    // recortado parecería que funcionó.
    await expect(buildPassengerListExport(tripId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("un PASAJERO no puede exportar el estado de pagos", async () => {
    actAs(ana);
    await expect(buildPaymentsExport(tripId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("un PASAJERO no puede exportar la rooming list", async () => {
    actAs(ana);
    await expect(buildRoomingExport(tripId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("alguien ajeno al viaje no puede exportar nada", async () => {
    actAs(ajeno);
    await expect(buildPassengerListExport(tripId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("sin sesión no se exporta nada", async () => {
    actAsAnonymous();
    await expect(buildPassengerListExport(tripId)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });
});

describe("contenido del listado de pasajeros", () => {
  it("trae los datos que el hotel necesita", async () => {
    actAs(coordinator);
    const xml = sheetText((await buildPassengerListExport(tripId)).bytes);

    expect(xml).toContain(`ana ${SUFFIX}`);
    expect(xml).toContain("AAF999888");
    expect(xml).toContain("15/01/2030");
    expect(xml).toContain("Celíaca");
    expect(xml).toContain(`Emergencia ${SUFFIX}`);
    expect(xml).toContain("101");
  });

  it("la primera fila lleva la fecha de generación y el huso del viaje", async () => {
    actAs(coordinator);
    const now = new Date("2026-08-27T19:30:00.000Z");
    const xml = sheetText((await buildPassengerListExport(tripId, now)).bytes);

    // 19:30 UTC son las 16:30 en Buenos Aires. Sellar en la hora del proceso
    // —UTC en Vercel— pondría "19:30" en un archivo que se lee semanas
    // después, y esas tres horas no se recuperan.
    expect(xml).toContain("27/08/2026 16:30");
    expect(xml).toContain("America/Argentina/Buenos_Aires");
    // Y va en la fila 1, no enterrada al final.
    expect(xml).toMatch(/<row r="1">.*generado el.*<\/row>/);
  });

  it("no filtra datos que el hotel no necesita", async () => {
    actAs(coordinator);
    const xml = sheetText((await buildPassengerListExport(tripId)).bytes);

    // El mail y el certificado médico no salen del sistema en esta planilla.
    expect(xml).not.toContain(email("ana"));
  });
});

describe("rooming list", () => {
  it("arma las habitaciones desde Room", async () => {
    actAs(coordinator);
    const xml = sheetText((await buildRoomingExport(tripId)).bytes);

    expect(xml).toContain("101");
    expect(xml).toContain(`ana ${SUFFIX}`);
  });
});

describe("auditoría de la descarga", () => {
  it("cada exportación deja constancia de quién y cuándo", async () => {
    const before = await prisma.auditLog.count({
      where: { entity: "Export", entityId: tripId },
    });

    actAs(coordinator);
    await buildPassengerListExport(tripId);
    await buildRoomingExport(tripId);

    const rows = await prisma.auditLog.findMany({
      where: { entity: "Export", entityId: tripId },
      orderBy: { createdAt: "desc" },
      take: 2,
      select: { actorUserId: true, field: true, newValue: true },
    });

    const after = await prisma.auditLog.count({
      where: { entity: "Export", entityId: tripId },
    });

    expect(after).toBe(before + 2);
    expect(rows.every((row) => row.actorUserId === coordinator.id)).toBe(true);
    expect(rows.map((row) => row.field).sort()).toEqual(["pasajeros", "rooming"]);
    // Cuántas filas salieron: llevarse 40 fichas no es lo mismo que llevarse 1.
    expect(rows[0]?.newValue).toMatch(/fila\(s\)/);
  });

  it("un intento rechazado NO deja registro de descarga", async () => {
    const before = await prisma.auditLog.count({
      where: { entity: "Export", entityId: tripId },
    });

    actAs(ana);
    await expect(buildPassengerListExport(tripId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );

    const after = await prisma.auditLog.count({
      where: { entity: "Export", entityId: tripId },
    });
    expect(after).toBe(before);
  });
});

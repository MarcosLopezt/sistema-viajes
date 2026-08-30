import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { actAs } from "./setup";
import { prisma, disconnectDb } from "@/lib/db/prisma";
import { ForbiddenError } from "@/lib/auth/errors";
import { createSignedDownloadUrl, StorageError } from "@/lib/services/storage";
import { buildStoragePath } from "@/lib/domain/storage-paths";

/**
 * Un 404 tiene dos causas y el servidor tiene que poder distinguirlas.
 *
 * Quien pide el archivo ve el MISMO 404 en los dos casos, y eso no se toca:
 * un 403 le confirmaría a alguien que ese pago existe. Pero del lado del
 * servidor las dos situaciones no se parecen en nada:
 *
 *   PATH_FUERA_DE_CARPETA  la path guardada no respeta la convención, o
 *                          alguien pide el archivo de otro. Problema de DATOS.
 *   OBJETO_INEXISTENTE     la path está bien y el archivo no está en el
 *                          bucket. Problema de STORAGE.
 *
 * Este test existe porque diagnosticar esa diferencia sin logs costó una
 * sesión entera. Si alguien unifica los dos mensajes "para limpiar", el
 * próximo diagnóstico vuelve a arrancar de cero — y esto lo va a decir.
 */

const SUFFIX = randomUUID().slice(0, 8);

let tripId: string;
let passengerId: string;
let coordinator: { id: string; email: string };

beforeAll(async () => {
  const person = await prisma.person.create({
    data: { fullName: `coord ${SUFFIX}` },
    select: { id: true },
  });
  const user = await prisma.user.create({
    data: {
      id: randomUUID(),
      email: `coord-${SUFFIX}@test.invalid`,
      role: "USER",
      personId: person.id,
    },
    select: { id: true, email: true },
  });
  coordinator = user;

  const trip = await prisma.trip.create({
    data: {
      name: `Viaje diagnóstico ${SUFFIX}`,
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

  await prisma.tripMember.create({
    data: { tripId, userId: user.id, role: "COORDINADOR" },
  });

  const passengerPerson = await prisma.person.create({
    data: { fullName: `viajera ${SUFFIX}` },
    select: { id: true },
  });
  const passenger = await prisma.passenger.create({
    data: { tripId, personId: passengerPerson.id, roomType: "DOBLE" },
    select: { id: true },
  });
  passengerId = passenger.id;
}, 60_000);

afterAll(async () => {
  if (tripId) await prisma.trip.deleteMany({ where: { id: tripId } });
  await prisma.user.deleteMany({
    where: { email: { endsWith: `-${SUFFIX}@test.invalid` } },
  });
  await prisma.person.deleteMany({ where: { fullName: { contains: SUFFIX } } });
  await disconnectDb();
}, 60_000);

/** Corre algo capturando lo que se haya escrito con console.warn. */
async function captureWarnings(run: () => Promise<unknown>): Promise<{
  error: unknown;
  warnings: string[];
}> {
  const warnings: string[] = [];
  const spy = vi
    .spyOn(console, "warn")
    .mockImplementation((...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    });

  let error: unknown = null;
  try {
    await run();
  } catch (caught) {
    error = caught;
  } finally {
    spy.mockRestore();
  }

  return { error, warnings };
}

describe("las dos causas de un 404 quedan separadas en el log", () => {
  it("una path que no respeta la convención se registra como PATH_FUERA_DE_CARPETA", async () => {
    actAs(coordinator);

    // La forma que tenía el seed: el segundo segmento no es el passengerId.
    const { error, warnings } = await captureWarnings(() =>
      createSignedDownloadUrl(passengerId, `${tripId}/certificados/ana.pdf`),
    );

    expect(error).toBeInstanceOf(ForbiddenError);
    expect(warnings.join("\n")).toContain("PATH_FUERA_DE_CARPETA");
    expect(warnings.join("\n")).not.toContain("OBJETO_INEXISTENTE");
  });

  it("un archivo que no está en el bucket se registra como OBJETO_INEXISTENTE", async () => {
    actAs(coordinator);

    // Path perfectamente formada, archivo que nunca se subió.
    const path = buildStoragePath(
      tripId,
      passengerId,
      "comprobante-pago",
      "no-existe",
      "pdf",
    );

    const { error, warnings } = await captureWarnings(() =>
      createSignedDownloadUrl(passengerId, path),
    );

    expect(error).toBeInstanceOf(StorageError);
    expect(warnings.join("\n")).toContain("OBJETO_INEXISTENTE");
    expect(warnings.join("\n")).not.toContain("PATH_FUERA_DE_CARPETA");
  });

  it("el log dice qué carpeta se esperaba, para poder comparar de un vistazo", async () => {
    actAs(coordinator);

    const { warnings } = await captureWarnings(() =>
      createSignedDownloadUrl(passengerId, `${tripId}/otra-carpeta/x.pdf`),
    );

    // Sin esto hay que ir a buscar el passengerId a la base para entender
    // por qué se rechazó.
    expect(warnings.join("\n")).toContain(`${tripId}/${passengerId}/`);
  });
});

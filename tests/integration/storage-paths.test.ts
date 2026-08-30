import { afterAll, describe, expect, it } from "vitest";
import { prisma, disconnectDb } from "@/lib/db/prisma";
import { isInsidePassengerFolder } from "@/lib/domain/storage-paths";

/**
 * Toda path guardada en la base tiene que pasar el guard de descarga.
 *
 * ── Por qué este test existe ──────────────────────────────────────────────
 *
 * El seed escribió `{tripId}/certificados/{key}.pdf` durante tres fases. La
 * forma correcta es `{tripId}/{passengerId}/...`, así que esos archivos eran
 * imposibles de abrir: el guard los rechazaba con ForbiddenError y el usuario
 * veía un 404 sin explicación.
 *
 * El problema de fondo no fue que estuvieran mal escritas. Fue que NADIE las
 * estaba validando contra la convención que el código impone. Los tests
 * unitarios cubren el guard; este cubre los DATOS.
 *
 * Recorre lo que efectivamente hay en la base —seed, datos de prueba, lo que
 * sea— y lo pasa por la misma función que usa `createSignedDownloadUrl`. Si
 * alguien vuelve a escribir una path a mano, esto lo dice.
 *
 * No crea datos propios a propósito: lo que se está verificando es el estado
 * real de la base, no un caso armado.
 */

afterAll(async () => {
  await disconnectDb();
});

describe("las paths guardadas respetan la convención del bucket", () => {
  it("todos los certificados médicos caen en la carpeta de su pasajero", async () => {
    // Una Person puede viajar en varios viajes, y `medicalAssuranceFileId`
    // vive en Person, no en Passenger: el certificado se carga una vez y se
    // reutiliza. Así que la path tiene que caer en la carpeta de ALGUNO de
    // sus pasajeros, no necesariamente del primero.
    const people = await prisma.person.findMany({
      where: { medicalAssuranceFileId: { not: null } },
      select: {
        fullName: true,
        medicalAssuranceFileId: true,
        passengers: { select: { id: true, tripId: true } },
      },
    });

    const malas = people.filter(
      (person) =>
        !person.passengers.some((passenger) =>
          isInsidePassengerFolder(
            person.medicalAssuranceFileId!,
            passenger.tripId,
            passenger.id,
          ),
        ),
    );

    expect(
      malas.map((p) => `${p.fullName}: ${p.medicalAssuranceFileId}`),
    ).toEqual([]);
  });

  it("todos los comprobantes caen en la carpeta de su pasajero", async () => {
    const payments = await prisma.payment.findMany({
      where: { proofFileId: { not: null } },
      select: {
        id: true,
        proofFileId: true,
        plan: {
          select: { passenger: { select: { id: true, tripId: true } } },
        },
      },
    });

    const malas = payments.filter(
      (payment) =>
        !isInsidePassengerFolder(
          payment.proofFileId!,
          payment.plan.passenger.tripId,
          payment.plan.passenger.id,
        ),
    );

    expect(malas.map((p) => `${p.id}: ${p.proofFileId}`)).toEqual([]);
  });

  it("ninguna path guardada es una URL", async () => {
    // El bucket es privado y la base guarda paths internas. Una URL acá
    // significaría que en algún lado se está exponiendo el objeto.
    const [people, payments] = await Promise.all([
      prisma.person.findMany({
        where: { medicalAssuranceFileId: { not: null } },
        select: { medicalAssuranceFileId: true },
      }),
      prisma.payment.findMany({
        where: { proofFileId: { not: null } },
        select: { proofFileId: true },
      }),
    ]);

    const todas = [
      ...people.map((p) => p.medicalAssuranceFileId!),
      ...payments.map((p) => p.proofFileId!),
    ];

    expect(todas.filter((path) => /^https?:\/\//i.test(path))).toEqual([]);
    expect(todas.filter((path) => path.includes("/storage/v1/"))).toEqual([]);
  });
});

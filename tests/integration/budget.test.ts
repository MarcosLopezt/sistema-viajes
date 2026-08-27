import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actAs } from "./setup";
import { prisma, disconnectDb } from "@/lib/db/prisma";
import {
  createTripDraft,
  getTripBudget,
  setTripPrices,
  TripStateError,
  updateTripGeneral,
  updateTripStatus,
  upsertAccommodation,
  upsertDirectCost,
  upsertIndirectCost,
  upsertItineraryStop,
} from "@/lib/services/trip";
import { setPassengerPriceOverride } from "@/lib/services/passengers";
import { ForbiddenError } from "@/lib/auth/errors";

/**
 * Flujo completo del armado de un presupuesto, contra la base real.
 *
 * Reconstruye el viaje del seed paso a paso —el mismo que usan los tests
 * unitarios del motor— y verifica que los números que salen de la base
 * coinciden con los que calcula el motor con datos en memoria. Es lo que
 * detecta si algo se pierde al persistir: una escala de Decimal, un campo que
 * no se guarda, una relación mal armada.
 */

const SUFFIX = randomUUID().slice(0, 8);

let coordinator: { id: string; email: string };
let outsider: { id: string; email: string };
let tripId: string;

beforeAll(async () => {
  const makeUser = async (name: string) => {
    const person = await prisma.person.create({
      data: { fullName: `${name} ${SUFFIX}` },
      select: { id: true },
    });
    return prisma.user.create({
      data: {
        id: randomUUID(),
        email: `${name}-${SUFFIX}@test.invalid`,
        role: "USER",
        personId: person.id,
      },
      select: { id: true, email: true },
    });
  };

  coordinator = await makeUser("coord");
  outsider = await makeUser("ajeno");
}, 60_000);

afterAll(async () => {
  if (tripId) await prisma.trip.deleteMany({ where: { id: tripId } });
  await prisma.user.deleteMany({
    where: { email: { endsWith: `-${SUFFIX}@test.invalid` } },
  });
  await prisma.person.deleteMany({ where: { fullName: { endsWith: SUFFIX } } });
  await prisma.auditLog.deleteMany({ where: { entityId: tripId } });
  await disconnectDb();
}, 60_000);

describe("armado del presupuesto de punta a punta", () => {
  it("crea el borrador y deja al creador como coordinador", async () => {
    actAs(coordinator);

    const created = await createTripDraft({
      name: `Londres, París y Roma ${SUFFIX}`,
      startDate: "2027-05-10",
      endDate: "2027-05-24",
      currency: "GBP",
      minPassengers: 10,
      maxPassengers: 14,
      budgetedPassengers: 14,
      coordinatorCount: 2,
      passportValidityMonths: 3,
      requireFullPassportValidity: false,
    });

    tripId = created.id;

    const membership = await prisma.tripMember.findUnique({
      where: { tripId_userId: { tripId, userId: coordinator.id } },
      select: { role: true },
    });

    // Sin esta fila el creador no podría volver a entrar a su propio viaje.
    expect(membership?.role).toBe("COORDINADOR");

    const { trip } = await getTripBudget(tripId);
    expect(trip.status).toBe("BORRADOR");
  });

  it("un viaje vacío da costo cero sin fallar", async () => {
    actAs(coordinator);
    const { breakdown } = await getTripBudget(tripId);
    expect(breakdown.totalDouble).toBe("0");
    expect(breakdown.totalSingle).toBe("0");
  });

  it("carga el itinerario con sus hoteles", async () => {
    actAs(coordinator);

    const stops = [
      { order: 1, city: "Londres", country: "Reino Unido", from: "2027-05-10", to: "2027-05-14", nights: 4, d: "95.00", s: "150.00" },
      { order: 2, city: "París", country: "Francia", from: "2027-05-14", to: "2027-05-19", nights: 5, d: "110.00", s: "175.00" },
      { order: 3, city: "Roma", country: "Italia", from: "2027-05-19", to: "2027-05-24", nights: 5, d: "100.00", s: "160.00" },
    ];

    for (const stop of stops) {
      const created = await upsertItineraryStop(tripId, {
        order: stop.order,
        city: stop.city,
        country: stop.country,
        fromDate: stop.from,
        toDate: stop.to,
        notes: null,
        accommodations: [],
      });

      await upsertAccommodation(tripId, created.id, {
        hotelName: `Hotel ${stop.city}`,
        nights: stop.nights,
        pricePerNightDouble: stop.d,
        pricePerNightSingle: stop.s,
        notes: null,
      });
    }

    const { breakdown } = await getTripBudget(tripId);
    // 4×95 + 5×110 + 5×100 = 1430
    expect(breakdown.directDouble).toBe("1430");
    // 4×150 + 5×175 + 5×160 = 2275
    expect(breakdown.directSingle).toBe("2275");
  });

  it("suma las comidas y eventos al costo directo", async () => {
    actAs(coordinator);

    for (const [concept, amount, type] of [
      ["Cena de bienvenida", "45.00", "COMIDA"],
      ["Entradas a museos", "38.00", "EVENTO"],
      ["Tren Londres — París", "85.00", "TRANSPORTE"],
      ["Tren París — Roma", "120.00", "TRANSPORTE"],
      ["Cena de despedida", "60.00", "COMIDA"],
    ] as const) {
      await upsertDirectCost(tripId, {
        concept,
        amountPerPassenger: amount,
        type,
      });
    }

    const { breakdown } = await getTripBudget(tripId);
    expect(breakdown.directDouble).toBe("1778"); // 1430 + 348
    expect(breakdown.directSingle).toBe("2623"); // 2275 + 348
  });

  it("prorratea los indirectos entre los presupuestados", async () => {
    actAs(coordinator);

    for (const [concept, amount, type] of [
      ["Charter aéreo", "18200.00", "CHARTER"],
      ["Traslados", "2100.00", "TRANSFER"],
      ["Alojamiento coordinadores", "3800.00", "HOSPEDAJE_COORDINADOR"],
    ] as const) {
      await upsertIndirectCost(tripId, {
        concept,
        totalAmount: amount,
        type,
      });
    }

    const { breakdown } = await getTripBudget(tripId);
    expect(breakdown.indirectTotal).toBe("24100");
    // 24100 / 14 = 1721.428571… → ROUND_UP → 1721.43
    expect(breakdown.indirectPerPassenger).toBe("1721.43");
    expect(breakdown.totalDouble).toBe("3499.43");
    expect(breakdown.totalSingle).toBe("4344.43");
    // 1721.43 × 14 − 24100 = 0.02
    expect(breakdown.roundingResidue).toBe("0.02");
  });

  it("los Decimal sobreviven al viaje de ida y vuelta a Postgres", async () => {
    // Si la escala se perdiera al persistir, estos números no darían.
    actAs(coordinator);
    const { breakdown } = await getTripBudget(tripId);
    expect(breakdown.indirectPerPassenger).toBe("1721.43");
    expect(Number(breakdown.totalDouble)).toBeCloseTo(3499.43, 2);
  });

  it("cambiar budgetedPassengers mueve el costo y queda auditado", async () => {
    actAs(coordinator);

    await updateTripGeneral(tripId, {
      name: `Londres, París y Roma ${SUFFIX}`,
      startDate: "2027-05-10",
      endDate: "2027-05-24",
      currency: "GBP",
      minPassengers: 10,
      maxPassengers: 14,
      budgetedPassengers: 10,
      coordinatorCount: 2,
      passportValidityMonths: 3,
      requireFullPassportValidity: false,
    });

    const { breakdown } = await getTripBudget(tripId);
    expect(breakdown.indirectPerPassenger).toBe("2410");
    // El directo no depende del divisor.
    expect(breakdown.directDouble).toBe("1778");

    const audit = await prisma.auditLog.findFirst({
      where: { entityId: tripId, field: "budgetedPassengers" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.oldValue).toBe("14");
    expect(audit?.newValue).toBe("10");

    // Se restaura para los tests siguientes.
    await updateTripGeneral(tripId, {
      name: `Londres, París y Roma ${SUFFIX}`,
      startDate: "2027-05-10",
      endDate: "2027-05-24",
      currency: "GBP",
      minPassengers: 10,
      maxPassengers: 14,
      budgetedPassengers: 14,
      coordinatorCount: 2,
      passportValidityMonths: 3,
      requireFullPassportValidity: false,
    });
  });
});

describe("precios y margen", () => {
  it("sin confirmados devuelve los dos escenarios", async () => {
    actAs(coordinator);
    await setTripPrices(tripId, {
      priceDouble: "3990.00",
      priceSingle: "4890.00",
    });

    const { margin } = await getTripBudget(tripId);
    expect(margin.perPassengerDouble?.margin).toBe("490.57");
    expect(margin.perPassengerSingle?.margin).toBe("545.57");

    expect(margin.totals).toHaveLength(2);
    expect(margin.totals.map((t) => t.basis.kind)).toEqual([
      "ESCENARIO",
      "ESCENARIO",
    ]);
  });

  it("todo cambio de precio queda auditado con el valor anterior", async () => {
    actAs(coordinator);
    await setTripPrices(tripId, {
      priceDouble: "4100.00",
      priceSingle: "4890.00",
    });

    const audit = await prisma.auditLog.findFirst({
      where: { entityId: tripId, field: "priceDouble" },
      orderBy: { createdAt: "desc" },
    });
    // Los montos se auditan en forma canónica: "4100.00" y "4100" son el
    // mismo número, y guardarlos distinto haría aparecer cambios inexistentes.
    expect(audit?.oldValue).toBe("3990");
    expect(audit?.newValue).toBe("4100");
    expect(audit?.actorUserId).toBe(coordinator.id);
  });

  it("no audita cuando el precio no cambió", async () => {
    actAs(coordinator);
    const before = await prisma.auditLog.count({ where: { entityId: tripId } });
    await setTripPrices(tripId, {
      priceDouble: "4100.00",
      priceSingle: "4890.00",
    });
    const after = await prisma.auditLog.count({ where: { entityId: tripId } });
    // Un log lleno de "cambió de 4100 a 4100" hace ilegible al que sí importa.
    expect(after).toBe(before);
  });

  it("el mix real de confirmados reemplaza a los escenarios", async () => {
    actAs(coordinator);

    // Dos pasajeros confirmados: uno en doble, otro en single.
    for (const [name, roomType] of [
      ["pax-doble", "DOBLE"],
      ["pax-single", "SINGLE"],
    ] as const) {
      const person = await prisma.person.create({
        data: { fullName: `${name} ${SUFFIX}` },
        select: { id: true },
      });
      await prisma.passenger.create({
        data: {
          tripId,
          personId: person.id,
          roomType,
          status: "CONFIRMADO",
        },
      });
    }

    const { margin } = await getTripBudget(tripId);
    expect(margin.totals).toHaveLength(1);
    expect(margin.totals[0]!.basis).toEqual({
      kind: "CONFIRMADOS",
      doubleCount: 1,
      singleCount: 1,
    });
    // 4100 + 4890 = 8990
    expect(margin.totals[0]!.revenue).toBe("8990");
  });

  it("el priceOverride de un pasajero pisa el precio de lista", async () => {
    actAs(coordinator);

    const passenger = await prisma.passenger.findFirstOrThrow({
      where: { tripId, roomType: "DOBLE", isCoordinator: false },
      select: { id: true },
    });

    await setPassengerPriceOverride(
      passenger.id,
      "4300.00",
      "Se quedó sin compañero de habitación",
    );

    const { margin } = await getTripBudget(tripId);
    // 4300 + 4890 = 9190
    expect(margin.totals[0]!.revenue).toBe("9190");

    const audit = await prisma.auditLog.findFirst({
      where: { entityId: passenger.id, field: "priceOverride" },
    });
    expect(audit?.newValue).toBe("4300");
  });
});

describe("estados del viaje", () => {
  it("permite BORRADOR → ABIERTO", async () => {
    actAs(coordinator);
    await updateTripStatus(tripId, "ABIERTO");
    const { trip } = await getTripBudget(tripId);
    expect(trip.status).toBe("ABIERTO");
  });

  it("rechaza un salto no permitido", async () => {
    actAs(coordinator);
    // ABIERTO no puede ir directo a FINALIZADO.
    await expect(updateTripStatus(tripId, "FINALIZADO")).rejects.toBeInstanceOf(
      TripStateError,
    );
  });

  it("el presupuesto sigue editable con el viaje ABIERTO", async () => {
    // En la práctica los precios del mayorista cambian con el viaje abierto.
    actAs(coordinator);
    await expect(
      upsertIndirectCost(tripId, {
        concept: `Extra ${SUFFIX}`,
        totalAmount: "100.00",
        type: "OTRO",
      }),
    ).resolves.toBeDefined();
  });

  it("un viaje FINALIZADO queda en solo lectura", async () => {
    actAs(coordinator);
    await updateTripStatus(tripId, "CERRADO");
    await updateTripStatus(tripId, "FINALIZADO");

    await expect(
      upsertIndirectCost(tripId, {
        concept: "No debería entrar",
        totalAmount: "1.00",
        type: "OTRO",
      }),
    ).rejects.toBeInstanceOf(TripStateError);

    await expect(
      setTripPrices(tripId, { priceDouble: "1.00", priceSingle: "1.00" }),
    ).rejects.toBeInstanceOf(TripStateError);
  });

  it("pero se sigue pudiendo consultar", async () => {
    actAs(coordinator);
    const { trip } = await getTripBudget(tripId);
    expect(trip.status).toBe("FINALIZADO");
  });
});

describe("no se puede operar sobre un viaje ajeno", () => {
  it("un usuario sin membresía no lee el presupuesto", async () => {
    actAs(outsider);
    await expect(getTripBudget(tripId)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("ni escribe costos", async () => {
    actAs(outsider);
    await expect(
      upsertIndirectCost(tripId, {
        concept: "Intruso",
        totalAmount: "1.00",
        type: "OTRO",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("una parada de otro viaje no se puede editar pasando su id", async () => {
    actAs(coordinator);
    // El `where` de los upsert incluye tripId justamente para esto.
    const otherTrip = await prisma.trip.findFirstOrThrow({
      where: { id: { not: tripId } },
      select: { id: true, stops: { select: { id: true }, take: 1 } },
    });

    const foreignStopId = otherTrip.stops[0]?.id;
    if (!foreignStopId) return;

    await expect(
      upsertAccommodation(tripId, foreignStopId, {
        hotelName: "Hotel colado",
        nights: 1,
        pricePerNightDouble: "1.00",
        pricePerNightSingle: "1.00",
        notes: null,
      }),
    ).rejects.toBeInstanceOf(Error);
  });
});

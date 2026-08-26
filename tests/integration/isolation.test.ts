import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actAs, actAsAnonymous } from "./setup";
import { prisma, disconnectDb } from "@/lib/db/prisma";
import { ForbiddenError, UnauthorizedError } from "@/lib/auth/errors";
import {
  getTripBudget,
  listTripsForViewer,
  setTripPrices,
  upsertIndirectCost,
  updateTripStatus,
} from "@/lib/services/trip";
import {
  getPassenger,
  getPassengerMix,
  listPassengers,
} from "@/lib/services/passengers";

/**
 * Aislamiento, verificado contra la base real.
 *
 * Escenario: dos viajes independientes.
 *
 *   Viaje A · coordinador Coty · pasajeros Ana y Beto
 *   Viaje B · coordinador Otto · pasajera Elsa
 *
 * Lo que se prueba es que Ana no llega a nada que no sea suyo: ni a los datos
 * de Beto (mismo viaje), ni a nada del viaje B, ni a los costos de ningún
 * viaje — ni siquiera pasando ids a mano, que es exactamente lo que haría
 * alguien probando URLs.
 *
 * Los datos se crean con un sufijo único y se borran al final. El viaje del
 * seed no se toca.
 */

const SUFFIX = randomUUID().slice(0, 8);
const email = (name: string) => `${name}-${SUFFIX}@test.invalid`;

interface Actor {
  id: string;
  email: string;
}

let tripA: string;
let tripB: string;
let coty: Actor;
let otto: Actor;
let ana: Actor;
let beto: Actor;
let elsa: Actor;
let admin: Actor;
let anaPassengerId: string;
let betoPassengerId: string;
let elsaPassengerId: string;

async function createActor(
  name: string,
  role: "ADMIN" | "USER" = "USER",
): Promise<Actor> {
  const person = await prisma.person.create({
    data: { fullName: `${name} ${SUFFIX}` },
    select: { id: true },
  });
  const user = await prisma.user.create({
    data: {
      id: randomUUID(),
      email: email(name),
      role,
      personId: person.id,
    },
    select: { id: true, email: true },
  });
  return user;
}

async function createTrip(name: string): Promise<string> {
  const trip = await prisma.trip.create({
    data: {
      name: `${name} ${SUFFIX}`,
      startDate: new Date("2027-05-10T00:00:00.000Z"),
      endDate: new Date("2027-05-24T00:00:00.000Z"),
      currency: "GBP",
      minPassengers: 10,
      maxPassengers: 14,
      budgetedPassengers: 14,
      status: "ABIERTO",
      priceDouble: "3990.00",
      priceSingle: "4890.00",
    },
    select: { id: true },
  });
  return trip.id;
}

async function join(
  tripId: string,
  actor: Actor,
  role: "COORDINADOR" | "PASAJERO",
): Promise<string> {
  await prisma.tripMember.create({
    data: { tripId, userId: actor.id, role },
  });

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: actor.id },
    select: { personId: true },
  });

  const passenger = await prisma.passenger.create({
    data: {
      tripId,
      personId: user.personId!,
      roomType: "DOBLE",
      status: "CONFIRMADO",
      isCoordinator: role === "COORDINADOR",
    },
    select: { id: true },
  });

  return passenger.id;
}

beforeAll(async () => {
  [coty, otto, ana, beto, elsa, admin] = await Promise.all([
    createActor("coty"),
    createActor("otto"),
    createActor("ana"),
    createActor("beto"),
    createActor("elsa"),
    createActor("admin", "ADMIN"),
  ]);

  tripA = await createTrip("Viaje A");
  tripB = await createTrip("Viaje B");

  await join(tripA, coty, "COORDINADOR");
  anaPassengerId = await join(tripA, ana, "PASAJERO");
  betoPassengerId = await join(tripA, beto, "PASAJERO");

  await join(tripB, otto, "COORDINADOR");
  elsaPassengerId = await join(tripB, elsa, "PASAJERO");

  await prisma.indirectCost.create({
    data: {
      tripId: tripA,
      concept: `Charter ${SUFFIX}`,
      totalAmount: "24100.00",
      type: "CHARTER",
    },
  });
}, 60_000);

afterAll(async () => {
  // Borrar los viajes arrastra en cascada pasajeros, membresías y costos.
  await prisma.trip.deleteMany({ where: { id: { in: [tripA, tripB] } } });
  await prisma.user.deleteMany({
    where: { email: { endsWith: `-${SUFFIX}@test.invalid` } },
  });
  await prisma.person.deleteMany({
    where: { fullName: { endsWith: SUFFIX } },
  });
  await prisma.auditLog.deleteMany({
    where: { entityId: { in: [tripA, tripB] } },
  });
  await disconnectDb();
}, 60_000);

// ---------------------------------------------------------------------------

describe("un PASAJERO no llega al listado de viajes", () => {
  it("listTripsForViewer no devuelve ningún viaje", async () => {
    // Es lo que alimenta /viajes. Un pasajero que escriba esa URL a mano ve
    // una lista vacía, no el viaje en el que está inscripto.
    actAs(ana);
    await expect(listTripsForViewer()).resolves.toEqual([]);
  });

  it("tampoco ve el viaje en el que viaja", async () => {
    actAs(ana);
    const trips = await listTripsForViewer();
    expect(trips.map((t) => t.id)).not.toContain(tripA);
  });

  it("el coordinador ve el suyo y solo el suyo", async () => {
    actAs(coty);
    const trips = await listTripsForViewer();
    expect(trips.map((t) => t.id)).toEqual([tripA]);
  });

  it("el ADMIN ve los dos", async () => {
    actAs(admin);
    const ids = (await listTripsForViewer()).map((t) => t.id);
    expect(ids).toContain(tripA);
    expect(ids).toContain(tripB);
  });
});

describe("un PASAJERO no llega a ningún dato de costos", () => {
  it("getTripBudget lo rechaza en su propio viaje", async () => {
    actAs(ana);
    await expect(getTripBudget(tripA)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("getTripBudget lo rechaza en un viaje ajeno", async () => {
    actAs(ana);
    await expect(getTripBudget(tripB)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("getPassengerMix lo rechaza (alimenta el margen)", async () => {
    actAs(ana);
    await expect(getPassengerMix(tripA)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("no puede escribir costos", async () => {
    actAs(ana);
    await expect(
      upsertIndirectCost(tripA, {
        concept: "Intento",
        totalAmount: "100.00",
        type: "OTRO",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("no puede fijar precios", async () => {
    actAs(ana);
    await expect(
      setTripPrices(tripA, { priceDouble: "1.00", priceSingle: "1.00" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("no puede cambiar el estado del viaje", async () => {
    actAs(ana);
    await expect(updateTripStatus(tripA, "CERRADO")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("el coordinador del viaje A no llega a los costos del viaje B", async () => {
    // Ser coordinador no es un permiso global: es por viaje.
    actAs(coty);
    await expect(getTripBudget(tripB)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("el coordinador sí llega a los costos de SU viaje", async () => {
    actAs(coty);
    const budget = await getTripBudget(tripA);
    expect(budget.breakdown.indirectTotal).toBe("24100");
    expect(budget.breakdown.indirectPerPassenger).toBe("1721.43");
  });
});

describe("un PASAJERO no llega a datos de otro pasajero", () => {
  it("listPassengers solo devuelve su propia fila", async () => {
    actAs(ana);
    const passengers = await listPassengers(tripA);
    expect(passengers).toHaveLength(1);
    expect(passengers[0]!.id).toBe(anaPassengerId);
  });

  it("getPassenger con el id de otro pasajero del mismo viaje falla", async () => {
    // El caso de la URL escrita a mano.
    actAs(ana);
    await expect(getPassenger(betoPassengerId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("getPassenger con el id de un pasajero de otro viaje falla", async () => {
    actAs(ana);
    await expect(getPassenger(elsaPassengerId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("sí puede ver sus propios datos", async () => {
    actAs(ana);
    const passenger = await getPassenger(anaPassengerId);
    expect(passenger?.id).toBe(anaPassengerId);
  });

  it("listPassengers en un viaje ajeno falla", async () => {
    actAs(ana);
    await expect(listPassengers(tripB)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("el coordinador ve a todos los de su viaje", async () => {
    actAs(coty);
    const passengers = await listPassengers(tripA);
    // Coty (coordinador), Ana y Beto.
    expect(passengers).toHaveLength(3);
    expect(passengers.map((p) => p.id)).toContain(betoPassengerId);
  });

  it("el coordinador del viaje A no ve a la pasajera del viaje B", async () => {
    actAs(coty);
    await expect(getPassenger(elsaPassengerId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe("sin sesión no se llega a nada", () => {
  it("el listado de viajes exige sesión", async () => {
    actAsAnonymous();
    await expect(listTripsForViewer()).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it("el presupuesto exige sesión", async () => {
    actAsAnonymous();
    await expect(getTripBudget(tripA)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it("los datos de un pasajero exigen sesión", async () => {
    actAsAnonymous();
    await expect(getPassenger(anaPassengerId)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });
});

describe("el margen no se filtra por una ruta lateral", () => {
  it("el coordinador ve el margen de su viaje", async () => {
    actAs(coty);
    const { margin } = await getTripBudget(tripA);
    expect(margin.perPassengerDouble).not.toBeNull();
  });

  it("y el mix declara siempre sobre qué está calculado", async () => {
    actAs(coty);
    const { margin } = await getTripBudget(tripA);
    for (const total of margin.totals) {
      expect(total.basis.kind).toMatch(/CONFIRMADOS|ESCENARIO/);
    }
  });
});

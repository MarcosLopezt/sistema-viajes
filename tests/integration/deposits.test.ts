import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { actAs } from "./setup";

/**
 * La seña, contra la base REAL.
 *
 * Lo que se verifica acá es lo único que las funciones puras no pueden
 * verificar: que la seña llegue al plan de pagos como PRIMERA CUOTA y no como
 * un pago suelto, y que la excepción a la inmutabilidad del plan sea
 * exactamente del tamaño que dice ser — ni más ni menos.
 *
 * ── Por qué la regla de regeneración se prueba en las DOS mitades ─────────
 *
 * La regla es sutil: "se puede regenerar si el único pago confirmado es la
 * seña". Una sola mitad no la fija. Probando solo que con seña se regenera,
 * un cambio que quite el chequeo entero pasa en verde y deja reescribir
 * cuotas debajo de plata que entró contra una cuota. Probando solo que con un
 * pago declarado NO se regenera, un cambio que endurezca la regla de vuelta
 * pasa en verde y deja el sistema donde ningún plan con seña se puede
 * regenerar nunca. Hacen falta las dos.
 */

const storageState = {
  objects: new Map<string, { mimetype: string; size: number }>(),
  signed: [] as string[],
};

vi.mock("@/lib/supabase/admin", () => ({
  storageBucket: () => "documentos",
  createSupabaseAdminClient: () => ({
    storage: {
      from: () => ({
        createSignedUploadUrl: async (path: string) => {
          storageState.objects.set(path, {
            mimetype: "application/pdf",
            size: 1024,
          });
          return { data: { path, token: "token-de-prueba" }, error: null };
        },
        list: async (directory: string, options?: { search?: string }) => {
          const path = `${directory}/${options?.search ?? ""}`;
          const object = storageState.objects.get(path);
          return {
            data: object ? [{ name: options?.search, metadata: object }] : [],
            error: null,
          };
        },
        createSignedUrl: async (path: string) => {
          storageState.signed.push(path);
          return {
            data: { signedUrl: `https://bucket.test/${path}?token=x` },
            error: null,
          };
        },
        remove: async () => ({ data: null, error: null }),
      }),
    },
  }),
}));

const { prisma, disconnectDb } = await import("@/lib/db/prisma");
const {
  confirmPayment,
  declarePayment,
  generatePaymentPlan,
  getPaymentPlan,
  previewPaymentPlan,
  PaymentError,
} = await import("@/lib/services/payments");
const { createSignedUpload } = await import("@/lib/services/storage");

const SUFFIX = randomUUID().slice(0, 8);
const email = (name: string) => `${name}-sena-${SUFFIX}@test.invalid`;

interface Actor {
  id: string;
  email: string;
  personId: string;
}

let tripId: string;
let coty: Actor;
/** Pagó la seña antes de convertirse. */
let sena: Actor;
let senaPassengerId: string;
let senaInterestId: string;
/** Entró por invitación, sin seña. El control de comparación. */
let sinSena: Actor;
let sinSenaPassengerId: string;

const PRECIO = "3499.43";
const SENA = "500.00";
const FECHA_SENA = "2027-01-15";

const TERMS =
  "La seña no es reembolsable, salvo que el viaje se cancele por decisión de las coordinadoras.";

async function createActor(name: string): Promise<Actor> {
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

async function join(
  actor: Actor,
  role: "COORDINADOR" | "PASAJERO",
): Promise<string> {
  await prisma.tripMember.create({ data: { tripId, userId: actor.id, role } });

  const passenger = await prisma.passenger.create({
    data: {
      tripId,
      personId: actor.personId,
      roomType: "DOBLE",
      status: "CONFIRMADO",
      isCoordinator: role === "COORDINADOR",
    },
    select: { id: true },
  });

  return passenger.id;
}

/**
 * Deja a `sena` en el estado en que la dejaría la conversión: con la seña
 * CONFIRMADA y sellada contra su Passenger.
 *
 * Se escribe con Prisma y no llamando al servicio de conversión a propósito:
 * lo que este archivo prueba es qué hace el GENERADOR DE PLANES con una seña
 * ya confirmada. Ejercitar la conversión acá mezclaría dos cosas que fallan
 * por razones distintas.
 */
async function seedDeposit(): Promise<string> {
  const deposit = await prisma.depositProof.create({
    data: {
      interestId: senaInterestId,
      passengerId: senaPassengerId,
      amount: SENA,
      currency: "GBP",
      amountInTripCurrency: SENA,
      transferDate: new Date(`${FECHA_SENA}T00:00:00.000Z`),
      proofFileId: `${tripId}/${sena.personId}/comprobante-pago-sena-${SUFFIX}.pdf`,
      acceptedTermsText: TERMS,
      acceptedTermsLang: "ES",
      acceptedAt: new Date(),
      shownAmount: SENA,
      shownCurrency: "GBP",
      status: "CONFIRMADO",
    },
    select: { id: true },
  });
  return deposit.id;
}

/** Genera el plan con las fechas que sugiere el preview, sin editarlas. */
async function makePlan(passengerId: string, count: number) {
  const preview = await previewPaymentPlan(passengerId, count);
  return generatePaymentPlan(passengerId, {
    installmentCount: count,
    installments: preview.installments.map((cuota) => ({
      number: cuota.number,
      dueDate: cuota.dueDate,
      amount: cuota.amount,
    })),
    replaceExisting: true,
  });
}

async function declare(
  passengerId: string,
  installmentId: string,
  amount: string,
) {
  const upload = await createSignedUpload(
    passengerId,
    "comprobante-pago",
    "application/pdf",
    1024,
  );
  return declarePayment(passengerId, {
    installmentId,
    amount,
    currency: "GBP",
    transferDate: "2027-02-20",
    proofFileId: upload.path,
  });
}

beforeAll(async () => {
  coty = await createActor("coty");
  sena = await createActor("sena");
  sinSena = await createActor("sinsena");

  const trip = await prisma.trip.create({
    data: {
      name: `Seña ${SUFFIX}`,
      startDate: new Date("2027-07-10T00:00:00.000Z"),
      endDate: new Date("2027-07-24T00:00:00.000Z"),
      currency: "GBP",
      minPassengers: 10,
      maxPassengers: 14,
      budgetedPassengers: 14,
      status: "ABIERTO",
      priceDouble: PRECIO,
      priceSingle: "4890.00",
      depositAmount: SENA,
      installmentIntervalMonths: 3,
      defaultInstallmentCount: 3,
    },
    select: { id: true },
  });
  tripId = trip.id;

  await join(coty, "COORDINADOR");
  senaPassengerId = await join(sena, "PASAJERO");
  sinSenaPassengerId = await join(sinSena, "PASAJERO");

  const interest = await prisma.interest.create({
    data: { userId: sena.id, tripId, status: "CONVERTIDA" },
    select: { id: true },
  });
  senaInterestId = interest.id;

  // Cotización del día en la base: sin esto, getFxSnapshot saldría a internet.
  const today = new Date();
  await prisma.fxRate.upsert({
    where: {
      date_base: {
        date: new Date(
          Date.UTC(
            today.getUTCFullYear(),
            today.getUTCMonth(),
            today.getUTCDate(),
          ),
        ),
        base: "USD",
      },
    },
    update: {},
    create: {
      date: new Date(
        Date.UTC(
          today.getUTCFullYear(),
          today.getUTCMonth(),
          today.getUTCDate(),
        ),
      ),
      base: "USD",
      rates: { EUR: "0.9", GBP: "0.8" },
      fetchedAt: new Date(),
    },
  });

  await seedDeposit();
}, 120_000);

afterAll(async () => {
  await prisma.trip.delete({ where: { id: tripId } }).catch(() => {});
  await prisma.user
    .deleteMany({
      where: { id: { in: [coty.id, sena.id, sinSena.id] } },
    })
    .catch(() => {});
  await prisma.person
    .deleteMany({
      where: {
        id: { in: [coty.personId, sena.personId, sinSena.personId] },
      },
    })
    .catch(() => {});
  await disconnectDb();
});

// ---------------------------------------------------------------------------

describe("el plan con seña la imputa como primera cuota", () => {
  it("la cuota 1 vale la seña y las otras reparten el resto", async () => {
    actAs(coty);
    await makePlan(senaPassengerId, 3);

    const plan = await getPaymentPlan(senaPassengerId);

    expect(plan!.installments.map((i) => i.amount)).toEqual([
      "500.00",
      "1499.72",
      "1499.71",
    ]);
    // El total NO creció: la seña ocupa el primer tramo, no se le suma.
    expect(plan!.totalAmount).toBe(PRECIO);
  });

  it("la cuota 1 nace PAGADA y el saldo descuenta la seña UNA vez", async () => {
    actAs(coty);
    await makePlan(senaPassengerId, 3);

    const plan = await getPaymentPlan(senaPassengerId);

    expect(plan!.installments[0]!.state).toBe("PAGADA");
    expect(plan!.paidTotal).toBe("500.00");
    // 3499.43 − 500.00. Si se contara dos veces daría 2999.43 − 500 = 2499.43,
    // y si no se contara daría 3499.43.
    expect(plan!.balance).toBe("2999.43");
  });

  it("la seña NO queda como crédito: está imputada, no suelta", async () => {
    // Es la diferencia entre "imputada" y "pago suelto". derivePlan() trata lo
    // no imputado como CRÉDITO y a propósito no lo descuenta de ninguna cuota:
    // si la seña cayera ahí, la pasajera vería el saldo entero y un crédito al
    // costado que nadie le aplicó.
    actAs(coty);
    await makePlan(senaPassengerId, 3);

    const plan = await getPaymentPlan(senaPassengerId);

    expect(plan!.credit).toBe("0.00");
    expect(plan!.installments[0]!.paid).toBe("500.00");
  });

  it("los vencimientos salen del día de la seña, a intervalo fijo", async () => {
    actAs(coty);
    const preview = await previewPaymentPlan(senaPassengerId, 3);

    expect(preview.installments.map((i) => i.dueDate)).toEqual([
      "2027-01-15",
      "2027-04-15",
      "2027-07-15",
    ]);
    // La tercera cae con el grupo ya viajando (sale el 10/07). Se advierte, no
    // se corrige: mover la fecha es decisión de la coordinadora.
    expect(preview.lateInstallments).toEqual([3]);
  });

  it("hay UN solo Payment por la seña, y apunta a la cuota 1", async () => {
    actAs(coty);
    await makePlan(senaPassengerId, 3);

    const deposit = await prisma.depositProof.findUniqueOrThrow({
      where: { passengerId: senaPassengerId },
      select: { paymentId: true },
    });

    const payments = await prisma.payment.findMany({
      where: { plan: { passengerId: senaPassengerId }, status: "CONFIRMADO" },
      select: { id: true, installment: { select: { number: true } } },
    });

    expect(payments).toHaveLength(1);
    expect(payments[0]!.id).toBe(deposit.paymentId);
    expect(payments[0]!.installment!.number).toBe(1);
  });
});

describe("sin seña, el generador se comporta exactamente como antes", () => {
  it("reparte el total parejo, sin primera cuota fija", async () => {
    actAs(coty);
    await makePlan(sinSenaPassengerId, 3);

    const plan = await getPaymentPlan(sinSenaPassengerId);

    // El mismo precio en 3 sin seña: 1166,476… con la última absorbiendo.
    expect(plan!.installments.map((i) => i.amount)).toEqual([
      "1166.48",
      "1166.48",
      "1166.47",
    ]);
    expect(plan!.paidTotal).toBe("0.00");
    expect(plan!.balance).toBe(PRECIO);
  });

  it("no inventa un Payment: sin seña no hay nada que materializar", async () => {
    actAs(coty);
    await makePlan(sinSenaPassengerId, 3);

    const payments = await prisma.payment.count({
      where: { plan: { passengerId: sinSenaPassengerId } },
    });

    expect(payments).toBe(0);
  });

  it("los vencimientos se reparten hasta la salida, no a intervalo fijo", async () => {
    actAs(coty);
    const preview = await previewPaymentPlan(sinSenaPassengerId, 3);

    // La última apunta a una semana antes de salir, y ninguna se pasa.
    expect(preview.installments.at(-1)!.dueDate).toBe("2027-07-03");
    expect(preview.lateInstallments).toEqual([]);
  });
});

describe("regenerar un plan con seña · las dos mitades de la regla", () => {
  it("CON la seña sola, se regenera", async () => {
    actAs(coty);
    await makePlan(senaPassengerId, 3);

    // El plan nace con un pago confirmado —la seña— y aun así se puede
    // rehacer: ese Payment es la proyección del DepositProof, no un hecho
    // independiente.
    await expect(makePlan(senaPassengerId, 4)).resolves.toMatchObject({
      replaced: true,
    });

    const plan = await getPaymentPlan(senaPassengerId);
    expect(plan!.installments).toHaveLength(4);
    // Y la seña volvió a quedar imputada a la cuota 1 del plan nuevo.
    expect(plan!.installments[0]!.amount).toBe("500.00");
    expect(plan!.installments[0]!.state).toBe("PAGADA");
    expect(plan!.paidTotal).toBe("500.00");
  });

  it("la reimputación no duplica el Payment de la seña", async () => {
    actAs(coty);
    await makePlan(senaPassengerId, 3);
    await makePlan(senaPassengerId, 4);
    await makePlan(senaPassengerId, 5);

    const payments = await prisma.payment.count({
      where: { plan: { passengerId: senaPassengerId } },
    });

    // Tres generaciones, un solo pago. Lo garantiza que paymentId sea ÚNICO,
    // no un chequeo en código.
    expect(payments).toBe(1);

    const plan = await getPaymentPlan(senaPassengerId);
    expect(plan!.paidTotal).toBe("500.00");
  });

  it("CON seña + un pago declarado, NO se regenera", async () => {
    actAs(coty);
    await makePlan(senaPassengerId, 3);

    const plan = await getPaymentPlan(senaPassengerId);
    const segunda = plan!.installments[1]!;

    actAs(sena);
    const { paymentId } = await declare(senaPassengerId, segunda.id, "100.00");

    actAs(coty);
    await confirmPayment({
      paymentId,
      fxRateUsed: null,
      fxRateSource: "SUGERIDO",
      notes: null,
    });

    // Esta es la otra mitad. La excepción vale SOLO para la seña: en cuanto
    // entra plata declarada contra una cuota, la inmutabilidad vuelve a
    // aplicar como siempre.
    await expect(makePlan(senaPassengerId, 4)).rejects.toMatchObject({
      reason: "PLAN_INMUTABLE",
    });
    await expect(makePlan(senaPassengerId, 4)).rejects.toBeInstanceOf(
      PaymentError,
    );
  });
});

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { actAs, actAsAnonymous } from "./setup";

/**
 * Pagos, verificados contra la base REAL.
 *
 * Escenario: un viaje con dos pasajeras (Ana y Beto), su coordinadora (Coty) y
 * un viaje ajeno con Elsa. Lo que se prueba acá es lo que NO se puede probar
 * con funciones puras:
 *
 *   - que confirmar dos veces en paralelo impute una sola vez;
 *   - que un plan con pagos confirmados sea inmutable;
 *   - que el TC quede congelado y no se recalcule al leer;
 *   - que un pasajero no llegue a los pagos ni a los comprobantes de otro,
 *     por servicio Y por HTTP.
 *
 * ── Qué está mockeado y qué no ────────────────────────────────────────────
 *
 * Solo el cliente de Supabase: la sesión (en setup.ts) y el bucket (acá
 * abajo). El bucket es un servicio de terceros; la autorización sobre los
 * archivos NO vive ahí sino en `storage.ts`, que corre de verdad —incluido el
 * chequeo de que la path caiga dentro de la carpeta del pasajero—. Los guards,
 * la política, los servicios y las consultas corren todos contra la base.
 */

const storageState = {
  /** Objetos "subidos": path → metadata que devolvería el bucket. */
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
            data: object
              ? [{ name: options?.search, metadata: object }]
              : [],
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
const { ForbiddenError, UnauthorizedError } = await import("@/lib/auth/errors");
const {
  confirmPayment,
  declarePayment,
  generatePaymentPlan,
  getPaymentPlan,
  getTripPaymentsOverview,
  listPendingReviews,
  previewPaymentPlan,
  registerRefund,
  rejectPayment,
  revertPayment,
  PaymentError,
} = await import("@/lib/services/payments");
const { createSignedUpload } = await import("@/lib/services/storage");
const { cancelPassenger } = await import("@/lib/services/passengers");
const { GET: proofRoute } = await import(
  "@/app/api/comprobantes/[paymentId]/route"
);

const SUFFIX = randomUUID().slice(0, 8);
const email = (name: string) => `${name}-pagos-${SUFFIX}@test.invalid`;

interface Actor {
  id: string;
  email: string;
  /** El segundo segmento de sus paths en el bucket. Ver domain/storage-paths.ts. */
  personId: string;
}

let tripA: string;
let tripB: string;
let coty: Actor;
let otto: Actor;
let ana: Actor;
let beto: Actor;
let elsa: Actor;
let anaId: string;
let betoId: string;
let elsaId: string;
let cotyPassengerId: string;

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

async function createTrip(name: string, currency: "GBP" | "EUR" = "GBP") {
  const trip = await prisma.trip.create({
    data: {
      name: `${name} ${SUFFIX}`,
      // Bien a futuro: las fechas sugeridas del plan tienen que entrar.
      startDate: new Date("2028-05-10T00:00:00.000Z"),
      endDate: new Date("2028-05-24T00:00:00.000Z"),
      currency,
      minPassengers: 10,
      maxPassengers: 14,
      budgetedPassengers: 14,
      status: "ABIERTO",
      priceDouble: "3499.43",
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
  await prisma.tripMember.create({ data: { tripId, userId: actor.id, role } });

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

/** Cotización de hoy en la base: sin esto, getFxSnapshot saldría a internet. */
async function seedTodayFxRate(): Promise<void> {
  const today = new Date();
  const date = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );

  await prisma.fxRate.upsert({
    where: { date_base: { date, base: "USD" } },
    update: { rates: { EUR: "0.9", GBP: "0.8" }, fetchedAt: new Date() },
    create: {
      date,
      base: "USD",
      rates: { EUR: "0.9", GBP: "0.8" },
      fetchedAt: new Date(),
    },
  });
}

/** Genera un plan de N cuotas con las fechas sugeridas, sin editarlas. */
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

/** Sube un comprobante y declara un pago, como lo haría el pasajero. */
async function declare(
  passengerId: string,
  installmentId: string,
  amount: string,
  currency: "GBP" | "USD" | "EUR" = "GBP",
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
    currency,
    transferDate: "2026-08-20",
    proofFileId: upload.path,
  });
}

beforeAll(async () => {
  await seedTodayFxRate();

  [coty, otto, ana, beto, elsa] = await Promise.all([
    createActor("coty"),
    createActor("otto"),
    createActor("ana"),
    createActor("beto"),
    createActor("elsa"),
  ]);

  tripA = await createTrip("Pagos A");
  tripB = await createTrip("Pagos B");

  cotyPassengerId = await join(tripA, coty, "COORDINADOR");
  anaId = await join(tripA, ana, "PASAJERO");
  betoId = await join(tripA, beto, "PASAJERO");

  await join(tripB, otto, "COORDINADOR");
  elsaId = await join(tripB, elsa, "PASAJERO");
}, 60_000);

afterAll(async () => {
  await prisma.trip.deleteMany({ where: { name: { contains: SUFFIX } } });
  await prisma.user.deleteMany({ where: { email: { contains: SUFFIX } } });
  await prisma.person.deleteMany({ where: { fullName: { contains: SUFFIX } } });
  await disconnectDb();
});

beforeEach(() => {
  storageState.signed.length = 0;
});

// ------------------------- Generación del plan -----------------------------

describe("generación del plan", () => {
  it("congela el precio y reparte al centavo", async () => {
    actAs(coty);
    await makePlan(anaId, 3);

    const plan = await getPaymentPlan(anaId);
    expect(plan).not.toBeNull();
    expect(plan!.totalAmount).toBe("3499.43");
    expect(plan!.installments.map((i) => i.amount)).toEqual([
      "1166.48",
      "1166.48",
      "1166.47",
    ]);

    // La suma cierra exacto contra el total guardado, en la base y no solo en
    // el motor.
    const total = plan!.installments.reduce(
      (acc, cuota) => acc + Number(cuota.amount),
      0,
    );
    expect(total.toFixed(2)).toBe("3499.43");
  });

  it("sin roomType, no genera el plan y no le cobra el precio de doble", async () => {
    // `join()` siempre crea con roomType "DOBLE"; se lo saca para reproducir
    // a alguien que todavía no lo eligió — el estado real de una pasajera
    // recién convertida por /interes, antes de pasar por su formulario.
    const sinElegir = await createActor("sinelegir");
    const sinElegirId = await join(tripA, sinElegir, "PASAJERO");
    await prisma.passenger.update({
      where: { id: sinElegirId },
      data: { roomType: null },
    });

    actAs(coty);

    // Rechazo explícito con SU propio motivo — nunca el ternario
    // `roomType === "SINGLE" ? ... : priceDouble` que le cobraría el precio
    // de DOBLE en silencio a alguien que no eligió nada.
    await expect(makePlan(sinElegirId, 3)).rejects.toMatchObject({
      reason: "SIN_ROOM_TYPE",
    });

    // Y no quedó ningún plan a medio generar con ese precio.
    expect(await getPaymentPlan(sinElegirId)).toBeNull();
  });

  it("cambiar el precio del viaje NO reescribe un plan ya generado", async () => {
    actAs(coty);
    await makePlan(betoId, 2);

    await prisma.trip.update({
      where: { id: tripA },
      data: { priceDouble: "9999.00" },
    });

    const plan = await getPaymentPlan(betoId);
    expect(plan!.totalAmount).toBe("3499.43");

    await prisma.trip.update({
      where: { id: tripA },
      data: { priceDouble: "3499.43" },
    });
  });

  it("un coordinador no genera plan de pagos", async () => {
    actAs(coty);
    await expect(makePlan(cotyPassengerId, 3)).rejects.toMatchObject({
      reason: "COORDINADOR",
    });
  });

  it("un pasajero no puede generarse un plan a sí mismo", async () => {
    actAs(ana);
    await expect(makePlan(anaId, 3)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("el coordinador del viaje A no genera planes en el viaje B", async () => {
    actAs(coty);
    await expect(makePlan(elsaId, 3)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

// -------------------------- Inmutabilidad del plan -------------------------

describe("el plan es inmutable si tiene un pago confirmado", () => {
  it("con un pago confirmado, regenerar falla", async () => {
    actAs(coty);
    await makePlan(anaId, 3);
    const plan = await getPaymentPlan(anaId);
    const cuota1 = plan!.installments[0]!;

    actAs(ana);
    const { paymentId } = await declare(anaId, cuota1.id, cuota1.amount);

    actAs(coty);
    await confirmPayment({ paymentId, fxRateUsed: null, fxRateSource: "SUGERIDO", notes: null });

    await expect(makePlan(anaId, 4)).rejects.toMatchObject({
      reason: "PLAN_INMUTABLE",
    });

    // Y el plan sigue exactamente como estaba.
    const after = await getPaymentPlan(anaId);
    expect(after!.installments).toHaveLength(3);
  });

  it("con un comprobante en revisión, tampoco: quedaría colgado de la nada", async () => {
    actAs(coty);
    const fresh = await join(tripA, await createActor("nina"), "PASAJERO");
    await makePlan(fresh, 2);

    const plan = await getPaymentPlan(fresh);
    actAs(coty);
    await declare(fresh, plan!.installments[0]!.id, "100.00");

    await expect(makePlan(fresh, 3)).rejects.toMatchObject({
      reason: "REVISION_PENDIENTE",
    });
  });

  it("sin pagos, regenerar exige confirmación explícita", async () => {
    const fresh = await join(tripA, await createActor("olga"), "PASAJERO");

    actAs(coty);
    await makePlan(fresh, 2);

    const preview = await previewPaymentPlan(fresh, 4);
    // Sin `replaceExisting` el servicio se niega y dice cuántas cuotas están
    // en juego, para que la pantalla lo pueda preguntar.
    await expect(
      generatePaymentPlan(fresh, {
        installmentCount: 4,
        installments: preview.installments.map((c) => ({
          number: c.number,
          dueDate: c.dueDate,
          amount: c.amount,
        })),
        replaceExisting: false,
      }),
    ).rejects.toMatchObject({ reason: "PLAN_EXISTENTE", installmentsAtRisk: 2 });

    // Con la confirmación, sí.
    const replaced = await makePlan(fresh, 4);
    expect(replaced.replaced).toBe(true);
    const plan = await getPaymentPlan(fresh);
    expect(plan!.installments).toHaveLength(4);
  });
});

// ------------------------- Confirmación concurrente ------------------------

describe("idempotencia de la confirmación", () => {
  it("confirmar dos veces en paralelo imputa UNA sola vez", async () => {
    const passengerId = await join(
      tripA,
      await createActor("pili"),
      "PASAJERO",
    );

    actAs(coty);
    await makePlan(passengerId, 1);
    const plan = await getPaymentPlan(passengerId);
    const cuota = plan!.installments[0]!;

    const { paymentId } = await declare(passengerId, cuota.id, cuota.amount);

    // Doble click, o dos coordinadores a la vez. El UPDATE condicionado hace
    // que la segunda no encuentre fila.
    const [a, b] = await Promise.all([
      confirmPayment({ paymentId, fxRateUsed: null, fxRateSource: "SUGERIDO", notes: null }),
      confirmPayment({ paymentId, fxRateUsed: null, fxRateSource: "SUGERIDO", notes: null }),
    ]);

    expect([a, b].filter((r) => r === "APLICADO")).toHaveLength(1);
    expect([a, b].filter((r) => r === "YA_RESUELTO")).toHaveLength(1);

    // Un solo Payment, un solo importe imputado.
    const payments = await prisma.payment.findMany({
      where: { plan: { passengerId }, status: "CONFIRMADO" },
    });
    expect(payments).toHaveLength(1);

    const after = await getPaymentPlan(passengerId);
    expect(after!.paidTotal).toBe(cuota.amount);
    expect(after!.installments[0]!.state).toBe("PAGADA");
    expect(after!.credit).toBe("0.00");

    // Y una sola entrada de auditoría del cambio de estado.
    const logs = await prisma.auditLog.findMany({
      where: { entity: "Payment", entityId: paymentId, field: "status" },
    });
    expect(logs).toHaveLength(1);
  });

  it("confirmar un pago ya rechazado no lo desrechaza", async () => {
    const passengerId = await join(
      tripA,
      await createActor("rita"),
      "PASAJERO",
    );

    actAs(coty);
    await makePlan(passengerId, 1);
    const plan = await getPaymentPlan(passengerId);
    const { paymentId } = await declare(
      passengerId,
      plan!.installments[0]!.id,
      "100.00",
    );

    await rejectPayment({ paymentId, reason: "El comprobante está ilegible." });

    const outcome = await confirmPayment({
      paymentId,
      fxRateUsed: null,
      fxRateSource: "SUGERIDO",
      notes: null,
    });
    expect(outcome).toBe("YA_RESUELTO");

    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
      select: { status: true, notes: true },
    });
    expect(payment.status).toBe("RECHAZADO");
    expect(payment.notes).toBe("El comprobante está ilegible.");
  });
});

// ----------------------------- Tipo de cambio ------------------------------

describe("el tipo de cambio se congela", () => {
  it("el coordinador carga el TC real y NO se recalcula al leer", async () => {
    const passengerId = await join(
      tripA,
      await createActor("sara"),
      "PASAJERO",
    );

    actAs(coty);
    await makePlan(passengerId, 1);
    const plan = await getPaymentPlan(passengerId);

    // Paga en euros un plan en libras.
    const { paymentId } = await declare(
      passengerId,
      plan!.installments[0]!.id,
      "1000.00",
      "EUR",
    );

    // TC del extracto: distinto de la cotización del día (0.8/0.9 = 0.888…).
    // El coordinador lo tipeó mirando el extracto: eso se registra.
    await confirmPayment({
      paymentId,
      fxRateUsed: "0.86373391",
      fxRateSource: "INGRESADO",
      notes: null,
    });

    const confirmed = await prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
      select: { fxRateUsed: true, amountInTripCurrency: true },
    });
    expect(confirmed.fxRateUsed!.toString()).toBe("0.86373391");
    expect(confirmed.amountInTripCurrency.toString()).toBe("863.73");

    // Se mueve la cotización del día. Lo imputado no se toca.
    const today = new Date();
    const date = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
    );
    await prisma.fxRate.update({
      where: { date_base: { date, base: "USD" } },
      data: { rates: { EUR: "0.5", GBP: "2.0" } },
    });

    const after = await getPaymentPlan(passengerId);
    expect(after!.paidTotal).toBe("863.73");

    await prisma.fxRate.update({
      where: { date_base: { date, base: "USD" } },
      data: { rates: { EUR: "0.9", GBP: "0.8" } },
    });
  });

  it("sin TC, un pago en otra moneda no se confirma", async () => {
    const passengerId = await join(
      tripA,
      await createActor("tere"),
      "PASAJERO",
    );

    actAs(coty);
    await makePlan(passengerId, 1);
    const plan = await getPaymentPlan(passengerId);
    const { paymentId } = await declare(
      passengerId,
      plan!.installments[0]!.id,
      "1000.00",
      "USD",
    );

    await expect(
      confirmPayment({
        paymentId,
        fxRateUsed: null,
        fxRateSource: "SUGERIDO",
        notes: null,
      }),
    ).rejects.toMatchObject({ reason: "TC_FALTANTE" });
  });

  it("la cola de revisión trae la cotización del día como sugerencia", async () => {
    const passengerId = await join(
      tripA,
      await createActor("ursu"),
      "PASAJERO",
    );

    actAs(coty);
    await makePlan(passengerId, 3);
    const plan = await getPaymentPlan(passengerId);

    // Tres pagos pendientes, uno por moneda, para mirar los tres cruces.
    const declared = await Promise.all(
      (["GBP", "USD", "EUR"] as const).map((currency, index) =>
        declare(passengerId, plan!.installments[index]!.id, "100.00", currency),
      ),
    );
    const ids = new Set(declared.map((d) => d.paymentId));

    const queue = (await listPendingReviews(tripA)).filter((item) =>
      ids.has(item.paymentId),
    );

    // El cruce se DERIVA de las dos tasas contra el dólar; no se guarda
    // precalculado. Con 0.8 GBP/USD y 0.9 EUR/USD:
    //   USD → GBP = 0.8
    //   EUR → GBP = 0.8 / 0.9 = 0.888…
    expect(queue.find((i) => i.currency === "USD")?.suggestedFxRate).toBe(
      "0.80000000",
    );
    expect(queue.find((i) => i.currency === "EUR")?.suggestedFxRate).toBe(
      "0.88888889",
    );
    // En la moneda del viaje no hay TC que sugerir.
    expect(queue.find((i) => i.currency === "GBP")?.suggestedFxRate).toBeNull();
  });
});

// -------------------------- Reversión y reembolso --------------------------

describe("deshacer una confirmación", () => {
  it("vuelve a la cola, exige motivo y queda auditado", async () => {
    const passengerId = await join(
      tripA,
      await createActor("vera"),
      "PASAJERO",
    );

    actAs(coty);
    await makePlan(passengerId, 1);
    const plan = await getPaymentPlan(passengerId);
    const cuota = plan!.installments[0]!;
    const { paymentId } = await declare(passengerId, cuota.id, cuota.amount);

    await confirmPayment({ paymentId, fxRateUsed: null, fxRateSource: "SUGERIDO", notes: null });
    expect((await getPaymentPlan(passengerId))!.paidTotal).toBe(cuota.amount);

    const outcome = await revertPayment({
      paymentId,
      reason: "Confirmé el comprobante equivocado.",
    });
    expect(outcome).toBe("APLICADO");

    const after = await getPaymentPlan(passengerId);
    expect(after!.paidTotal).toBe("0.00");
    expect(after!.installments[0]!.state).not.toBe("PAGADA");
    expect(after!.installments[0]!.hasPendingProof).toBe(true);

    const logs = await prisma.auditLog.findMany({
      where: { entity: "Payment", entityId: paymentId },
      select: { field: true, oldValue: true, newValue: true },
    });
    expect(logs).toContainEqual({
      field: "motivoReversion",
      oldValue: null,
      newValue: "Confirmé el comprobante equivocado.",
    });

    // Deshacer dos veces tampoco duplica nada.
    expect(
      await revertPayment({ paymentId, reason: "Otra vez, por las dudas." }),
    ).toBe("YA_RESUELTO");
  });

  it("un pasajero no puede deshacer la confirmación de su propio pago", async () => {
    const passengerId = await join(
      tripA,
      await createActor("wanda"),
      "PASAJERO",
    );

    actAs(coty);
    await makePlan(passengerId, 1);
    const plan = await getPaymentPlan(passengerId);
    const { paymentId } = await declare(
      passengerId,
      plan!.installments[0]!.id,
      "100.00",
    );
    await confirmPayment({ paymentId, fxRateUsed: null, fxRateSource: "SUGERIDO", notes: null });

    actAs(ana);
    await expect(
      revertPayment({ paymentId, reason: "Quiero deshacerlo yo." }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("reembolso", () => {
  it("no altera el estado de ninguna cuota", async () => {
    const passengerId = await join(
      tripA,
      await createActor("yani"),
      "PASAJERO",
    );

    actAs(coty);
    await makePlan(passengerId, 2);
    const plan = await getPaymentPlan(passengerId);
    const cuota = plan!.installments[0]!;
    const { paymentId } = await declare(passengerId, cuota.id, cuota.amount);
    await confirmPayment({ paymentId, fxRateUsed: null, fxRateSource: "SUGERIDO", notes: null });

    const before = await getPaymentPlan(passengerId);

    await registerRefund(passengerId, {
      amount: "500.00",
      transferDate: "2026-08-25",
      reason: "Devolución parcial acordada.",
    });

    const after = await getPaymentPlan(passengerId);
    expect(after!.installments.map((i) => i.state)).toEqual(
      before!.installments.map((i) => i.state),
    );
    expect(after!.paidTotal).toBe(before!.paidTotal);
    expect(after!.refundedTotal).toBe("500.00");
  });
});

// --------------------------- Pasajero cancelado ----------------------------

describe("pasajero cancelado", () => {
  it("su plan se congela: ni vencidas ni cuotas nuevas", async () => {
    const passengerId = await join(
      tripA,
      await createActor("zoe"),
      "PASAJERO",
    );

    actAs(coty);
    await makePlan(passengerId, 2);

    // Se le corren los vencimientos al pasado para que, sin congelar, quedaría
    // en rojo.
    await prisma.installment.updateMany({
      where: { plan: { passengerId } },
      data: { dueDate: new Date("2026-01-15T00:00:00.000Z") },
    });

    const beforeCancel = await getPaymentPlan(passengerId);
    expect(beforeCancel!.light).toBe("ROJO");

    await cancelPassenger(passengerId);

    const plan = await getPaymentPlan(passengerId);
    expect(plan!.frozen).toBe(true);
    expect(plan!.overdueCount).toBe(0);
    expect(plan!.light).toBe("NEUTRO");
    expect(plan!.installments.every((i) => i.state === "CONGELADA")).toBe(true);

    // Y no se le puede armar un plan nuevo.
    await expect(makePlan(passengerId, 3)).rejects.toMatchObject({
      reason: "CANCELADO",
    });
  });

  it("un pasajero cancelado no puede declarar pagos nuevos", async () => {
    const actor = await createActor("nadia");
    const passengerId = await join(tripA, actor, "PASAJERO");

    actAs(coty);
    await makePlan(passengerId, 1);
    const plan = await getPaymentPlan(passengerId);
    const cuotaId = plan!.installments[0]!.id;

    await cancelPassenger(passengerId);

    actAs(actor);
    await expect(declare(passengerId, cuotaId, "100.00")).rejects.toBeInstanceOf(
      PaymentError,
    );
  });
});

// ---------------------- Aislamiento: por servicio --------------------------

describe("un pasajero no ve pagos de otro · por servicio", () => {
  it("no puede leer el plan de un pasajero del mismo viaje", async () => {
    actAs(ana);
    await expect(getPaymentPlan(betoId)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("no puede leer el plan de un pasajero de otro viaje", async () => {
    actAs(ana);
    await expect(getPaymentPlan(elsaId)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("sí puede leer el suyo", async () => {
    actAs(ana);
    const plan = await getPaymentPlan(anaId);
    expect(plan?.passengerId).toBe(anaId);
  });

  it("no puede ver la cola de revisión del viaje", async () => {
    actAs(ana);
    await expect(listPendingReviews(tripA)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("no puede ver el total recaudado del viaje", async () => {
    actAs(ana);
    await expect(getTripPaymentsOverview(tripA)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("no puede confirmar ni rechazar pagos", async () => {
    actAs(coty);
    const plan = await getPaymentPlan(betoId);
    const { paymentId } = await declare(
      betoId,
      plan!.installments[0]!.id,
      "10.00",
    );

    actAs(ana);
    await expect(
      confirmPayment({ paymentId, fxRateUsed: null, fxRateSource: "SUGERIDO", notes: null }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      rejectPayment({ paymentId, reason: "No me gusta este pago." }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("no puede declarar un pago en nombre de otro", async () => {
    actAs(coty);
    const plan = await getPaymentPlan(betoId);
    const cuotaId = plan!.installments[0]!.id;

    actAs(ana);
    await expect(declare(betoId, cuotaId, "100.00")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("no puede imputar su pago a la cuota de otro pasajero", async () => {
    actAs(coty);
    const betoPlan = await getPaymentPlan(betoId);
    const cuotaAjena = betoPlan!.installments[0]!.id;

    actAs(ana);
    await expect(declare(anaId, cuotaAjena, "100.00")).rejects.toMatchObject({
      reason: "CUOTA",
    });
  });

  it("el coordinador del viaje A no llega a los pagos del viaje B", async () => {
    actAs(coty);
    await expect(getTripPaymentsOverview(tripB)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(getPaymentPlan(elsaId)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("sin sesión no se llega a nada", async () => {
    actAsAnonymous();
    await expect(getPaymentPlan(anaId)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    await expect(getTripPaymentsOverview(tripA)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });
});

// ------------------------ Aislamiento: por HTTP ----------------------------

/**
 * Los comprobantes se piden por HTTP, no por Server Action: son un archivo que
 * el navegador abre en otra pestaña. Por eso se ejercita el Route Handler
 * entero —el mismo módulo que Next monta en producción— y no solo el servicio
 * que hay debajo.
 *
 * Se lo invoca en proceso, sin abrir un socket: lo que se está verificando es
 * la cadena route → servicio → guard → política, y el transporte no participa
 * de ninguna decisión.
 */
describe("un pasajero no ve comprobantes de otro · por HTTP", () => {
  let anaProofPaymentId: string;
  let betoProofPaymentId: string;

  const request = (paymentId: string) =>
    proofRoute(new Request(`http://localhost/api/comprobantes/${paymentId}`) as never, {
      params: Promise.resolve({ paymentId }),
    });

  beforeAll(async () => {
    actAs(coty);

    const anaPlan = await getPaymentPlan(anaId);
    const anaPending = anaPlan!.installments.find((i) => i.state !== "PAGADA")!;
    anaProofPaymentId = (
      await declare(anaId, anaPending.id, "10.00")
    ).paymentId;

    const betoPlan = await getPaymentPlan(betoId);
    betoProofPaymentId = (
      await declare(betoId, betoPlan!.installments[0]!.id, "10.00")
    ).paymentId;
  });

  it("el dueño del comprobante lo abre: 307 a una URL firmada", async () => {
    actAs(ana);
    const response = await request(anaProofPaymentId);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("bucket.test");
    // Y la path firmada es la suya, no otra. La carpeta del bucket va por
    // personId, no por passengerId: es la identidad que sobrevive a la
    // conversión de interesada a pasajera (ver domain/storage-paths.ts).
    expect(storageState.signed.at(-1)).toContain(`/${ana.personId}/`);
  });

  it("el comprobante de otro pasajero del mismo viaje: 404", async () => {
    actAs(ana);
    const response = await request(betoProofPaymentId);

    expect(response.status).toBe(404);
    // Lo importante: no se llegó ni a firmar una URL.
    expect(storageState.signed).toHaveLength(0);
  });

  it("un id de pago inventado: 404, sin distinguirlo de uno ajeno", async () => {
    actAs(ana);
    const response = await request(randomUUID());
    expect(response.status).toBe(404);
  });

  it("un id que ni siquiera es un uuid: 404, sin tocar la base", async () => {
    actAs(ana);
    const response = await request("../../etc/passwd");
    expect(response.status).toBe(404);
  });

  it("el coordinador del viaje sí puede abrirlo", async () => {
    actAs(coty);
    const response = await request(betoProofPaymentId);
    expect(response.status).toBe(307);
  });

  it("el coordinador de OTRO viaje no: 404", async () => {
    actAs(otto);
    const response = await request(anaProofPaymentId);
    expect(response.status).toBe(404);
  });

  it("sin sesión: 401", async () => {
    actAsAnonymous();
    const response = await request(anaProofPaymentId);
    expect(response.status).toBe(401);
  });
});


// ------------------------ Arreglos previos a la fase 5 ---------------------

describe("procedencia del tipo de cambio", () => {
  async function paidInEuros(name: string, source: "SUGERIDO" | "INGRESADO") {
    const passengerId = await join(tripA, await createActor(name), "PASAJERO");

    actAs(coty);
    await makePlan(passengerId, 1);
    const plan = await getPaymentPlan(passengerId);
    const { paymentId } = await declare(
      passengerId,
      plan!.installments[0]!.id,
      "1000.00",
      "EUR",
    );

    await confirmPayment({
      paymentId,
      fxRateUsed: "0.86373391",
      fxRateSource: source,
      notes: null,
    });

    return prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
      select: { fxRateSource: true, fxRateUsed: true },
    });
  }

  it("mientras está en revisión, el TC es el sugerido", async () => {
    const passengerId = await join(
      tripA,
      await createActor("bruna"),
      "PASAJERO",
    );

    actAs(coty);
    await makePlan(passengerId, 1);
    const plan = await getPaymentPlan(passengerId);
    const { paymentId } = await declare(
      passengerId,
      plan!.installments[0]!.id,
      "500.00",
      "EUR",
    );

    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
      select: { fxRateSource: true },
    });
    // Nadie miró todavía ningún extracto.
    expect(payment.fxRateSource).toBe("SUGERIDO");
  });

  it("distingue el TC tipeado del extracto del que quedó sugerido", async () => {
    expect((await paidInEuros("celia", "INGRESADO")).fxRateSource).toBe(
      "INGRESADO",
    );
    expect((await paidInEuros("dora", "SUGERIDO")).fxRateSource).toBe(
      "SUGERIDO",
    );
  });

  it("en la moneda del viaje no hay procedencia que registrar", async () => {
    const passengerId = await join(
      tripA,
      await createActor("emma"),
      "PASAJERO",
    );

    actAs(coty);
    await makePlan(passengerId, 1);
    const plan = await getPaymentPlan(passengerId);
    const { paymentId } = await declare(
      passengerId,
      plan!.installments[0]!.id,
      "100.00",
    );

    // El cliente declara INGRESADO, pero no hubo conversión: manda la moneda
    // real del pago, no lo que diga el formulario.
    await confirmPayment({
      paymentId,
      fxRateUsed: null,
      fxRateSource: "INGRESADO",
      notes: null,
    });

    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
      select: { fxRateUsed: true, fxRateSource: true },
    });
    expect(payment.fxRateUsed).toBeNull();
    expect(payment.fxRateSource).toBeNull();
  });

  it("deshacer la confirmación devuelve el TC a SUGERIDO", async () => {
    const passengerId = await join(
      tripA,
      await createActor("flor"),
      "PASAJERO",
    );

    actAs(coty);
    await makePlan(passengerId, 1);
    const plan = await getPaymentPlan(passengerId);
    const { paymentId } = await declare(
      passengerId,
      plan!.installments[0]!.id,
      "1000.00",
      "EUR",
    );

    await confirmPayment({
      paymentId,
      fxRateUsed: "0.86373391",
      fxRateSource: "INGRESADO",
      notes: null,
    });
    await revertPayment({ paymentId, reason: "Me equivoqué de comprobante." });

    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
      select: { fxRateSource: true },
    });
    // El TC del extracto era parte de la decisión que se deshizo.
    expect(payment.fxRateSource).toBe("SUGERIDO");
  });
});

describe("total esperado del viaje", () => {
  it("suma solo los planes activos y declara lo que deja afuera", async () => {
    const tripId = await createTrip("Esperado");
    await join(tripId, coty, "COORDINADOR");

    const activo = await join(tripId, await createActor("gina"), "PASAJERO");
    const cancelado = await join(tripId, await createActor("hebe"), "PASAJERO");
    // Sin plan: no suma nada al esperado, pero tiene que contarse aparte.
    await join(tripId, await createActor("iris"), "PASAJERO");

    actAs(coty);
    await makePlan(activo, 1);
    await makePlan(cancelado, 1);

    // El cancelado alcanzó a pagar antes de darse de baja.
    const planCancelado = await getPaymentPlan(cancelado);
    const { paymentId } = await declare(
      cancelado,
      planCancelado!.installments[0]!.id,
      "1000.00",
    );
    await confirmPayment({
      paymentId,
      fxRateUsed: null,
      fxRateSource: "SUGERIDO",
      notes: null,
    });

    await cancelPassenger(cancelado);

    const overview = await getTripPaymentsOverview(tripId);

    // Un solo plan activo: el esperado es su total, no el de los dos.
    expect(overview.expected).toBe("3499.43");
    expect(overview.collected).toBe("0.00");

    // Y lo que queda afuera se dice, no se esconde.
    expect(overview.passengersWithoutPlan).toBe(1);
    expect(overview.cancelledWithPlan).toBe(1);
    expect(overview.collectedFromCancelled).toBe("1000.00");
  });
});

describe("zona horaria del viaje", () => {
  /**
   * El mismo instante y la misma cuota, con dos zonas distintas, dan dos
   * respuestas distintas. Es exactamente el bug que motivó Trip.timezone, acá
   * verificado de punta a punta contra la base.
   */
  it("una cuota no vence antes de que termine el día del pasajero", async () => {
    const tripId = await createTrip("Husos");
    await join(tripId, coty, "COORDINADOR");
    const passengerId = await join(
      tripId,
      await createActor("juli"),
      "PASAJERO",
    );

    actAs(coty);
    await makePlan(passengerId, 1);

    // La cuota vence el 26/08/2026.
    await prisma.installment.updateMany({
      where: { plan: { passengerId } },
      data: { dueDate: new Date("2026-08-26T00:00:00.000Z") },
    });

    // 23:59 del 26 en Buenos Aires = 02:59 del 27 en UTC.
    const instant = new Date("2026-08-27T02:59:00.000Z");

    const enHora = await getPaymentPlan(passengerId, instant);
    expect(enHora!.installments[0]!.overdue).toBe(false);
    expect(enHora!.light).toBe("AMARILLO");

    // El mismo viaje declarado en UTC sí la da por vencida: la diferencia no
    // es teórica, la decide el campo.
    await prisma.trip.update({
      where: { id: tripId },
      data: { timezone: "UTC" },
    });

    const enUtc = await getPaymentPlan(passengerId, instant);
    expect(enUtc!.installments[0]!.overdue).toBe(true);
    expect(enUtc!.light).toBe("ROJO");
  });

  it("una zona con typo no rompe la pantalla: cae al default", async () => {
    const tripId = await createTrip("Huso roto");
    await join(tripId, coty, "COORDINADOR");
    const passengerId = await join(
      tripId,
      await createActor("kira"),
      "PASAJERO",
    );

    actAs(coty);
    await makePlan(passengerId, 1);
    await prisma.installment.updateMany({
      where: { plan: { passengerId } },
      data: { dueDate: new Date("2026-08-26T00:00:00.000Z") },
    });
    await prisma.trip.update({
      where: { id: tripId },
      data: { timezone: "America/Buenos_Aires_" },
    });

    const plan = await getPaymentPlan(
      passengerId,
      new Date("2026-08-27T02:59:00.000Z"),
    );
    // Se comporta como el default (hora argentina), no como UTC.
    expect(plan!.installments[0]!.overdue).toBe(false);
  });
});

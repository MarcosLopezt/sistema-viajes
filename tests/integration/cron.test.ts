import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { actAs } from "./setup";
import type { EmailMessage } from "@/lib/email";
import type * as EmailModule from "@/lib/email";

/**
 * Cron y comunicaciones, contra la base REAL.
 *
 * Lo único mockeado además de la sesión es el PROVEEDOR de mail: mandar mails
 * de verdad desde un test es exactamente lo que no queremos. Todo lo demás
 * —las plantillas, la resolución de idioma, los índices unique que hacen
 * idempotente al cron, el Route Handler con su chequeo del secreto— corre de
 * verdad.
 */

/** Todo lo que "se envió" en esta corrida. */
const outbox: EmailMessage[] = [];

/** Permite simular que el proveedor rechaza un destinatario puntual. */
let failWhen: (message: EmailMessage) => string | null = () => null;

vi.mock("@/lib/email", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof EmailModule;
  return {
    ...actual,
    getEmailProvider: () => ({
      name: "test",
      send: async (message: EmailMessage) => {
        const failure = failWhen(message);
        if (failure !== null) {
          throw new actual.EmailSendError(failure, "test");
        }
        outbox.push(message);
        return { messageId: randomUUID(), provider: "test" };
      },
    }),
  };
});

const { prisma, disconnectDb } = await import("@/lib/db/prisma");
const { POST: cronRoute, GET: cronGet } = await import(
  "@/app/api/cron/daily/route"
);
const { sendPaymentReminders, sendPassportAlerts } = await import(
  "@/lib/services/reminders"
);
const {
  createCommunication,
  sendCommunicationNow,
  retryFailedRecipients,
  listCommunicationsForPassenger,
  hasEnglishVersion,
} = await import("@/lib/services/communications");

const SUFFIX = randomUUID().slice(0, 8);
const email = (name: string) => `${name}-cron-${SUFFIX}@test.invalid`;
const SECRET = "secreto-de-prueba-del-cron";

/** Presupuesto amplio: los tests miden lógica, no la latencia de Supabase. */
const BUDGET = { maxEmails: 500, deadline: Date.now() + 10 * 60 * 1000 };

interface Actor {
  id: string;
  email: string;
}

let tripId: string;
let coty: Actor;
let ana: Actor;
let beto: Actor;
let anaId: string;
let betoId: string;
let cancelledId: string;
let cotyPassengerId: string;
let pausedTripIds: string[] = [];

/** Mails de ESTA corrida dirigidos a los actores de este test. */
function mine(): EmailMessage[] {
  return outbox.filter((message) => message.to.includes(SUFFIX));
}

async function createActor(
  name: string,
  lang: "ES" | "EN" = "ES",
  passportExpiry: Date | null = new Date("2030-01-01T00:00:00.000Z"),
): Promise<Actor> {
  const person = await prisma.person.create({
    data: {
      fullName: `${name} ${SUFFIX}`,
      preferredLanguage: lang,
      passportExpiryDate: passportExpiry,
    },
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
  return user;
}

async function join(
  actor: Actor,
  role: "COORDINADOR" | "PASAJERO",
  status: "CONFIRMADO" | "CANCELADO" = "CONFIRMADO",
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
      status,
      isCoordinator: role === "COORDINADOR",
    },
    select: { id: true },
  });
  return passenger.id;
}

/** Plan de una cuota, con el vencimiento donde haga falta para el caso. */
async function planWithDueDate(
  passengerId: string,
  dueDate: string,
): Promise<{ planId: string; installmentId: string }> {
  const plan = await prisma.paymentPlan.create({
    data: {
      passengerId,
      totalAmount: "1000.00",
      currency: "GBP",
      installmentCount: 1,
      fxSnapshot: {
        base: "USD",
        date: "2026-08-24",
        rates: { EUR: "0.9", GBP: "0.8" },
      },
      fxSnapshotDate: new Date("2026-08-24T00:00:00.000Z"),
      installments: {
        create: [
          {
            number: 1,
            dueDate: new Date(`${dueDate}T00:00:00.000Z`),
            amount: "1000.00",
          },
        ],
      },
    },
    include: { installments: true },
  });
  return { planId: plan.id, installmentId: plan.installments[0]!.id };
}

function cronRequest(secret: string | null): Request {
  return new Request("http://localhost/api/cron/daily", {
    method: "POST",
    ...(secret === null
      ? {}
      : { headers: { authorization: `Bearer ${secret}` } }),
  });
}

beforeAll(async () => {
  process.env.CRON_SECRET = SECRET;
  process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3000";

  /**
   * Los demás viajes activos de la base —el del seed, los de otros tests— se
   * pausan mientras corre este archivo.
   *
   * El cron es global por diseño: recorre TODOS los viajes activos. Sin esto,
   * los asertos de "se mandó exactamente un mail" competirían con las cuotas
   * del seed por el presupuesto de la corrida, y el test fallaría por motivos
   * que no tienen nada que ver con lo que prueba. Se restauran en afterAll.
   */
  const others = await prisma.trip.findMany({
    where: { status: { in: ["ABIERTO", "CERRADO"] } },
    select: { id: true },
  });
  pausedTripIds = others.map((trip) => trip.id);
  await prisma.trip.updateMany({
    where: { id: { in: pausedTripIds } },
    data: { status: "BORRADOR" },
  });

  const trip = await prisma.trip.create({
    data: {
      name: `Cron ${SUFFIX}`,
      startDate: new Date("2028-05-10T00:00:00.000Z"),
      endDate: new Date("2028-05-24T00:00:00.000Z"),
      currency: "GBP",
      minPassengers: 10,
      maxPassengers: 14,
      budgetedPassengers: 14,
      status: "ABIERTO",
      priceDouble: "1000.00",
      priceSingle: "1200.00",
      timezone: "America/Argentina/Buenos_Aires",
      reminderOffsetsDays: [-7, 1],
    },
    select: { id: true },
  });
  tripId = trip.id;

  coty = await createActor("coty");
  ana = await createActor("ana");
  beto = await createActor("beto", "EN");
  const zoe = await createActor("zoe");

  cotyPassengerId = await join(coty, "COORDINADOR");
  anaId = await join(ana, "PASAJERO");
  betoId = await join(beto, "PASAJERO");
  cancelledId = await join(zoe, "PASAJERO", "CANCELADO");
}, 120_000);

afterAll(async () => {
  await prisma.trip.deleteMany({ where: { name: { contains: SUFFIX } } });
  await prisma.user.deleteMany({ where: { email: { contains: SUFFIX } } });
  await prisma.person.deleteMany({ where: { fullName: { contains: SUFFIX } } });
  await prisma.trip.updateMany({
    where: { id: { in: pausedTripIds } },
    data: { status: "ABIERTO" },
  });
  await disconnectDb();
});

beforeEach(() => {
  outbox.length = 0;
  failWhen = () => null;
});

// ----------------------------- Autenticación -------------------------------

describe("el endpoint de cron está cerrado sin el secreto", () => {
  it("sin cabecera Authorization: 401", async () => {
    const response = await cronRoute(cronRequest(null) as never);
    expect(response.status).toBe(401);
    expect(outbox).toHaveLength(0);
  });

  it("con un secreto equivocado: 401", async () => {
    const response = await cronRoute(cronRequest("no-es-el-secreto") as never);
    expect(response.status).toBe(401);
    expect(outbox).toHaveLength(0);
  });

  it("con un secreto del mismo largo pero distinto: 401", async () => {
    // El caso que un `===` con salida temprana filtraría por tiempo.
    const almost = `${SECRET.slice(0, -1)}X`;
    expect(almost.length).toBe(SECRET.length);
    const response = await cronRoute(cronRequest(almost) as never);
    expect(response.status).toBe(401);
  });

  it("sin CRON_SECRET configurado, el endpoint se cierra en vez de abrirse", async () => {
    const saved = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    try {
      const response = await cronRoute(cronRequest(SECRET) as never);
      expect(response.status).toBe(401);
    } finally {
      process.env.CRON_SECRET = saved;
    }
  });

  it("un GET no ejecuta nada", async () => {
    const response = cronGet();
    expect(response.status).toBe(405);
    expect(outbox).toHaveLength(0);
  });

  it("con el secreto correcto: 200 y un resumen por tarea", async () => {
    const response = await cronRoute(cronRequest(SECRET) as never);
    expect(response.status).toBe(200);

    const payload = (await response.json()) as {
      ok: boolean;
      tasks: { task: string; ok: boolean }[];
    };

    expect(payload.tasks.map((task) => task.task)).toEqual([
      "cotizaciones",
      "recordatorios",
      "pasaportes",
      "comunicaciones",
      "rateLimit",
    ]);
  });
});

// ------------------------------ Idempotencia -------------------------------

describe("idempotencia del cron", () => {
  it("dos corridas seguidas mandan exactamente un recordatorio", async () => {
    // Vence dentro de exactamente 7 días: dispara el offset -7 y SOLO ese.
    // (Una cuota ya vencida dispararía los dos, y el test dejaría de medir lo
    // que dice medir.)
    const passengerId = await join(await createActor("ida"), "PASAJERO");
    await planWithDueDate(passengerId, inDays(7));

    await cronRoute(cronRequest(SECRET) as never);
    expect(mine()).toHaveLength(1);

    outbox.length = 0;
    await cronRoute(cronRequest(SECRET) as never);

    // La segunda corrida choca contra el unique y no manda nada.
    expect(mine()).toHaveLength(0);

    const reminders = await prisma.sentReminder.count({
      where: { installment: { plan: { passengerId } } },
    });
    expect(reminders).toBe(1);
  });

  it("un recordatorio por cuota y por tipo, no uno por corrida", async () => {
    const passengerId = await join(await createActor("juana"), "PASAJERO");
    // Venció hace 10 días: los DOS offsets (-7 y +1) ya pasaron.
    const { installmentId } = await planWithDueDate(passengerId, daysAgo(10));

    await sendPaymentReminders(new Date(), BUDGET);

    const marks = await prisma.sentReminder.findMany({
      where: { installmentId },
      select: { offsetDays: true },
    });
    expect(marks.map((m) => m.offsetDays).sort()).toEqual([-7, 1]);
    expect(mine()).toHaveLength(2);

    // Y no se repiten.
    outbox.length = 0;
    await sendPaymentReminders(new Date(), BUDGET);
    expect(mine()).toHaveLength(0);
  });

  it("si el envío falla, la marca se suelta y se reintenta", async () => {
    const actor = await createActor("kara");
    const passengerId = await join(actor, "PASAJERO");
    const { installmentId } = await planWithDueDate(passengerId, yesterday());

    failWhen = (message) =>
      message.to === actor.email ? "casilla inexistente" : null;

    const failed = await sendPaymentReminders(new Date(), BUDGET);
    expect(failed.failed).toBeGreaterThan(0);
    // La marca no quedó: si quedara, este recordatorio no saldría nunca.
    expect(
      await prisma.sentReminder.count({ where: { installmentId } }),
    ).toBe(0);

    failWhen = () => null;
    const retried = await sendPaymentReminders(new Date(), BUDGET);
    expect(retried.sent).toBeGreaterThan(0);
    // Dos marcas, no una: una cuota que venció ayer dispara los dos offsets
    // configurados (-7, que ya pasó hace una semana, y +1, que es hoy).
    expect(
      await prisma.sentReminder.count({ where: { installmentId } }),
    ).toBe(2);
  });
});

// --------------------------- A quién NO se le manda ------------------------

describe("a quién no se le manda un recordatorio", () => {
  it("nunca a un pasajero cancelado, aunque tenga cuotas vencidas", async () => {
    await planWithDueDate(cancelledId, daysAgo(30));

    await sendPaymentReminders(new Date(), BUDGET);

    expect(mine().some((m) => m.to.includes("zoe"))).toBe(false);
    expect(
      await prisma.sentReminder.count({
        where: { installment: { plan: { passengerId: cancelledId } } },
      }),
    ).toBe(0);
  });

  it("nunca a un coordinador", async () => {
    // Un coordinador no genera plan, pero si por un error de datos tuviera
    // uno, tampoco se le escribe.
    await planWithDueDate(cotyPassengerId, daysAgo(30));

    await sendPaymentReminders(new Date(), BUDGET);

    expect(mine().some((m) => m.to.includes("coty"))).toBe(false);
  });

  it("nunca sobre una cuota ya pagada", async () => {
    const passengerId = await join(await createActor("lila"), "PASAJERO");
    const { planId, installmentId } = await planWithDueDate(
      passengerId,
      daysAgo(30),
    );

    await prisma.payment.create({
      data: {
        planId,
        installmentId,
        kind: "PAGO",
        amount: "1000.00",
        currency: "GBP",
        amountInTripCurrency: "1000.00",
        transferDate: new Date("2026-08-01T00:00:00.000Z"),
        status: "CONFIRMADO",
      },
    });

    await sendPaymentReminders(new Date(), BUDGET);

    expect(mine().some((m) => m.to.includes("lila"))).toBe(false);
    expect(
      await prisma.sentReminder.count({ where: { installmentId } }),
    ).toBe(0);
  });

  it("todavía no, si el vencimiento está lejos", async () => {
    const passengerId = await join(await createActor("mora"), "PASAJERO");
    // Vence en 30 días: el offset -7 recién dispara dentro de 23.
    await planWithDueDate(passengerId, inDays(30));

    await sendPaymentReminders(new Date(), BUDGET);
    expect(mine().some((m) => m.to.includes("mora"))).toBe(false);
  });

  it("en el idioma del destinatario, no en el del coordinador", async () => {
    await planWithDueDate(betoId, yesterday());
    await sendPaymentReminders(new Date(), BUDGET);

    const toBeto = mine().find((m) => m.to.includes("beto"));
    expect(toBeto?.lang).toBe("en");
    expect(toBeto?.subject).toContain("Instalment");
  });
});

// -------------------------- Alertas de pasaporte ---------------------------

describe("alertas de pasaporte", () => {
  it("se manda una vez por nivel, no todos los días", async () => {
    const actor = await createActor(
      "nadia",
      "ES",
      // Vence antes del regreso del viaje: bloqueante.
      new Date("2028-01-01T00:00:00.000Z"),
    );
    const passengerId = await join(actor, "PASAJERO");

    await sendPassportAlerts(new Date(), BUDGET);
    expect(mine().filter((m) => m.to === actor.email)).toHaveLength(1);

    outbox.length = 0;
    await sendPassportAlerts(new Date(), BUDGET);
    expect(mine().filter((m) => m.to === actor.email)).toHaveLength(0);

    const marks = await prisma.sentNotification.findMany({
      where: { passengerId },
      select: { tag: true },
    });
    expect(marks).toEqual([{ tag: "BLOQUEANTE" }]);
  });

  it("no se le manda a quien tiene el pasaporte en orden", async () => {
    const actor = await createActor(
      "olivia",
      "ES",
      new Date("2035-01-01T00:00:00.000Z"),
    );
    await join(actor, "PASAJERO");

    await sendPassportAlerts(new Date(), BUDGET);
    expect(mine().some((m) => m.to === actor.email)).toBe(false);
  });

  it("a quien no cargó el pasaporte también se le avisa", async () => {
    const actor = await createActor("paula", "ES", null);
    await join(actor, "PASAJERO");

    await sendPassportAlerts(new Date(), BUDGET);
    expect(mine().some((m) => m.to === actor.email)).toBe(true);
  });

  it("nunca a un cancelado", async () => {
    const actor = await createActor(
      "quena",
      "ES",
      new Date("2028-01-01T00:00:00.000Z"),
    );
    await join(actor, "PASAJERO", "CANCELADO");

    await sendPassportAlerts(new Date(), BUDGET);
    expect(mine().some((m) => m.to === actor.email)).toBe(false);
  });
});

// ------------------------ Aislamiento entre tareas -------------------------

describe("una tarea que falla no tumba a las otras", () => {
  it("con el proveedor de mail roto, la purga y las cotizaciones igual corren", async () => {
    failWhen = () => "el proveedor está caído";

    const response = await cronRoute(cronRequest(SECRET) as never);
    expect(response.status).toBe(200);

    const payload = (await response.json()) as {
      ok: boolean;
      tasks: { task: string; ok: boolean; detail?: { purged?: number } }[];
    };

    // Las tareas de mail no "fallan": marcan los envíos como fallidos y
    // siguen. Las que no mandan mails terminan bien igual.
    const purge = payload.tasks.find((task) => task.task === "rateLimit");
    expect(purge?.ok).toBe(true);
    expect(typeof purge?.detail?.purged).toBe("number");
  });
});

// ----------------------------- Comunicaciones ------------------------------

describe("comunicaciones", () => {
  it("con versión en inglés, cada uno la recibe en su idioma", async () => {
    actAs(coty);
    const { id } = await createCommunication(tripId, {
      subjectEs: `Aviso ${SUFFIX}`,
      bodyEs: "Nos vemos el jueves.",
      subjectEn: `Notice ${SUFFIX}`,
      bodyEn: "See you on Thursday.",
      audience: "TODOS",
      passengerIds: [],
      includeCancelled: false,
    });

    const report = await sendCommunicationNow(id);
    expect(report.failed).toBe(0);

    const toAna = mine().find((m) => m.to.includes("ana"));
    const toBeto = mine().find((m) => m.to.includes("beto"));

    expect(toAna?.subject).toBe(`Aviso ${SUFFIX}`);
    expect(toBeto?.subject).toBe(`Notice ${SUFFIX}`);
  });

  it("sin versión en inglés completa, va la española a todos", async () => {
    actAs(coty);
    const { id } = await createCommunication(tripId, {
      subjectEs: `Solo ES ${SUFFIX}`,
      bodyEs: "Mensaje en español.",
      // Asunto en inglés sí, cuerpo no: media traducción no cuenta.
      subjectEn: "Only EN subject",
      bodyEn: null,
      audience: "TODOS",
      passengerIds: [],
      includeCancelled: false,
    });

    expect(
      hasEnglishVersion({ subjectEn: "Only EN subject", bodyEn: null }),
    ).toBe(false);

    await sendCommunicationNow(id);

    const toBeto = mine().find((m) => m.to.includes("beto"));
    expect(toBeto?.subject).toBe(`Solo ES ${SUFFIX}`);
    expect(toBeto?.lang).toBe("es");
  });

  it("los cancelados quedan afuera salvo que se los incluya", async () => {
    actAs(coty);

    const { id } = await createCommunication(tripId, {
      subjectEs: `Sin cancelados ${SUFFIX}`,
      bodyEs: "x",
      subjectEn: null,
      bodyEn: null,
      audience: "TODOS",
      passengerIds: [],
      includeCancelled: false,
    });
    await sendCommunicationNow(id);
    expect(mine().some((m) => m.to.includes("zoe"))).toBe(false);

    outbox.length = 0;
    const conCancelados = await createCommunication(tripId, {
      subjectEs: `Con cancelados ${SUFFIX}`,
      bodyEs: "x",
      subjectEn: null,
      bodyEn: null,
      audience: "TODOS",
      passengerIds: [],
      includeCancelled: true,
    });
    await sendCommunicationNow(conCancelados.id);
    expect(mine().some((m) => m.to.includes("zoe"))).toBe(true);
  });

  it("un coordinador no es destinatario: la escribe él", async () => {
    actAs(coty);
    const { id } = await createCommunication(tripId, {
      subjectEs: `Sin coordinador ${SUFFIX}`,
      bodyEs: "x",
      subjectEn: null,
      bodyEn: null,
      audience: "TODOS",
      passengerIds: [],
      includeCancelled: false,
    });
    await sendCommunicationNow(id);
    expect(mine().some((m) => m.to.includes("coty"))).toBe(false);
  });

  it("un fallo individual no aborta el lote, y se puede reintentar", async () => {
    actAs(coty);
    // Comparación exacta, no `includes`: "ana" también matchea "juana".
    failWhen = (message) =>
      message.to === ana.email ? "casilla inexistente (550)" : null;

    const { id } = await createCommunication(tripId, {
      subjectEs: `Con un fallo ${SUFFIX}`,
      bodyEs: "x",
      subjectEn: null,
      bodyEn: null,
      audience: "TODOS",
      passengerIds: [],
      includeCancelled: false,
    });

    const report = await sendCommunicationNow(id);

    // Ana falló, los demás salieron: trece enviados y uno fallido es un
    // resultado; cero enviados porque el primero estaba mal, no.
    expect(report.failed).toBe(1);
    expect(report.sent).toBeGreaterThan(0);
    expect(mine().some((m) => m.to === beto.email)).toBe(true);

    // El error del proveedor queda legible, no en un log perdido.
    const failedRow = await prisma.communicationRecipient.findFirstOrThrow({
      where: { communicationId: id, status: "FALLIDO" },
      select: { error: true, passengerId: true },
    });
    expect(failedRow.error).toContain("550");
    expect(failedRow.passengerId).toBe(anaId);

    // Reintentar toca SOLO a los fallidos.
    outbox.length = 0;
    failWhen = () => null;
    const retry = await retryFailedRecipients(id);

    expect(retry.sent).toBe(1);
    expect(mine()).toHaveLength(1);
    expect(mine()[0]!.to).toBe(ana.email);
  });

  it("con audiencia SELECCION, el idioma se resuelve al enviar", async () => {
    /**
     * Las filas de destinatario de una selección se crean al guardar el
     * borrador, con ES provisorio: en ese momento todavía no se sabe si va a
     * haber versión en inglés. Al enviar se corrigen. Sin eso, Beto recibiría
     * español aunque la traducción esté completa.
     */
    const { setSelectedPassengers } = await import(
      "@/lib/services/communications"
    );

    actAs(coty);
    const { id } = await createCommunication(tripId, {
      subjectEs: `Selección ${SUFFIX}`,
      bodyEs: "Cuerpo en español.",
      subjectEn: `Selected ${SUFFIX}`,
      bodyEn: "Body in English.",
      audience: "SELECCION",
      passengerIds: [],
      includeCancelled: false,
    });

    await setSelectedPassengers(id, [betoId]);

    // Recién guardado: provisorio en ES.
    expect(
      await prisma.communicationRecipient.findFirstOrThrow({
        where: { communicationId: id, passengerId: betoId },
        select: { lang: true },
      }),
    ).toEqual({ lang: "ES" });

    await sendCommunicationNow(id);

    // Y solo a él: la selección es una selección.
    expect(mine()).toHaveLength(1);
    expect(mine()[0]!.to).toBe(beto.email);
    expect(mine()[0]!.subject).toBe(`Selected ${SUFFIX}`);
    expect(mine()[0]!.lang).toBe("en");
  });

  it("el pasajero ve en Novedades lo que le llegó, en su idioma", async () => {
    actAs(coty);
    const { id } = await createCommunication(tripId, {
      subjectEs: `Novedad ${SUFFIX}`,
      bodyEs: "Cuerpo en español.",
      subjectEn: `News ${SUFFIX}`,
      bodyEn: "Body in English.",
      audience: "TODOS",
      passengerIds: [],
      includeCancelled: false,
    });
    await sendCommunicationNow(id);

    actAs(beto);
    const news = await listCommunicationsForPassenger(betoId);
    const item = news.find((n) => n.id === id);
    expect(item?.subject).toBe(`News ${SUFFIX}`);

    actAs(ana);
    const anaNews = await listCommunicationsForPassenger(anaId);
    expect(anaNews.find((n) => n.id === id)?.subject).toBe(`Novedad ${SUFFIX}`);
  });

  it("un pasajero no ve las novedades de otro", async () => {
    actAs(ana);
    const { ForbiddenError } = await import("@/lib/auth/errors");
    await expect(
      listCommunicationsForPassenger(betoId),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("un pasajero no puede escribir una comunicación", async () => {
    actAs(ana);
    const { ForbiddenError } = await import("@/lib/auth/errors");
    await expect(
      createCommunication(tripId, {
        subjectEs: "No debería poder",
        bodyEs: "x",
        subjectEn: null,
        bodyEn: null,
        audience: "TODOS",
        passengerIds: [],
        includeCancelled: false,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

// ------------------------- Bordes de medianoche ----------------------------

describe("el recordatorio usa la fecha de calendario del viaje", () => {
  /**
   * La cuota vence hoy y el offset es +1: el recordatorio corresponde MAÑANA.
   * A las 23:59 hora argentina —que en UTC ya es mañana— todavía no tiene que
   * salir. Es el mismo bug que motivó Trip.timezone, ahora en el cron.
   */
  it("a las 23:59 del vencimiento todavía no manda el aviso de +1 día", async () => {
    const actor = await createActor("rita");
    const passengerId = await join(actor, "PASAJERO");
    const { installmentId } = await planWithDueDate(passengerId, "2027-03-15");

    const plusOne = () =>
      prisma.sentReminder.count({ where: { installmentId, offsetDays: 1 } });

    // 15/03 23:59 en Buenos Aires = 16/03 02:59 UTC.
    // Se mira la marca del offset +1 y no el buzón: esta misma cuota dispara
    // además el recordatorio de -7 días, que corresponde desde hace una
    // semana. Lo que se está probando es el borde del +1.
    await sendPaymentReminders(new Date("2027-03-16T02:59:00.000Z"), BUDGET);
    expect(await plusOne()).toBe(0);

    // 16/03 00:01 en Buenos Aires: ahí sí.
    await sendPaymentReminders(new Date("2027-03-16T03:01:00.000Z"), BUDGET);
    expect(await plusOne()).toBe(1);
  });

  it("con el viaje declarado en UTC, el mismo instante sí dispara", async () => {
    const actor = await createActor("sofi");
    const passengerId = await join(actor, "PASAJERO");
    const { installmentId } = await planWithDueDate(passengerId, "2027-04-15");

    await prisma.trip.update({
      where: { id: tripId },
      data: { timezone: "UTC" },
    });

    // Mismo instante que en el test anterior, otra zona: en UTC ya es el 16,
    // así que el aviso de +1 sí corresponde. La diferencia la decide el campo.
    await sendPaymentReminders(new Date("2027-04-16T02:59:00.000Z"), BUDGET);
    expect(
      await prisma.sentReminder.count({ where: { installmentId, offsetDays: 1 } }),
    ).toBe(1);

    await prisma.trip.update({
      where: { id: tripId },
      data: { timezone: "America/Argentina/Buenos_Aires" },
    });
  });
});

// ------------------------------- Utilidades --------------------------------

function shift(days: number): string {
  const now = new Date();
  const base = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return new Date(base + days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

const yesterday = () => shift(-1);
const daysAgo = (days: number) => shift(-days);
const inDays = (days: number) => shift(days);

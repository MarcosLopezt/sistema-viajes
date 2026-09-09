import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { actAs, actAsAnonymous } from "./setup";
import { prisma, disconnectDb } from "@/lib/db/prisma";
import { ForbiddenError, UnauthorizedError } from "@/lib/auth/errors";
import { resetEmailProvider } from "@/lib/email";
import {
  convertInterestToPassenger,
  getMyInterestView,
  getPublicTrip,
  InterestError,
  listInterests,
  registerInterest,
  setInterestStatus,
  viewerIsOnlyInterested,
} from "@/lib/services/interest";
import { setAcceptingInterest, TripStateError, getTripBudget, getTripHeader } from "@/lib/services/trip";
import { getPassenger, listPassengers } from "@/lib/services/passengers";
import { getTripPaymentsOverview } from "@/lib/services/payments";

/**
 * La fase 7, contra la base real.
 *
 * ── Qué se prueba y qué NO ────────────────────────────────────────────────
 *
 * Lo único mockeado, además de la sesión, es `@/lib/supabase/admin`: crear el
 * usuario en Auth es una llamada a un servicio externo, y un test no puede
 * dejar cuentas de verdad tiradas en el proyecto. TODO lo demás corre real —
 * los guards, la política, las transacciones, el índice único de Postgres y el
 * rate limiting contra su propia tabla.
 *
 * Esa distinción es la que hace que estos tests signifiquen algo: el
 * aislamiento de una interesada NO está implementado con código nuevo, está
 * implementado con la AUSENCIA de un TripMember. Un test con Prisma mockeado
 * no podría distinguir eso de un `if` que se olvidaron de escribir.
 */

const SUFFIX = randomUUID().slice(0, 8);
const email = (name: string) => `${name}-${SUFFIX}@test.invalid`;

/**
 * Supabase Auth, simulado.
 *
 * Devuelve un uuid nuevo por llamada, que es lo único que el servicio usa del
 * resultado. `authShouldFail` permite ejercitar el camino de error sin
 * depender de que el servicio externo se caiga.
 */
let authShouldFail = false;
/**
 * Fuerza a Auth a devolver un id concreto.
 *
 * Sirve para provocar un choque de clave primaria DENTRO de la transacción, y
 * así probar que hace rollback. Es además un escenario real: un usuario que
 * quedó en Auth con un id que la tabla local ya tiene.
 */
let authFixedId: string | null = null;

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    auth: {
      admin: {
        createUser: async () => {
          if (authShouldFail) {
            return { data: { user: null }, error: { message: "auth caído" } };
          }
          return {
            data: { user: { id: authFixedId ?? randomUUID() } },
            error: null,
          };
        },
      },
    },
  }),
}));

interface Actor {
  id: string;
  email: string;
  personId: string;
}

let tripId: string;
let otroTripId: string;
let coordinator: Actor;
let ana: Actor;
let interesadaUserId: string;
let interesadaEmail: string;
let anaPassengerId: string;
let startedAt: Date;

/**
 * El viaje que estaba captando antes de que arrancara la suite (el del seed).
 *
 * "Como máximo un viaje aceptando" es una regla GLOBAL de la base, no del
 * viaje: para que esta suite pueda abrir el suyo tiene que cerrar el que
 * hubiera, y volver a dejarlo como estaba al terminar. Que haga falta este
 * traspaso explícito es, en sí, una prueba de que el índice está puesto.
 */
let previouslyAccepting: string | null = null;

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

async function makeTrip(name: string): Promise<string> {
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
    },
    select: { id: true },
  });
  return trip.id;
}

/**
 * El rate limiting corre de verdad contra su tabla, y el límite por IP es de 5
 * por hora sobre la clave "sin-ip" (en un test no hay `x-forwarded-for`). Sin
 * esta limpieza, el sexto registro de la suite fallaría por un motivo que no
 * es el que se está probando.
 *
 * Solo borra las filas creadas DESPUÉS de que arrancó este archivo: no toca
 * nada de otra corrida.
 */
async function clearRateLimits(): Promise<void> {
  await prisma.rateLimitHit.deleteMany({
    where: { createdAt: { gte: startedAt } },
  });
}

beforeAll(async () => {
  startedAt = new Date();
  authShouldFail = false;
  authFixedId = null;

  coordinator = await makeActor("coord");
  ana = await makeActor("ana");

  tripId = await makeTrip("Viaje interés");
  otroTripId = await makeTrip("Otro viaje");

  await prisma.tripMember.createMany({
    data: [
      { tripId, userId: coordinator.id, role: "COORDINADOR" },
      { tripId, userId: ana.id, role: "PASAJERO" },
    ],
  });

  const passenger = await prisma.passenger.create({
    data: { tripId, personId: ana.personId, roomType: "DOBLE", status: "CONFIRMADO" },
    select: { id: true },
  });
  anaPassengerId = passenger.id;

  const abierto = await prisma.trip.findFirst({
    where: { acceptingInterest: true },
    select: { id: true },
  });
  previouslyAccepting = abierto?.id ?? null;
  if (previouslyAccepting) {
    await prisma.trip.update({
      where: { id: previouslyAccepting },
      data: { acceptingInterest: false },
    });
  }

  await prisma.trip.update({
    where: { id: tripId },
    data: {
      acceptingInterest: true,
      infoForInterestedEs: `Propuesta pública ${SUFFIX}`,
      nextStepMessageEs: `Escribinos por WhatsApp ${SUFFIX}`,
      welcomeMessageEs: `Bienvenida ${SUFFIX}`,
    },
  });

  // La interesada del caso principal: se registra por el camino real.
  interesadaEmail = email("lucia");
  await registerInterest({
    fullName: `Lucía ${SUFFIX}`,
    email: interesadaEmail,
    password: "una-contrasena-larga",
    residenceCountry: "Uruguay",
    phone: "+598 99 123 456",
    locale: "es",
  });

  const user = await prisma.user.findUniqueOrThrow({
    where: { email: interesadaEmail },
    select: { id: true },
  });
  interesadaUserId = user.id;
}, 120_000);

afterAll(async () => {
  await prisma.trip.deleteMany({ where: { id: { in: [tripId, otroTripId] } } });

  // Se devuelve el candado global a quien lo tenía, o el seed queda cerrado.
  if (previouslyAccepting) {
    await prisma.trip.update({
      where: { id: previouslyAccepting },
      data: { acceptingInterest: true },
    });
  }

  await prisma.user.deleteMany({
    where: { email: { endsWith: `-${SUFFIX}@test.invalid` } },
  });
  await prisma.person.deleteMany({ where: { fullName: { contains: SUFFIX } } });
  await clearRateLimits();
  await disconnectDb();
}, 120_000);

// ---------------------------------------------------------------------------
// 1 · El registro creó lo que tenía que crear, y NADA más
// ---------------------------------------------------------------------------

describe("qué es una interesada en la base", () => {
  it("CONTROL POSITIVO: existe, con su User, su Person y su Interest", async () => {
    // La mitad que hace que las afirmaciones de ausencia de abajo signifiquen
    // algo. Si el registro no hubiera creado nada, "no tiene TripMember" sería
    // cierto por vacío.
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: interesadaEmail },
      select: {
        personId: true,
        person: {
          select: { fullName: true, residenceCountry: true, mobilePhone: true },
        },
        interests: { select: { tripId: true, status: true } },
      },
    });

    expect(user.personId).not.toBeNull();
    expect(user.person?.fullName).toBe(`Lucía ${SUFFIX}`);
    // Los tres campos del formulario público van a Person desde el minuto
    // cero: es lo que hace que convertirla no tenga que copiar nada.
    expect(user.person?.residenceCountry).toBe("Uruguay");
    expect(user.person?.mobilePhone).toBe("+598 99 123 456");
    expect(user.interests).toEqual([{ tripId, status: "REGISTRADA" }]);
  });

  it("NO tiene TripMember, que es de donde sale todo el aislamiento", async () => {
    const memberships = await prisma.tripMember.count({
      where: { userId: interesadaUserId },
    });
    expect(memberships).toBe(0);
  });

  it("NO tiene Passenger, así que no ocupa cupo", async () => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: interesadaUserId },
      select: { personId: true },
    });

    const passengers = await prisma.passenger.count({
      where: { personId: user.personId! },
    });
    expect(passengers).toBe(0);

    // Y el cupo del viaje sigue contando solo pasajeras.
    const [pasajeras, interesadas] = await Promise.all([
      prisma.passenger.count({ where: { tripId, isCoordinator: false } }),
      prisma.interest.count({ where: { tripId } }),
    ]);
    expect(interesadas).toBeGreaterThan(0);
    expect(pasajeras).toBe(1); // solo Ana
  });
});

// ---------------------------------------------------------------------------
// 2 · Una interesada no llega a NADA — por servicio
// ---------------------------------------------------------------------------

describe("aislamiento de la interesada · por servicio", () => {
  beforeEach(() => {
    actAs({ id: interesadaUserId, email: interesadaEmail });
  });

  it("CONTROL POSITIVO: sí ve lo suyo, así que la sesión funciona", async () => {
    // Sin esto, todos los rechazos de abajo podrían deberse a que la sesión
    // no está puesta y no a que el aislamiento funcione.
    const view = await getMyInterestView("es");
    expect(view).not.toBeNull();
    expect(view?.infoForInterested).toBe(`Propuesta pública ${SUFFIX}`);
    expect(view?.status).toBe("REGISTRADA");
  });

  it("su vista NO trae cupos, precios, fechas ni pasajeras", async () => {
    const view = await getMyInterestView("es");

    // La superficie completa son cuatro campos. Que se afirmen las CLAVES y no
    // los valores es a propósito: si alguien agrega `maxPassengers` al select,
    // este test lo ve aunque el valor sea inocente.
    expect(Object.keys(view!).sort()).toEqual([
      "infoForInterested",
      "nextStepMessage",
      "status",
      "tripName",
    ]);
  });

  it("no puede listar las pasajeras del viaje", async () => {
    await expect(listPassengers(tripId)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("no puede leer la ficha de una pasajera, ni pasando el id a mano", async () => {
    // El caso de alguien probando URLs: tiene el id, y aun así no entra.
    await expect(getPassenger(anaPassengerId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("no puede ver el presupuesto ni los costos", async () => {
    await expect(getTripBudget(tripId)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("no puede ver ni el encabezado del viaje", async () => {
    await expect(getTripHeader(tripId)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("no puede ver el estado de pagos", async () => {
    await expect(getTripPaymentsOverview(tripId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("no puede ver el listado de interesadas, ni el suyo propio", async () => {
    // Los datos de contacto de las otras interesadas tampoco son suyos.
    await expect(listInterests(tripId)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("no puede mover su propio estado en el embudo", async () => {
    await expect(
      setInterestStatus(
        (await prisma.interest.findFirstOrThrow({
          where: { userId: interesadaUserId },
          select: { id: true },
        })).id,
        "EN_CONVERSACION",
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("no puede convertirse a sí misma en pasajera", async () => {
    const interest = await prisma.interest.findFirstOrThrow({
      where: { userId: interesadaUserId },
      select: { id: true },
    });
    await expect(
      convertInterestToPassenger(interest.id),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("el punto de entrada la reconoce como SOLO interesada", async () => {
    expect(await viewerIsOnlyInterested()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3 · Una interesada no llega a NADA — por HTTP
// ---------------------------------------------------------------------------

/**
 * Lo mismo, pero atravesando los Route Handlers reales.
 *
 * Existe aparte del bloque de servicios porque son dos superficies distintas:
 * un servicio bien protegido no sirve de nada si una ruta lo saltea. Se
 * importan los handlers y se los invoca con un `Request`, igual que hacen
 * cron.test.ts y payments.test.ts.
 */
describe("aislamiento de la interesada · por HTTP", () => {
  beforeEach(() => {
    actAs({ id: interesadaUserId, email: interesadaEmail });
  });

  it("CONTROL POSITIVO: la coordinadora SÍ descarga la exportación", async () => {
    // Sin esta mitad, un 403 para la interesada podría significar que la ruta
    // está rota para todo el mundo.
    const { GET } = await import("@/app/api/exportaciones/[tripId]/[kind]/route");
    actAs(coordinator);

    const response = await GET(
      new Request(`http://localhost/api/exportaciones/${tripId}/pasajeros`) as never,
      { params: Promise.resolve({ tripId, kind: "pasajeros" }) } as never,
    );

    expect(response.status).toBe(200);
  });

  it("no puede descargar NINGUNA de las tres exportaciones", async () => {
    const { GET } = await import("@/app/api/exportaciones/[tripId]/[kind]/route");
    actAs({ id: interesadaUserId, email: interesadaEmail });

    for (const kind of ["pasajeros", "pagos", "rooming"] as const) {
      const response = await GET(
        new Request(`http://localhost/api/exportaciones/${tripId}/${kind}`) as never,
        { params: Promise.resolve({ tripId, kind }) } as never,
      );

      // 404 y no 403, a propósito: el handler devuelve "no existe" ante un
      // ForbiddenError para no confirmarle a quien prueba ids que el viaje
      // existe. Lo que importa acá es que NO devuelva 200 con el archivo.
      expect(response.status, `la exportación de ${kind} no la rechazó`).toBe(
        404,
      );
    }
  });

  it("tampoco puede sin sesión", async () => {
    const { GET } = await import("@/app/api/exportaciones/[tripId]/[kind]/route");
    actAsAnonymous();

    const response = await GET(
      new Request(`http://localhost/api/exportaciones/${tripId}/pasajeros`) as never,
      { params: Promise.resolve({ tripId, kind: "pasajeros" }) } as never,
    );

    expect(response.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// 4 · Un solo viaje captando a la vez
// ---------------------------------------------------------------------------

describe("como máximo un viaje aceptando interesadas", () => {
  it("CONTROL POSITIVO: el viaje de la suite está captando", async () => {
    const trip = await prisma.trip.findUniqueOrThrow({
      where: { id: tripId },
      select: { acceptingInterest: true },
    });
    expect(trip.acceptingInterest).toBe(true);
  });

  it("abrir un SEGUNDO viaje se rechaza", async () => {
    actAs(coordinator);
    // El coordinador de la suite no es miembro del otro viaje, así que se lo
    // hace admin para que el rechazo venga de la REGLA y no de un permiso.
    await prisma.user.update({
      where: { id: coordinator.id },
      data: { role: "ADMIN" },
    });

    await expect(
      setAcceptingInterest(otroTripId, true),
    ).rejects.toBeInstanceOf(TripStateError);

    await prisma.user.update({
      where: { id: coordinator.id },
      data: { role: "USER" },
    });
  });

  it("el índice de Postgres lo impide aunque se saltee el servicio", async () => {
    // La prueba de que la garantía NO es la validación en código. Se escribe
    // directo contra la base, que es lo que haría una condición de carrera
    // entre dos requests.
    await expect(
      prisma.trip.update({
        where: { id: otroTripId },
        data: { acceptingInterest: true },
      }),
    ).rejects.toThrow();

    const abiertos = await prisma.trip.count({
      where: { acceptingInterest: true },
    });
    expect(abiertos).toBe(1);
  });

  it("cerrando el primero, el segundo puede abrir", async () => {
    // El relevo entre viajes tiene que funcionar: son 2 viajes por año.
    await prisma.trip.update({
      where: { id: tripId },
      data: { acceptingInterest: false },
    });
    await prisma.trip.update({
      where: { id: otroTripId },
      data: { acceptingInterest: true },
    });

    expect(await prisma.trip.count({ where: { acceptingInterest: true } })).toBe(1);

    // Se restaura para los tests que siguen.
    await prisma.trip.update({
      where: { id: otroTripId },
      data: { acceptingInterest: false },
    });
    await prisma.trip.update({
      where: { id: tripId },
      data: { acceptingInterest: true },
    });
  });
});

// ---------------------------------------------------------------------------
// 5 · El registro público
// ---------------------------------------------------------------------------

describe("el registro público", () => {
  beforeEach(async () => {
    actAsAnonymous();
    await clearRateLimits();
  });

  it("sin ningún viaje aceptando, se rechaza y NO crea nada", async () => {
    await prisma.trip.update({
      where: { id: tripId },
      data: { acceptingInterest: false },
    });

    const antes = await prisma.user.count();

    await expect(
      registerInterest({
        fullName: `Nadie ${SUFFIX}`,
        email: email("nadie"),
        password: "una-contrasena-larga",
        residenceCountry: "Chile",
        phone: null,
        locale: "es",
      }),
    ).rejects.toMatchObject({ reason: "SIN_VIAJE_ABIERTO" });

    // Lo que importa no es solo que falle: es que no deje una cuenta a medias.
    expect(await prisma.user.count()).toBe(antes);

    await prisma.trip.update({
      where: { id: tripId },
      data: { acceptingInterest: true },
    });
  });

  it("sin viaje abierto, la página pública tampoco muestra nada", async () => {
    await prisma.trip.update({
      where: { id: tripId },
      data: { acceptingInterest: false },
    });

    expect(await getPublicTrip("es")).toBeNull();

    await prisma.trip.update({
      where: { id: tripId },
      data: { acceptingInterest: true },
    });
  });

  it("un mail ya registrado se rechaza diciéndolo, sin crear nada", async () => {
    const antes = await prisma.user.count();

    await expect(
      registerInterest({
        fullName: `Repetida ${SUFFIX}`,
        email: interesadaEmail,
        password: "una-contrasena-larga",
        residenceCountry: "Uruguay",
        phone: null,
        locale: "es",
      }),
    ).rejects.toMatchObject({ reason: "EMAIL_YA_REGISTRADO" });

    expect(await prisma.user.count()).toBe(antes);
  });

  it("EL FALLO DEL MAIL NO ABORTA EL REGISTRO", async () => {
    // Se rompe el proveedor de mails de verdad, sin mockearlo: con
    // EMAIL_PROVIDER=brevo y sin API key, `getEmailProvider()` tira. Es el
    // camino real de un proveedor caído.
    const previousProvider = process.env["EMAIL_PROVIDER"];
    const previousKey = process.env["BREVO_API_KEY"];
    process.env["EMAIL_PROVIDER"] = "brevo";
    delete process.env["BREVO_API_KEY"];
    resetEmailProvider();

    try {
      const result = await registerInterest({
        fullName: `Sinmail ${SUFFIX}`,
        email: email("sinmail"),
        password: "una-contrasena-larga",
        residenceCountry: "Perú",
        phone: null,
        locale: "es",
      });

      expect(result.interestId).toBeTruthy();

      // Y quedó de verdad en la base, no solo devuelto en memoria.
      const interest = await prisma.interest.findUniqueOrThrow({
        where: { id: result.interestId },
        select: { status: true, user: { select: { email: true } } },
      });
      expect(interest.status).toBe("REGISTRADA");
      expect(interest.user.email).toBe(email("sinmail"));
    } finally {
      if (previousProvider === undefined) delete process.env["EMAIL_PROVIDER"];
      else process.env["EMAIL_PROVIDER"] = previousProvider;
      if (previousKey !== undefined) process.env["BREVO_API_KEY"] = previousKey;
      resetEmailProvider();
    }
  });

  it("si Auth falla, no queda ni Person ni Interest huérfanas", async () => {
    authShouldFail = true;
    const personasAntes = await prisma.person.count();
    const interesesAntes = await prisma.interest.count();

    try {
      await expect(
        registerInterest({
          fullName: `Authroto ${SUFFIX}`,
          email: email("authroto"),
          password: "una-contrasena-larga",
          residenceCountry: "Bolivia",
          phone: null,
          locale: "es",
        }),
      ).rejects.toBeInstanceOf(InterestError);

      // La Person se crea DESPUÉS de Auth justamente por esto.
      expect(await prisma.person.count()).toBe(personasAntes);
      expect(await prisma.interest.count()).toBe(interesesAntes);
    } finally {
      authShouldFail = false;
    }
  });

  it("QUÉ SIGUE llega a los DOS lugares, con el mismo texto", async () => {
    // El requisito: si cierra la pestaña al registrarse, tiene que poder
    // volver y encontrar el número de WhatsApp. Eso solo se cumple si el
    // texto sale por los dos caminos, y son caminos distintos —uno lo
    // devuelve el registro, el otro lo lee la vista permanente—, así que
    // pueden divergir sin que nadie se entere.
    const esperado = `Escribinos por WhatsApp ${SUFFIX}`;

    // 1 · La pantalla inmediata, con lo que devuelve el registro.
    const registro = await registerInterest({
      fullName: `Dosveces ${SUFFIX}`,
      email: email("dosveces"),
      password: "una-contrasena-larga",
      residenceCountry: "Chile",
      phone: null,
      locale: "es",
    });
    expect(registro.nextStepMessage).toBe(esperado);

    // 2 · La vista permanente, al volver más tarde.
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: email("dosveces") },
      select: { id: true },
    });
    actAs({ id: user.id, email: email("dosveces") });

    const vista = await getMyInterestView("es");
    expect(vista?.nextStepMessage).toBe(esperado);

    // Y son EL MISMO texto, no dos que casualmente coinciden hoy.
    expect(vista?.nextStepMessage).toBe(registro.nextStepMessage);
  });

  it("si la escritura falla a mitad, la transacción no deja una Person huérfana", async () => {
    // Se hace fallar `tx.user.create` DESPUÉS de que la Person ya se creó
    // dentro de la transacción: Auth devuelve un id que la tabla local ya
    // tiene, así que choca contra la clave primaria.
    //
    // El mail sí es nuevo, que es lo que hace que el chequeo previo de
    // "¿ya tenés cuenta?" no corte antes y se llegue de verdad a la escritura.
    //
    // Sin la transacción quedaría acá una Person con el nombre y el teléfono
    // de alguien que nunca terminó de registrarse, y nadie que la borre.
    const ocupado = await prisma.user.findFirstOrThrow({ select: { id: true } });
    authFixedId = ocupado.id;

    const personasAntes = await prisma.person.count();

    try {
      await expect(
        registerInterest({
          fullName: `Carrera ${SUFFIX}`,
          email: email("carrera"),
          password: "una-contrasena-larga",
          residenceCountry: "Paraguay",
          phone: "+595 99 000 000",
          locale: "es",
        }),
      ).rejects.toThrow();

      expect(await prisma.person.count()).toBe(personasAntes);
      expect(
        await prisma.person.count({ where: { fullName: `Carrera ${SUFFIX}` } }),
      ).toBe(0);
    } finally {
      authFixedId = null;
    }
  });

  it("el tope por mail corta el reintento sobre la misma casilla", async () => {
    // Tres por hora. Lo que se prueba es que el límite EXISTE y corta, no el
    // número exacto: el número es un fusible y se va a mover.
    const casilla = email("insistente");
    const intento = () =>
      registerInterest({
        fullName: `Insistente ${SUFFIX}`,
        email: casilla,
        password: "una-contrasena-larga",
        residenceCountry: "Chile",
        phone: null,
        locale: "es",
      });

    // 1º: entra. 2º y 3º: rebotan porque el mail ya existe — pero CONSUMEN
    // cupo igual, que es lo que hace que el límite sirva contra el sondeo.
    await intento();
    await expect(intento()).rejects.toMatchObject({
      reason: "EMAIL_YA_REGISTRADO",
    });
    await expect(intento()).rejects.toMatchObject({
      reason: "EMAIL_YA_REGISTRADO",
    });

    // 4º: ya no llega ni a mirar si el mail existe.
    await expect(intento()).rejects.toMatchObject({
      reason: "DEMASIADOS_INTENTOS",
    });
  });
});

// ---------------------------------------------------------------------------
// 6 · La conversión
// ---------------------------------------------------------------------------

describe("convertir una interesada en pasajera", () => {
  let convertibleId: string;
  let convertibleUserId: string;

  beforeEach(async () => {
    actAsAnonymous();
    await clearRateLimits();
  });

  it("la coordinadora ve el listado con los datos de contacto", async () => {
    actAs(coordinator);
    const rows = await listInterests(tripId);

    const lucia = rows.find((row) => row.email === interesadaEmail);
    expect(lucia).toBeDefined();
    expect(lucia?.fullName).toBe(`Lucía ${SUFFIX}`);
    expect(lucia?.residenceCountry).toBe("Uruguay");
    expect(lucia?.phone).toBe("+598 99 123 456");
    expect(lucia?.alreadyPassenger).toBe(false);
  });

  it("convierte: crea Passenger en INVITADO, TripMember y pasa a CONVERTIDA", async () => {
    actAsAnonymous();
    await clearRateLimits();

    const registro = await registerInterest({
      fullName: `Convertible ${SUFFIX}`,
      email: email("convertible"),
      password: "una-contrasena-larga",
      residenceCountry: "Argentina",
      phone: null,
      locale: "es",
    });
    convertibleId = registro.interestId;

    const user = await prisma.user.findUniqueOrThrow({
      where: { email: email("convertible") },
      select: { id: true, personId: true },
    });
    convertibleUserId = user.id;

    // Antes de convertir no tiene acceso a nada.
    expect(
      await prisma.tripMember.count({ where: { userId: convertibleUserId } }),
    ).toBe(0);

    actAs(coordinator);
    const { passengerId } = await convertInterestToPassenger(convertibleId);

    const passenger = await prisma.passenger.findUniqueOrThrow({
      where: { id: passengerId },
      select: { status: true, roomType: true, personId: true, tripId: true },
    });

    expect(passenger.status).toBe("INVITADO");
    // Nace SIN roomType: lo elige ella en su formulario, no la coordinadora
    // al convertir.
    expect(passenger.roomType).toBeNull();
    expect(passenger.tripId).toBe(tripId);
    // Reutiliza la MISMA Person: es el ahorro de haberla creado en el registro.
    expect(passenger.personId).toBe(user.personId);

    const membership = await prisma.tripMember.findUniqueOrThrow({
      where: { tripId_userId: { tripId, userId: convertibleUserId } },
      select: { role: true },
    });
    expect(membership.role).toBe("PASAJERO");

    const interest = await prisma.interest.findUniqueOrThrow({
      where: { id: convertibleId },
      select: { status: true },
    });
    expect(interest.status).toBe("CONVERTIDA");
  });

  it("la conversión queda en AuditLog", async () => {
    const entries = await prisma.auditLog.findMany({
      where: { entity: "Interest", entityId: convertibleId },
      select: { field: true, oldValue: true, newValue: true },
    });

    expect(entries).toContainEqual({
      field: "status",
      oldValue: "REGISTRADA",
      newValue: "CONVERTIDA",
    });
  });

  it("convertir dos veces no duplica el pasajero", async () => {
    actAs(coordinator);
    const antes = await prisma.passenger.count({ where: { tripId } });

    await convertInterestToPassenger(convertibleId);

    expect(await prisma.passenger.count({ where: { tripId } })).toBe(antes);
  });

  it("ya convertida, el punto de entrada la manda al panel de pasajera", async () => {
    // Deja de ser "solo interesada": ahora tiene las dos filas, y manda la de
    // pasajera. Si se preguntara por "¿tiene Interest?" quedaría atrapada en
    // la pantalla de la que ya salió.
    actAs({ id: convertibleUserId, email: email("convertible") });
    expect(await viewerIsOnlyInterested()).toBe(false);
  });

  it("una DESCARTADA no se puede convertir sin cambiarle antes el estado", async () => {
    actAs(coordinator);
    const interest = await prisma.interest.findFirstOrThrow({
      where: { userId: interesadaUserId },
      select: { id: true },
    });

    await setInterestStatus(interest.id, "DESCARTADA");

    await expect(
      convertInterestToPassenger(interest.id),
    ).rejects.toMatchObject({ reason: "NO_CONVERTIBLE" });

    await setInterestStatus(interest.id, "REGISTRADA");
  });

  it("un PASAJERO del viaje no puede tocar el embudo", async () => {
    actAs(ana);
    await expect(listInterests(tripId)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("sin sesión no se llega al embudo", async () => {
    actAsAnonymous();
    await expect(listInterests(tripId)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });
});

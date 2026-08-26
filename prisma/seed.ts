import "dotenv/config";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { createClient } from "@supabase/supabase-js";
import { PrismaClient } from "../src/generated/prisma/client";

/**
 * Datos de ejemplo para poder probar el sistema sin cargar nada a mano.
 *
 * Crea un viaje completo con itinerario, costos y precios; dos coordinadores;
 * y cuatro pasajeros en los cuatro estados posibles, elegidos para que cada
 * uno ejercite una regla distinta:
 *
 *   Ana    CONFIRMADO  datos completos, pasaporte OK, tiene plan de pagos con
 *                      una cuota pagada, una vencida y una pendiente.
 *   Beto   CONFIRMADO  pasaporte en ADVERTENCIA (vence dentro de los 3 meses
 *                      posteriores al regreso), con un pago en revisión.
 *   Carla  REGISTRADO  datos completos pero pasaporte BLOQUEANTE: sirve para
 *                      ver que el sistema NO deja confirmarla.
 *   Diego  INVITADO    datos a medio cargar, en base single.
 *
 * Es idempotente: borra el viaje de ejemplo y lo vuelve a crear.
 *
 * Si hay SUPABASE_SERVICE_ROLE_KEY, además crea los usuarios en Supabase Auth
 * para que se pueda entrar de verdad con estas casillas. Si no la hay, crea
 * solo las filas de la app y avisa.
 */

const SEED_TRIP_ID = "11111111-1111-4111-8111-111111111111";
const SEED_PASSWORD = "viajes-demo-2026";

const connectionString =
  process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"];

if (!connectionString) {
  throw new Error("Falta DATABASE_URL (o DIRECT_URL). Copiá .env.example a .env.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

// Fechas fijas para que el seed sea reproducible.
const TRIP_START = new Date("2027-05-10T00:00:00.000Z");
const TRIP_END = new Date("2027-05-24T00:00:00.000Z");

interface SeedPerson {
  key: string;
  email: string;
  fullName: string;
  passportExpiry: Date | null;
  isCoordinator: boolean;
  admin?: boolean;
  incomplete?: boolean;
  preferredLanguage: "ES" | "EN";
}

const PEOPLE: readonly SeedPerson[] = [
  {
    key: "admin",
    email: "admin@ejemplo.test",
    fullName: "Sofía Admin",
    passportExpiry: new Date("2032-03-01T00:00:00.000Z"),
    isCoordinator: true,
    admin: true,
    preferredLanguage: "ES",
  },
  {
    key: "coord",
    email: "coordinador@ejemplo.test",
    fullName: "Martín Coordinador",
    passportExpiry: new Date("2031-06-20T00:00:00.000Z"),
    isCoordinator: true,
    preferredLanguage: "ES",
  },
  {
    key: "ana",
    email: "ana@ejemplo.test",
    fullName: "Ana Gómez",
    // Muy posterior al viaje → 🟢 OK.
    passportExpiry: new Date("2032-01-01T00:00:00.000Z"),
    isCoordinator: false,
    preferredLanguage: "ES",
  },
  {
    key: "beto",
    email: "beto@ejemplo.test",
    fullName: "Beto Fernández",
    // Vence 15/07/2027: después del viaje (24/05/2027) pero dentro de los
    // 3 meses siguientes (24/08/2027) → 🟡 ADVERTENCIA.
    passportExpiry: new Date("2027-07-15T00:00:00.000Z"),
    isCoordinator: false,
    preferredLanguage: "EN",
  },
  {
    key: "carla",
    email: "carla@ejemplo.test",
    fullName: "Carla Ruiz",
    // Vence 01/05/2027, ANTES de que termine el viaje → 🔴 BLOQUEANTE.
    passportExpiry: new Date("2027-05-01T00:00:00.000Z"),
    isCoordinator: false,
    preferredLanguage: "ES",
  },
  {
    key: "diego",
    email: "diego@ejemplo.test",
    fullName: "Diego Sosa",
    // Todavía no cargó el pasaporte → SIN_DATO, también bloqueante.
    passportExpiry: null,
    isCoordinator: false,
    incomplete: true,
    preferredLanguage: "ES",
  },
];

/**
 * Crea (o reutiliza) el usuario en Supabase Auth y devuelve su uuid.
 * Sin service role key devuelve null y el seed sigue con uuids propios.
 */
async function ensureAuthUser(email: string): Promise<string | null> {
  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !serviceKey) return null;

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: SEED_PASSWORD,
    email_confirm: true,
  });

  if (data?.user) return data.user.id;

  // Si ya existía, lo buscamos en el listado en lugar de fallar.
  if (error) {
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 200 });
    const found = list?.users.find((u) => u.email === email);
    if (found) return found.id;
    console.warn(`  ! No se pudo crear el usuario ${email}: ${error.message}`);
  }
  return null;
}

async function main() {
  console.info("Sembrando datos de ejemplo…\n");

  // ---------------------------------------------------------------- limpieza
  // Borrar el viaje arrastra en cascada itinerario, costos, pasajeros, planes,
  // cuotas, pagos, invitaciones y comunicaciones.
  await prisma.trip.deleteMany({ where: { id: SEED_TRIP_ID } });
  await prisma.person.deleteMany({
    where: { user: { email: { endsWith: "@ejemplo.test" } } },
  });

  // ------------------------------------------------------------------- viaje
  const trip = await prisma.trip.create({
    data: {
      id: SEED_TRIP_ID,
      name: "Londres, París y Roma — mayo 2027",
      startDate: TRIP_START,
      endDate: TRIP_END,
      currency: "GBP",
      minPassengers: 10,
      maxPassengers: 14,
      // Solo pasajeros facturables: los 2 coordinadores NO entran (decisión 1).
      budgetedPassengers: 14,
      coordinatorCount: 2,
      status: "ABIERTO",
      // Costo por pasajero según el motor de cálculo (fase 2):
      //   directo doble  = 1430 (hoteles) + 348 (comidas y eventos) = 1778.00
      //   directo single = 2275 (hoteles) + 348                     = 2623.00
      //   indirectos     = 24100 / 14 = 1721.43 (ROUND_UP)
      //   total doble    = 3499.43   →  precio 3990.00  → margen  490.57
      //   total single   = 4344.43   →  precio 4890.00  → margen  545.57
      priceDouble: "3990.00",
      priceSingle: "4890.00",
      passportValidityMonths: 3,
      // Destino Schengen: activarlo convertiría la advertencia de Beto en
      // bloqueante. Se deja en false para que el seed muestre los dos casos.
      requireFullPassportValidity: false,
      reminderOffsetsDays: [-7, 1],
      stops: {
        create: [
          {
            order: 1,
            city: "Londres",
            country: "Reino Unido",
            fromDate: new Date("2027-05-10T00:00:00.000Z"),
            toDate: new Date("2027-05-14T00:00:00.000Z"),
            accommodations: {
              create: {
                hotelName: "The Bloomsbury Rooms",
                nights: 4,
                pricePerNightDouble: "95.00",
                pricePerNightSingle: "150.00",
              },
            },
          },
          {
            order: 2,
            city: "París",
            country: "Francia",
            fromDate: new Date("2027-05-14T00:00:00.000Z"),
            toDate: new Date("2027-05-19T00:00:00.000Z"),
            accommodations: {
              create: {
                hotelName: "Hôtel Marais Central",
                nights: 5,
                pricePerNightDouble: "110.00",
                pricePerNightSingle: "175.00",
              },
            },
          },
          {
            order: 3,
            city: "Roma",
            country: "Italia",
            fromDate: new Date("2027-05-19T00:00:00.000Z"),
            toDate: new Date("2027-05-24T00:00:00.000Z"),
            accommodations: {
              create: {
                hotelName: "Residenza Trastevere",
                nights: 5,
                pricePerNightDouble: "100.00",
                pricePerNightSingle: "160.00",
              },
            },
          },
        ],
      },
      directCosts: {
        create: [
          { concept: "Cena de bienvenida", amountPerPassenger: "45.00", type: "COMIDA" },
          { concept: "Entradas a museos en Londres", amountPerPassenger: "38.00", type: "EVENTO" },
          { concept: "Tren Londres — París", amountPerPassenger: "85.00", type: "TRANSPORTE" },
          { concept: "Tren París — Roma", amountPerPassenger: "120.00", type: "TRANSPORTE" },
          { concept: "Cena de despedida", amountPerPassenger: "60.00", type: "COMIDA" },
        ],
      },
      indirectCosts: {
        create: [
          { concept: "Charter aéreo grupal", totalAmount: "18200.00", type: "CHARTER" },
          { concept: "Transfers aeropuerto y traslados", totalAmount: "2100.00", type: "TRANSFER" },
          // Va acá y no como costo directo del coordinador: si estuviera en
          // los dos lados se contaría dos veces (decisión 2).
          { concept: "Hospedaje de los 2 coordinadores", totalAmount: "3800.00", type: "HOSPEDAJE_COORDINADOR" },
        ],
      },
    },
  });

  console.info(`  Viaje: ${trip.name}`);

  // ---------------------------------------------------------- habitaciones
  const room101 = await prisma.room.create({
    data: { tripId: trip.id, label: "101" },
  });

  // ------------------------------------------------- personas y pasajeros
  const ids: Record<string, { personId: string; passengerId: string }> = {};
  let authCreated = 0;

  for (const seed of PEOPLE) {
    const authId = await ensureAuthUser(seed.email);
    if (authId) authCreated += 1;

    const person = await prisma.person.create({
      data: {
        fullName: seed.fullName,
        preferredLanguage: seed.preferredLanguage,
        passportExpiryDate: seed.passportExpiry,
        // Diego quedó a mitad del formulario: sirve para ver el % de
        // completitud y el bloqueo de confirmación por datos faltantes.
        ...(seed.incomplete
          ? {
              nationalityCountry: "Argentina",
              mobilePhone: "+54 9 11 5555 1004",
            }
          : {
              nationalityCountry: "Argentina",
              residenceCountry: "Argentina",
              residenceAddress: "Av. Corrientes 1234",
              residenceCity: "Buenos Aires",
              mobilePhone: "+54 9 11 5555 1000",
              documentNumber: "30123456",
              passportNumber: `AAF${Math.floor(100000 + Math.random() * 899999)}`,
              emergencyContactName: "Contacto de emergencia",
              emergencyContactPhone: "+54 9 11 4444 0000",
              medicalAssuranceCompany: "Asistencia Global",
              medicalAssuranceId: "POL-99881",
              medicalAssurancePhone: "+54 11 3333 0000",
              medicalAssuranceEmail: "asistencia@ejemplo.test",
              medicalAssuranceFileId: `${trip.id}/certificados/${seed.key}.pdf`,
              hasDietaryRestrictions: seed.key === "ana",
              dietaryRestrictionsDetail:
                seed.key === "ana" ? "Celíaca: sin TACC." : null,
            }),
      },
    });

    await prisma.user.create({
      data: {
        // Sin Supabase Auth disponible se usa un uuid propio: las filas de la
        // app quedan bien, pero no se puede iniciar sesión con ellas.
        id: authId ?? randomUUID(),
        email: seed.email,
        role: seed.admin ? "ADMIN" : "USER",
        personId: person.id,
      },
    });

    const status = seed.isCoordinator
      ? "CONFIRMADO"
      : seed.key === "ana" || seed.key === "beto"
        ? "CONFIRMADO"
        : seed.key === "carla"
          ? "REGISTRADO"
          : "INVITADO";

    const passenger = await prisma.passenger.create({
      data: {
        tripId: trip.id,
        personId: person.id,
        roomType: seed.key === "diego" ? "SINGLE" : "DOBLE",
        roomId: seed.key === "ana" || seed.key === "beto" ? room101.id : null,
        status,
        isCoordinator: seed.isCoordinator,
      },
    });

    ids[seed.key] = { personId: person.id, passengerId: passenger.id };
  }

  // ------------------------------------------------------- membresías
  const users = await prisma.user.findMany({
    where: { email: { endsWith: "@ejemplo.test" } },
    select: { id: true, email: true },
  });

  for (const user of users) {
    const seed = PEOPLE.find((p) => p.email === user.email);
    if (!seed) continue;
    await prisma.tripMember.create({
      data: {
        tripId: trip.id,
        userId: user.id,
        role: seed.isCoordinator ? "COORDINADOR" : "PASAJERO",
      },
    });
  }

  // -------------------------------------------------------- cotizaciones
  const fxSnapshot = {
    base: "USD",
    date: "2026-08-24",
    rates: { EUR: "0.8571", GBP: "0.7402" },
  };

  await prisma.fxRate.upsert({
    where: {
      date_base: { date: new Date("2026-08-24T00:00:00.000Z"), base: "USD" },
    },
    update: {},
    create: {
      date: new Date("2026-08-24T00:00:00.000Z"),
      base: "USD",
      rates: fxSnapshot.rates,
    },
  });

  // ------------------------------------------------------ planes de pago
  // Ana: 3 cuotas de 1330 → una pagada, una vencida y una pendiente.
  const anaPlan = await prisma.paymentPlan.create({
    data: {
      passengerId: ids["ana"]!.passengerId,
      totalAmount: "3990.00",
      currency: "GBP",
      installmentCount: 3,
      fxSnapshot,
      fxSnapshotDate: new Date("2026-08-24T00:00:00.000Z"),
      installments: {
        create: [
          { number: 1, dueDate: new Date("2026-07-15T00:00:00.000Z"), amount: "1330.00", status: "PAGADA" },
          { number: 2, dueDate: new Date("2026-08-15T00:00:00.000Z"), amount: "1330.00", status: "VENCIDA" },
          { number: 3, dueDate: new Date("2026-11-15T00:00:00.000Z"), amount: "1330.00", status: "PENDIENTE" },
        ],
      },
    },
    include: { installments: { orderBy: { number: "asc" } } },
  });

  const coordUser = users.find((u) => u.email === "coordinador@ejemplo.test");

  await prisma.payment.create({
    data: {
      planId: anaPlan.id,
      installmentId: anaPlan.installments[0]!.id,
      kind: "PAGO",
      amount: "1330.00",
      currency: "GBP",
      amountInTripCurrency: "1330.00",
      method: "Transferencia bancaria",
      proofFileId: `${trip.id}/comprobantes/ana-cuota-1.pdf`,
      status: "CONFIRMADO",
      reviewedById: coordUser?.id ?? null,
      reviewedAt: new Date("2026-07-16T14:20:00.000Z"),
    },
  });

  // Beto: 2 cuotas de 1995 → la primera con un comprobante esperando revisión.
  const betoPlan = await prisma.paymentPlan.create({
    data: {
      passengerId: ids["beto"]!.passengerId,
      totalAmount: "3990.00",
      currency: "GBP",
      installmentCount: 2,
      fxSnapshot,
      fxSnapshotDate: new Date("2026-08-24T00:00:00.000Z"),
      installments: {
        create: [
          { number: 1, dueDate: new Date("2026-08-10T00:00:00.000Z"), amount: "1995.00", status: "EN_REVISION" },
          { number: 2, dueDate: new Date("2026-12-10T00:00:00.000Z"), amount: "1995.00", status: "PENDIENTE" },
        ],
      },
    },
    include: { installments: { orderBy: { number: "asc" } } },
  });

  await prisma.payment.create({
    data: {
      planId: betoPlan.id,
      installmentId: betoPlan.installments[0]!.id,
      kind: "PAGO",
      // Pagó en euros: se registra la moneda y el TC usado, y el sistema
      // imputa el equivalente en la moneda del viaje.
      amount: "2330.00",
      currency: "EUR",
      fxRateUsed: "0.86373391",
      amountInTripCurrency: "2012.50",
      method: "Transferencia bancaria",
      proofFileId: `${trip.id}/comprobantes/beto-cuota-1.pdf`,
      status: "EN_REVISION",
    },
  });

  // Recordatorio ya enviado para la cuota vencida de Ana: el unique compuesto
  // hace que el cron no lo mande dos veces.
  await prisma.sentReminder.create({
    data: {
      installmentId: anaPlan.installments[1]!.id,
      offsetDays: -7,
    },
  });

  // ---------------------------------------------------------- invitación
  // Se guarda el hash, no el token. El link se arma con el token en claro y
  // se manda por mail; en la base no queda nada que sirva para canjearlo.
  const invitationToken = randomBytes(32).toString("base64url");
  await prisma.invitation.create({
    data: {
      tripId: trip.id,
      email: "elena@ejemplo.test",
      tokenHash: createHash("sha256").update(invitationToken).digest("hex"),
      roomType: "DOBLE",
      expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      createdById: coordUser?.id ?? null,
    },
  });

  // ------------------------------------------------------ comunicación
  const communication = await prisma.communication.create({
    data: {
      tripId: trip.id,
      subjectEs: "Ya salieron los horarios de los vuelos",
      bodyEs: "<p>Hola, buenas noticias: ya tenemos los horarios confirmados.</p>",
      subjectEn: "Flight times are confirmed",
      bodyEn: "<p>Hello, good news: we now have the confirmed flight times.</p>",
      audience: "TODOS",
      status: "ENVIADA",
      sentAt: new Date("2026-08-20T10:00:00.000Z"),
      createdById: coordUser?.id ?? null,
    },
  });

  for (const key of ["ana", "beto", "carla"] as const) {
    const person = PEOPLE.find((p) => p.key === key)!;
    await prisma.communicationRecipient.create({
      data: {
        communicationId: communication.id,
        passengerId: ids[key]!.passengerId,
        // El idioma sale de la preferencia de la persona, no del idioma en el
        // que el coordinador escribió: Beto la recibe en inglés.
        lang: person.preferredLanguage,
        status: "ENVIADO",
        sentAt: new Date("2026-08-20T10:00:12.000Z"),
      },
    });
  }

  // --------------------------------------------------------- auditoría
  await prisma.auditLog.create({
    data: {
      actorUserId: coordUser?.id ?? null,
      entity: "Passenger",
      entityId: ids["ana"]!.passengerId,
      field: "status",
      oldValue: "REGISTRADO",
      newValue: "CONFIRMADO",
    },
  });

  // ------------------------------------------------------------ resumen
  console.info(`  Pasajeros: ${PEOPLE.length} (2 coordinadores + 4 pasajeros)`);
  console.info(`  Planes de pago: 2 · Cuotas: 5 · Pagos: 2`);

  if (authCreated === PEOPLE.length) {
    console.info(`\n  Usuarios creados en Supabase Auth. Contraseña: ${SEED_PASSWORD}`);
    for (const p of PEOPLE) {
      const rol = p.admin ? "admin" : p.isCoordinator ? "coordinador" : "pasajero";
      console.info(`    ${p.email.padEnd(26)} ${rol}`);
    }
  } else {
    console.warn(
      "\n  ! Sin SUPABASE_SERVICE_ROLE_KEY no se crearon los usuarios de Auth.",
    );
    console.warn(
      "    Los datos están cargados pero todavía no se puede iniciar sesión.",
    );
    console.warn("    Completá la variable en .env y volvé a correr `npm run db:seed`.");
  }

  console.info("\nListo.\n");
}

main()
  .catch((error) => {
    console.error("El seed falló:", error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

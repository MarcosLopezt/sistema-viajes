import "dotenv/config";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { createClient } from "@supabase/supabase-js";
import { PrismaClient } from "../src/generated/prisma/client";
import { buildStoragePath } from "../src/lib/domain/storage-paths";

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
 * Sube además certificados médicos y comprobantes de pago de verdad al
 * Storage: PDFs mínimos generados por código, no binarios commiteados. Las
 * paths se arman con la MISMA función que usa la aplicación
 * (lib/domain/storage-paths.ts), así el seed no puede divergir de la
 * convención sin que se rompa el build.
 *
 * Es idempotente de los dos lados: borra el viaje de ejemplo y lo vuelve a
 * crear, y borra la carpeta del viaje en el Storage antes de subir nada. Los
 * ids de los pasajeros se regeneran en cada corrida, así que sin ese borrado
 * los archivos de la corrida anterior quedarían huérfanos para siempre.
 *
 * Si hay SUPABASE_SERVICE_ROLE_KEY, además crea los usuarios en Supabase Auth
 * para que se pueda entrar de verdad con estas casillas. Si no la hay, crea
 * solo las filas de la app y avisa.
 */

const SEED_TRIP_ID = "11111111-1111-4111-8111-111111111111";
const SEED_PASSWORD = "viajes-demo-2026";
const STORAGE_BUCKET = process.env["SUPABASE_STORAGE_BUCKET"] ?? "documentos";

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
  birthDate: Date;
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
    birthDate: new Date("1979-02-14T00:00:00.000Z"),
    passportExpiry: new Date("2032-03-01T00:00:00.000Z"),
    isCoordinator: true,
    admin: true,
    preferredLanguage: "ES",
  },
  {
    key: "coord",
    email: "coordinador@ejemplo.test",
    fullName: "Martín Coordinador",
    birthDate: new Date("1982-11-03T00:00:00.000Z"),
    passportExpiry: new Date("2031-06-20T00:00:00.000Z"),
    isCoordinator: true,
    preferredLanguage: "ES",
  },
  {
    key: "ana",
    email: "ana@ejemplo.test",
    fullName: "Ana Gómez",
    birthDate: new Date("1990-06-21T00:00:00.000Z"),
    // Muy posterior al viaje → 🟢 OK.
    passportExpiry: new Date("2032-01-01T00:00:00.000Z"),
    isCoordinator: false,
    preferredLanguage: "ES",
  },
  {
    key: "beto",
    email: "beto@ejemplo.test",
    fullName: "Beto Fernández",
    birthDate: new Date("1988-01-30T00:00:00.000Z"),
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
    birthDate: new Date("1995-09-08T00:00:00.000Z"),
    // Vence 01/05/2027, ANTES de que termine el viaje → 🔴 BLOQUEANTE.
    passportExpiry: new Date("2027-05-01T00:00:00.000Z"),
    isCoordinator: false,
    preferredLanguage: "ES",
  },
  {
    key: "diego",
    email: "diego@ejemplo.test",
    fullName: "Diego Sosa",
    birthDate: new Date("1993-04-17T00:00:00.000Z"),
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

/**
 * Un PDF de una página, armado byte a byte.
 *
 * Se genera por código en vez de commitear binarios al repositorio: un PDF de
 * ejemplo en git es un archivo que nadie revisa, que engorda el historial y
 * que tarde o temprano nadie sabe de dónde salió.
 *
 * Es un PDF de verdad, con su tabla xref y los offsets calculados, así que se
 * abre en el navegador. Uno falso alcanzaría para que el sistema no dé 404,
 * pero al abrirlo se vería el error y la prueba no valdría nada.
 */
function makeMinimalPdf(title: string): Buffer {
  // Los paréntesis y la barra son sintaxis dentro de una cadena PDF.
  const text = title
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/([()\\\\])/g, "\\$1");

  const stream = `BT /F1 14 Tf 60 780 Td (${text}) Tj ET\n`;

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] " +
      "/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
  ];

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  // La tabla xref apunta al byte exacto donde arranca cada objeto: si los
  // offsets no cierran, el lector rechaza el archivo entero.
  const xrefAt = body.length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }

  const trailer =
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${xrefAt}\n%%EOF\n`;

  // latin1 para que un byte del string sea un byte del archivo: los offsets
  // de la xref se calcularon sobre longitudes de string.
  return Buffer.from(body + xref + trailer, "latin1");
}

/** Cliente con service role, o null si no hay key. */
function storageAdmin() {
  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Sube un archivo del seed al bucket. Sin service role key no hace nada. */
async function uploadSeedFile(path: string, title: string): Promise<boolean> {
  const admin = storageAdmin();
  if (!admin) return false;

  const { error } = await admin.storage
    .from(STORAGE_BUCKET)
    .upload(path, makeMinimalPdf(title), {
      contentType: "application/pdf",
      upsert: true,
    });

  if (error) {
    console.warn(`  ! No se pudo subir ${path}: ${error.message}`);
    return false;
  }
  return true;
}

/**
 * Borra TODO lo que cuelga de la carpeta del viaje de ejemplo.
 *
 * Sin esto el seed no sería idempotente del lado del Storage: los ids de los
 * pasajeros se regeneran en cada corrida, así que las paths cambian y los
 * archivos de la corrida anterior quedarían para siempre, sin ninguna fila
 * que los referencie. Se puede borrar la carpeta entera con confianza porque
 * el id del viaje es fijo y es exclusivo del seed.
 */
async function wipeSeedStorage(): Promise<number> {
  const admin = storageAdmin();
  if (!admin) return 0;

  const paths: string[] = [];
  const { data: folders } = await admin.storage
    .from(STORAGE_BUCKET)
    .list(SEED_TRIP_ID);

  for (const folder of folders ?? []) {
    // list() marca las carpetas devolviéndolas con id null.
    if (folder.id !== null) {
      paths.push(`${SEED_TRIP_ID}/${folder.name}`);
      continue;
    }
    const { data: files } = await admin.storage
      .from(STORAGE_BUCKET)
      .list(`${SEED_TRIP_ID}/${folder.name}`);
    for (const file of files ?? []) {
      paths.push(`${SEED_TRIP_ID}/${folder.name}/${file.name}`);
    }
  }

  if (paths.length > 0) await admin.storage.from(STORAGE_BUCKET).remove(paths);
  return paths.length;
}

async function main() {
  console.info("Sembrando datos de ejemplo…\n");

  // ---------------------------------------------------------------- limpieza
  // Borrar el viaje arrastra en cascada itinerario, costos, pasajeros, planes,
  // cuotas, pagos, invitaciones y comunicaciones.
  await prisma.trip.deleteMany({ where: { id: SEED_TRIP_ID } });

  // Y los archivos, que no cuelgan de ninguna cascada: viven en otro sistema.
  const wiped = await wipeSeedStorage();
  if (wiped > 0) console.info(`  Storage: ${wiped} archivo(s) de la corrida anterior`);

  // Los User se borran ANTES que las Person y por su propio email.
  //
  // User.personId es onDelete: SetNull, así que borrar la Person deja viva la
  // fila de User con personId en null — y como User.email es unique, la
  // siembra siguiente moría con una violación de unicidad. Además, después de
  // borrar los User el filtro `where: { user: ... }` de Person ya no matchea
  // nada, así que hay que quedarse con los ids primero.
  const seedUsers = await prisma.user.findMany({
    where: { email: { endsWith: "@ejemplo.test" } },
    select: { id: true, personId: true },
  });
  const seedPersonIds = seedUsers
    .map((u) => u.personId)
    .filter((id): id is string => id !== null);

  await prisma.user.deleteMany({
    where: { id: { in: seedUsers.map((u) => u.id) } },
  });
  await prisma.person.deleteMany({ where: { id: { in: seedPersonIds } } });

  // Y las Person que quedaron huérfanas de corridas anteriores.
  //
  // La limpieza de arriba solo alcanza a las Person que un User referencia.
  // Si en alguna corrida ese vínculo se rompió —el User se creó con otro id,
  // o falló entre una cosa y la otra— la Person quedó sin nadie que la
  // borrara, y se acumulaba una por cada vez que pasara.
  //
  // Las tres condiciones juntas identifican residuo del seed sin ambigüedad:
  // sin usuario, sin ningún pasajero, y con uno de los nombres de PEOPLE.
  // Una persona real que compartiera nombre con el seed tendría usuario o
  // pasajero, así que no la alcanza.
  const orphans = await prisma.person.deleteMany({
    where: {
      user: null,
      passengers: { none: {} },
      fullName: { in: PEOPLE.map((seed) => seed.fullName) },
    },
  });
  if (orphans.count > 0) {
    console.info(`  Limpieza: ${orphans.count} persona(s) huérfana(s) de corridas anteriores`);
  }

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

      // ------------------------------------------------- zona pública (fase 7)
      //
      // El viaje del seed capta interesadas: es el único, así que respeta el
      // índice único parcial que impide que haya dos.
      //
      // Los textos son de EJEMPLO y están escritos como los escribirían las
      // coordinadoras, no como los escribiría el sistema. Existen para que la
      // pantalla pública se pueda mirar de verdad; la voz de marca real la
      // cargan ellas desde el paso 6 del wizard.
      acceptingInterest: true,
      infoForInterestedEs:
        "Un viaje de catorce días por Londres, París y Roma, en grupo reducido y con acompañamiento en cada tramo.\n\n" +
        "Salimos el 10 de mayo de 2027 y volvemos el 24. Somos como máximo catorce viajeras más las dos coordinadoras.\n\n" +
        "El itinerario día por día está acá: https://www.canva.com/design/ejemplo-itinerario",
      infoForInterestedEn:
        "A fourteen-day journey through London, Paris and Rome, in a small group and accompanied at every stage.\n\n" +
        "We leave on 10 May 2027 and return on the 24th. There are fourteen travellers at most, plus the two coordinators.\n\n" +
        "The day-by-day itinerary is here: https://www.canva.com/design/ejemplo-itinerario",
      welcomeMessageEs:
        "Gracias por escribirnos. Nos alegra mucho que quieras venir.",
      welcomeMessageEn:
        "Thank you for getting in touch. We're so glad you want to come.",
      nextStepMessageEs:
        "Escribinos por WhatsApp al +54 9 11 5555 0000 y coordinamos una charla por Zoom, sin compromiso, para contarte todo y conocernos.",
      nextStepMessageEn:
        "Send us a WhatsApp on +54 9 11 5555 0000 and we'll arrange a Zoom chat, with no commitment, to tell you everything and get to know each other.",
      emailSignatureEs: "En la Lux de Alba, Laura y Lorena",
      emailSignatureEn: "En la Lux de Alba, Laura y Lorena",
      closedMessageEs:
        "Ahora mismo no tenemos ningún viaje abierto. Estamos preparando el próximo: escribinos y te avisamos cuando abramos las inscripciones.",
      closedMessageEn:
        "We don't have a trip open right now. We're preparing the next one: write to us and we'll let you know when sign-ups open.",
      // La seña. El monto es plata y se carga en el paso 5; la condición y las
      // instrucciones son textos de marca del paso 6. Igual que los de arriba,
      // son de EJEMPLO: sin ellos la pantalla de la seña no aparece y no se
      // puede mirar en desarrollo.
      depositAmount: "500.00",
      depositTermsEs:
        "La seña de £500 reserva tu lugar en el viaje y NO es reembolsable.\n\n" +
        "La única excepción es que el viaje se cancele por decisión de las coordinadoras: en ese caso te devolvemos el total.\n\n" +
        "Si más adelante decidís no viajar, la seña no se devuelve y no se transfiere a otro viaje.",
      depositTermsEn:
        "The £500 deposit reserves your place on the trip and is NOT refundable.\n\n" +
        "The only exception is if the trip is cancelled by decision of the coordinators: in that case we refund the full amount.\n\n" +
        "If you later decide not to travel, the deposit is not returned and is not transferred to another trip.",
      paymentInstructionsEs:
        "Escribinos por WhatsApp antes de transferir: la cuenta cambia según el país desde el que pagues.\n\n" +
        "Cuando la acordemos, subí el comprobante desde esta misma pantalla.",
      paymentInstructionsEn:
        "Message us on WhatsApp before transferring: the account depends on the country you're paying from.\n\n" +
        "Once we've agreed on it, upload the receipt from this same screen.",
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
        birthDate: seed.birthDate,
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
              // País emisor del pasaporte: distinto de la nacionalidad en el
              // caso de Beto, que es justamente por lo que el campo existe.
              passportIssuingCountry:
                seed.key === "beto" ? "Italia" : "Argentina",
              residenceCountry: "Argentina",
              residenceAddress: "Av. Corrientes 1234",
              residenceCity: "Buenos Aires",
              mobilePhone: "+54 9 11 5555 1000",
              documentNumber: "30123456",
              passportNumber: `AAF${Math.floor(100000 + Math.random() * 899999)}`,
              profession: seed.isCoordinator ? "Coordinadora de viajes" : null,
              emergencyContactName: "Contacto de emergencia",
              emergencyContactRelationship: "Hermana",
              emergencyContactPhone: "+54 9 11 4444 0000",
              medicalAssuranceCompany: "Asistencia Global",
              medicalAssuranceId: "POL-99881",
              medicalAssurancePhone: "+54 11 3333 0000",
              medicalAssuranceEmail: "asistencia@ejemplo.test",
              hasDietaryRestrictions: seed.key === "ana",
              dietaryRestrictionsDetail:
                seed.key === "ana" ? "Celíaca: sin TACC." : null,
              // Carla declara ansiedad: es el ÚNICO dato sensible sembrado, y
              // existe para que el test de exportaciones tenga algo real que
              // buscar. Un test que revisa que un campo vacío no aparezca en
              // una planilla no prueba nada.
              anxietyOrPanic: seed.key === "carla",
              anxietyOrPanicDetail:
                seed.key === "carla"
                  ? "Episodios ocasionales en vuelos largos."
                  : null,
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

    // El objeto se sube ANTES de escribir la path en la fila: si la subida
    // falla, la fila queda sin certificado en vez de con uno que no existe.
    // Usa la MISMA función que storage.ts para construir la path, así el seed
    // no puede divergir de la convención sin que se rompa el build.
    //
    // La carpeta lleva el personId, no el passengerId (ver storage-paths.ts).
    if (!seed.incomplete) {
      const certificatePath = buildStoragePath(
        trip.id,
        person.id,
        "cobertura-medica",
        `seed-${seed.key}`,
        "pdf",
      );

      const uploaded = await uploadSeedFile(
        certificatePath,
        `Cobertura medica de ejemplo - ${seed.fullName}`,
      );

      // Si no hay service role key no se sube nada, y entonces tampoco se
      // escribe la path: una fila apuntando a un objeto inexistente es
      // exactamente el estado inconsistente que este cambio vino a sacar.
      if (uploaded) {
        await prisma.person.update({
          where: { id: person.id },
          data: { medicalAssuranceFileId: certificatePath },
        });
      }
    }
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
      // Sin columna de estado: PAGADA / VENCIDA / PENDIENTE se derivan de
      // estos vencimientos y de los pagos de abajo. La cuota 1 tiene pago
      // confirmado, la 2 venció sin pagarse y la 3 todavía no vence.
      installments: {
        create: [
          { number: 1, dueDate: new Date("2026-07-15T00:00:00.000Z"), amount: "1330.00" },
          { number: 2, dueDate: new Date("2026-08-15T00:00:00.000Z"), amount: "1330.00" },
          { number: 3, dueDate: new Date("2026-11-15T00:00:00.000Z"), amount: "1330.00" },
        ],
      },
    },
    include: { installments: { orderBy: { number: "asc" } } },
  });

  const coordUser = users.find((u) => u.email === "coordinador@ejemplo.test");

  // Comprobantes: misma función que usa storage.ts para armar la path, y el
  // archivo se sube ANTES de crear la fila. Si la subida falla, la fila se
  // crea sin comprobante en vez de con uno que no existe.
  const anaProofPath = buildStoragePath(
    trip.id,
    ids["ana"]!.personId,
    "comprobante-pago",
    "seed-ana-1",
    "pdf",
  );
  const betoProofPath = buildStoragePath(
    trip.id,
    ids["beto"]!.personId,
    "comprobante-pago",
    "seed-beto-1",
    "pdf",
  );

  const anaProofOk = await uploadSeedFile(
    anaProofPath,
    "Comprobante de transferencia - Ana Gomez - cuota 1",
  );
  const betoProofOk = await uploadSeedFile(
    betoProofPath,
    "Comprobante de transferencia - Beto Fernandez - cuota 1",
  );

  await prisma.payment.create({
    data: {
      planId: anaPlan.id,
      installmentId: anaPlan.installments[0]!.id,
      kind: "PAGO",
      amount: "1330.00",
      currency: "GBP",
      amountInTripCurrency: "1330.00",
      transferDate: new Date("2026-07-14T00:00:00.000Z"),
      method: "TRANSFERENCIA",
      proofFileId: anaProofOk ? anaProofPath : null,
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
          { number: 1, dueDate: new Date("2026-08-10T00:00:00.000Z"), amount: "1995.00" },
          { number: 2, dueDate: new Date("2026-12-10T00:00:00.000Z"), amount: "1995.00" },
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
      transferDate: new Date("2026-08-09T00:00:00.000Z"),
      method: "TRANSFERENCIA",
      proofFileId: betoProofOk ? betoProofPath : null,
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

  // ------------------------------------------------------- interesadas
  //
  // Dos interesadas, en dos puntos distintos del embudo, para que la pantalla
  // de la coordinadora muestre algo real.
  //
  // Lo que hay que mirar en estas filas: NO tienen TripMember. Esa ausencia es
  // el mecanismo entero de aislamiento — sin fila en esa tabla, todos los
  // guards del sistema les dicen que no sin una sola regla nueva. Tampoco
  // ocupan cupo: los 14 lugares los cuentan los Passenger.
  for (const seed of [
    {
      email: "lucia@ejemplo.test",
      fullName: "Lucía Méndez",
      country: "Uruguay",
      phone: "+598 99 123 456",
      status: "REGISTRADA" as const,
      meetingDone: false,
      notes: null,
      deposit: null,
    },
    {
      email: "paula@ejemplo.test",
      fullName: "Paula Ortiz",
      country: "Argentina",
      // Sin teléfono: es opcional en el formulario público y la pantalla
      // tiene que resolver bien ese caso.
      phone: null,
      status: "EN_CONVERSACION" as const,
      meetingDone: true,
      notes: "Tuvimos el Zoom el 12/08. Quiere venir con una amiga.",
      // Cinco días esperando: el contador de la cola sale en ámbar, que es
      // justo el tramo que hay que poder ver sin esperar cinco días.
      deposit: { daysAgo: 5 },
    },
  ]) {
    const authId = await ensureAuthUser(seed.email);

    // La Person se crea con los tres campos del formulario público y NADA
    // más. Es exactamente el estado en el que queda alguien que se anotó: si
    // la convierten, completa el resto en el formulario de 3 pasos.
    const person = await prisma.person.create({
      data: {
        fullName: seed.fullName,
        residenceCountry: seed.country,
        mobilePhone: seed.phone,
        preferredLanguage: "ES",
      },
    });

    const user = await prisma.user.create({
      data: {
        id: authId ?? randomUUID(),
        email: seed.email,
        role: "USER",
        personId: person.id,
      },
    });

    const interest = await prisma.interest.create({
      data: {
        userId: user.id,
        tripId: trip.id,
        status: seed.status,
        meetingDone: seed.meetingDone,
        notes: seed.notes,
      },
    });

    // Paula ya transfirió y está esperando que la revisen. Es lo que hace que
    // la cola de señas de la coordinadora muestre algo, incluido el contador
    // de días de espera — por eso la fecha de creación se pisa hacia atrás.
    //
    // El comprobante se sube ANTES de escribir la fila y con la MISMA función
    // de paths que usa producción: la carpeta va por personId, que es lo que
    // hace que el archivo no se mueva cuando la conviertan en pasajera.
    if (seed.deposit) {
      const proofPath = buildStoragePath(
        trip.id,
        person.id,
        "comprobante-pago",
        `seed-sena-${seed.email.split("@")[0]}`,
        "pdf",
      );

      const uploaded = await uploadSeedFile(
        proofPath,
        `Comprobante de sena - ${seed.fullName}`,
      );

      if (uploaded) {
        const hace = new Date(Date.now() - seed.deposit.daysAgo * 86_400_000);

        await prisma.depositProof.create({
          data: {
            interestId: interest.id,
            amount: "500.00",
            currency: "GBP",
            amountInTripCurrency: "500.00",
            transferDate: new Date("2026-08-28T00:00:00.000Z"),
            proofFileId: proofPath,
            // El texto que se le mostró ese día, copiado. Si las
            // coordinadoras editan la condición, esta fila no se entera: es
            // el registro de qué aceptó, no un puntero al texto vigente.
            acceptedTermsText:
              "La seña de £500 reserva tu lugar en el viaje y NO es reembolsable.\n\n" +
              "La única excepción es que el viaje se cancele por decisión de las coordinadoras: en ese caso te devolvemos el total.\n\n" +
              "Si más adelante decidís no viajar, la seña no se devuelve y no se transfiere a otro viaje.",
            acceptedTermsLang: "ES",
            acceptedAt: hace,
            shownAmount: "500.00",
            shownCurrency: "GBP",
            status: "EN_REVISION",
            createdAt: hace,
          },
        });
      }
    }
  }

  // ------------------------------------------------------ comunicación
  const communication = await prisma.communication.create({
    data: {
      tripId: trip.id,
      // El cuerpo es TEXTO PLANO, no HTML: lo escribe el coordinador en un
      // textarea y la plantilla lo escapa antes de meterlo en el mail. Los
      // saltos de línea se respetan; el marcado se muestra literal.
      subjectEs: "Ya salieron los horarios de los vuelos",
      bodyEs:
        "Hola a todos.\n\nBuenas noticias: ya tenemos los horarios confirmados. Salimos el 10 de mayo a las 22:15 y volvemos el 24 por la mañana.\n\nCualquier cosa, respondan este mail.",
      subjectEn: "Flight times are confirmed",
      bodyEn:
        "Hello everyone.\n\nGood news: the flight times are confirmed. We leave on 10 May at 22:15 and return on the morning of the 24th.\n\nIf anything is unclear, just reply to this email.",
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
  console.info(`  Interesadas: 2 (sin TripMember, no ocupan cupo)`);

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

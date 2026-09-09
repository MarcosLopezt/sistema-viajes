import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { actAs, actAsAnonymous } from "./setup";

/**
 * El aislamiento de la seña, contra la base REAL.
 *
 * ── Por qué el fixture está CARGADO de datos ──────────────────────────────
 *
 * Porque un test de aislamiento sobre una base casi vacía no prueba
 * aislamiento: prueba que no hay nada que ver. Si Vera es la única interesada
 * del viaje, "Vera no ve el comprobante de otra" pasa en verde con un `where`
 * roto, con un `where` vacío y hasta sin `where`.
 *
 * Entonces acá hay DOS interesadas con seña subida en el mismo viaje, una
 * tercera en otro viaje, y una coordinadora por viaje. Cada negación se prueba
 * junto a su afirmación: que Vera NO llegue al comprobante de Nadia significa
 * algo solo si en el mismo test Vera SÍ llega al suyo. Si las dos dieran 404,
 * la mitad negativa estaría pasando por la razón equivocada.
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
const { ForbiddenError } = await import("@/lib/auth/errors");
const {
  confirmDepositAndConvert,
  getDepositProofUrl,
  getMyDepositView,
  listPendingDeposits,
  rejectDeposit,
  submitDeposit,
  DepositError,
} = await import("@/lib/services/deposits");
const { createSignedUploadForInterest } = await import(
  "@/lib/services/storage"
);
const { registerInterest } = await import("@/lib/services/interest");

const SUFFIX = randomUUID().slice(0, 8);
const email = (name: string) => `${name}-aisl-${SUFFIX}@test.invalid`;

const TERMS_V1 =
  "La seña no es reembolsable, salvo que el viaje se cancele por decisión de las coordinadoras.";
const TERMS_V2 =
  "CONDICIONES NUEVAS: la seña no se devuelve bajo ninguna circunstancia.";

interface Actor {
  id: string;
  email: string;
  personId: string;
}

let tripAbierto: string;
let tripOtro: string;
let coty: Actor;
let otto: Actor;
/** Dos interesadas del MISMO viaje. La comparación que importa. */
let vera: Actor;
let nadia: Actor;
/** Interesada de otro viaje, que además no está captando. */
let lena: Actor;

let veraInterest: string;
let nadiaInterest: string;
let lenaInterest: string;

/**
 * Quien tenia el candado global de captacion antes de este archivo.
 *
 * Como maximo UN viaje puede tener acceptingInterest, y lo hace cumplir un
 * indice de Postgres. El seed ya deja uno abierto, asi que hay que sacarselo
 * para poder abrir el nuestro y devolverselo al final. Mismo procedimiento
 * que interest.test.ts.
 */
let previouslyAccepting: string | null = null;

async function createActor(name: string): Promise<Actor> {
  const person = await prisma.person.create({
    data: { fullName: `${name} ${SUFFIX}`, preferredLanguage: "ES" },
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

async function createTrip(name: string, accepting: boolean): Promise<string> {
  const trip = await prisma.trip.create({
    data: {
      name: `${name} ${SUFFIX}`,
      startDate: new Date("2027-09-10T00:00:00.000Z"),
      endDate: new Date("2027-09-24T00:00:00.000Z"),
      currency: "GBP",
      minPassengers: 10,
      maxPassengers: 14,
      budgetedPassengers: 14,
      status: "ABIERTO",
      priceDouble: "3499.43",
      priceSingle: "4890.00",
      depositAmount: "500.00",
      depositTermsEs: TERMS_V1,
      acceptingInterest: accepting,
    },
    select: { id: true },
  });
  return trip.id;
}

/** Sube el comprobante y lo declara, como lo haría ella desde el teléfono. */
async function subir(actor: Actor, terms = TERMS_V1) {
  actAs(actor);
  const upload = await createSignedUploadForInterest(
    "comprobante-pago",
    "application/pdf",
    1024,
  );
  return submitDeposit(
    {
      amount: "500.00",
      currency: "GBP",
      transferDate: "2027-02-10",
      proofFileId: upload.path,
      acceptedTermsText: terms,
      acceptsTerms: true,
    },
    "es",
  );
}

beforeAll(async () => {
  coty = await createActor("coty");
  otto = await createActor("otto");
  vera = await createActor("vera");
  nadia = await createActor("nadia");
  lena = await createActor("lena");

  // El candado global de captación, prestado. Ver `previouslyAccepting`.
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

  // Solo UNO puede tener acceptingInterest: lo garantiza el índice parcial de
  // la fase 7, así que el segundo viaje nace cerrado por construcción.
  tripAbierto = await createTrip("Abierto", true);
  tripOtro = await createTrip("Cerrado", false);

  await prisma.tripMember.create({
    data: { tripId: tripAbierto, userId: coty.id, role: "COORDINADOR" },
  });
  await prisma.tripMember.create({
    data: { tripId: tripOtro, userId: otto.id, role: "COORDINADOR" },
  });

  veraInterest = (
    await prisma.interest.create({
      data: { userId: vera.id, tripId: tripAbierto, status: "REGISTRADA" },
      select: { id: true },
    })
  ).id;
  nadiaInterest = (
    await prisma.interest.create({
      data: { userId: nadia.id, tripId: tripAbierto, status: "REGISTRADA" },
      select: { id: true },
    })
  ).id;
  lenaInterest = (
    await prisma.interest.create({
      data: { userId: lena.id, tripId: tripOtro, status: "REGISTRADA" },
      select: { id: true },
    })
  ).id;

  const today = new Date();
  const date = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  await prisma.fxRate.upsert({
    where: { date_base: { date, base: "USD" } },
    update: {},
    create: {
      date,
      base: "USD",
      rates: { EUR: "0.9", GBP: "0.8" },
      fetchedAt: new Date(),
    },
  });
}, 120_000);

afterAll(async () => {
  await prisma.trip
    .deleteMany({ where: { id: { in: [tripAbierto, tripOtro] } } })
    .catch(() => {});

  // Se devuelve el candado global a quien lo tenía, o el seed queda cerrado.
  if (previouslyAccepting) {
    await prisma.trip
      .update({
        where: { id: previouslyAccepting },
        data: { acceptingInterest: true },
      })
      .catch(() => {});
  }
  await prisma.user
    .deleteMany({
      where: { id: { in: [coty.id, otto.id, vera.id, nadia.id, lena.id] } },
    })
    .catch(() => {});
  await prisma.person
    .deleteMany({
      where: {
        id: {
          in: [
            coty.personId,
            otto.personId,
            vera.personId,
            nadia.personId,
            lena.personId,
          ],
        },
      },
    })
    .catch(() => {});
  await disconnectDb();
});

/** Deja el viaje sin señas y con las condiciones originales. */
beforeEach(async () => {
  await prisma.depositProof.deleteMany({
    where: { interestId: { in: [veraInterest, nadiaInterest, lenaInterest] } },
  });
  await prisma.passenger.deleteMany({
    where: {
      OR: [
        {
          tripId: tripAbierto,
          personId: { in: [vera.personId, nadia.personId] },
        },
        { tripId: tripOtro, personId: lena.personId },
      ],
    },
  });
  await prisma.tripMember.deleteMany({
    where: {
      OR: [
        { tripId: tripAbierto, userId: { in: [vera.id, nadia.id] } },
        { tripId: tripOtro, userId: lena.id },
      ],
    },
  });
  await prisma.interest.updateMany({
    where: { id: { in: [veraInterest, nadiaInterest, lenaInterest] } },
    data: { status: "REGISTRADA" },
  });
  await prisma.trip.update({
    where: { id: tripAbierto },
    data: { depositTermsEs: TERMS_V1, depositTermsEn: null },
  });
});

// ---------------------------------------------------------------------------

describe("una interesada no ve ni descarga el comprobante de otra", () => {
  it("Vera abre el suyo y NO el de Nadia", async () => {
    const { depositId: deVera } = await subir(vera);
    const { depositId: deNadia } = await subir(nadia);

    // La mitad POSITIVA, primero: sin esto, el 404 de abajo no significa nada.
    actAs(vera);
    const url = await getDepositProofUrl(deVera);
    expect(url).toContain("bucket.test");
    // Y la path firmada es la de SU carpeta, no la de Nadia.
    expect(storageState.signed.at(-1)).toContain(`/${vera.personId}/`);
    expect(storageState.signed.at(-1)).not.toContain(nadia.personId);

    // La mitad negativa. Es un ForbiddenError, que el Route Handler traduce a
    // 404: confirmarle que esa seña existe ya sería información.
    await expect(getDepositProofUrl(deNadia)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("la coordinadora del viaje abre las dos; la del otro viaje, ninguna", async () => {
    const { depositId: deVera } = await subir(vera);

    actAs(coty);
    await expect(getDepositProofUrl(deVera)).resolves.toContain("bucket.test");

    // Otto coordina el OTRO viaje. Ser coordinador no es una llave maestra.
    actAs(otto);
    await expect(getDepositProofUrl(deVera)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("sin sesión no se abre ningún comprobante", async () => {
    const { depositId } = await subir(vera);

    actAsAnonymous();
    await expect(getDepositProofUrl(depositId)).rejects.toBeTruthy();
  });

  it("la cola de la coordinadora trae su viaje y nada más", async () => {
    await subir(vera);
    await subir(nadia);

    actAs(coty);
    const cola = await listPendingDeposits(tripAbierto);

    // Positiva: están las dos, con nombre y monto.
    expect(cola).toHaveLength(2);
    expect(cola.map((d) => d.email).sort()).toEqual(
      [email("nadia"), email("vera")].sort(),
    );

    // Negativa: Otto no puede leer la cola de un viaje que no coordina.
    actAs(otto);
    await expect(listPendingDeposits(tripAbierto)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("una interesada no puede leer la cola de revisión", async () => {
    await subir(vera);

    actAs(vera);
    await expect(listPendingDeposits(tripAbierto)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe("cerrar la captación no traba a quien ya está en el embudo", () => {
  /**
   * La regla, en dos preguntas que NO son la misma:
   *
   *   · quién ENTRA al embudo      → lo controla acceptingInterest
   *   · quién COMPLETA el que empezó → no lo controla acceptingInterest
   *
   * El flujo real las separa: se registra, coordinan el Zoom por WhatsApp, la
   * reunión es dos semanas después, y recién ahí paga. Con catorce lugares las
   * coordinadoras van a cerrar la captación con gente todavía a mitad de
   * camino, así que esto es el caso normal y no un borde.
   */

  it("con la captación CERRADA, una interesada ya registrada SÍ puede subir", async () => {
    // Lena está anotada en un viaje con acceptingInterest en false. Es
    // exactamente el caso del párrafo de arriba.
    actAs(lena);

    const upload = await createSignedUploadForInterest(
      "comprobante-pago",
      "application/pdf",
      1024,
    );
    expect(upload.path).toContain(`${tripOtro}/${lena.personId}/`);

    await expect(
      submitDeposit(
        {
          amount: "500.00",
          currency: "GBP",
          transferDate: "2027-02-10",
          proofFileId: upload.path,
          acceptedTermsText: TERMS_V1,
          acceptsTerms: true,
        },
        "es",
      ),
    ).resolves.toBeTruthy();
  });

  it("alguien SIN Interest previa no puede subir, aunque tenga sesión", async () => {
    // Coty tiene cuenta, tiene Person y coordina el viaje. Lo único que no
    // tiene es una Interest, y eso alcanza para cerrar la puerta: el guard no
    // encuentra contra qué anotarla.
    actAs(coty);
    await expect(
      createSignedUploadForInterest("comprobante-pago", "application/pdf", 1024),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      submitDeposit(
        {
          amount: "500.00",
          currency: "GBP",
          transferDate: "2027-02-10",
          proofFileId: `${tripAbierto}/${coty.personId}/comprobante-pago-x.pdf`,
          acceptedTermsText: TERMS_V1,
          acceptsTerms: true,
        },
        "es",
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("alguien SIN Interest previa tampoco puede registrarse con todo cerrado", async () => {
    // La otra mitad, y la que hace que la primera no sea un agujero: la puerta
    // de ENTRADA sigue exigiendo acceptingInterest. Se cierra la captación del
    // único viaje que la tenía y no queda ninguno abierto.
    await prisma.trip.update({
      where: { id: tripAbierto },
      data: { acceptingInterest: false },
    });

    try {
      await expect(
        registerInterest({
          fullName: `Intrusa ${SUFFIX}`,
          email: email("intrusa"),
          password: "una-contrasena-larga",
          residenceCountry: "Argentina",
          phone: null,
          locale: "es",
        }),
      ).rejects.toMatchObject({ reason: "SIN_VIAJE_ABIERTO" });

      // Y no se creó ninguna cuenta: el chequeo del viaje va ANTES de tocar
      // Auth, así que no queda un usuario huérfano de un registro que falló.
      const creada = await prisma.user.count({
        where: { email: email("intrusa") },
      });
      expect(creada).toBe(0);
    } finally {
      await prisma.trip.update({
        where: { id: tripAbierto },
        data: { acceptingInterest: true },
      });
    }
  });

  it("una interesada DESCARTADA no puede subir", async () => {
    // "Descartada" es "no sigue". Quien no sigue no manda plata.
    await prisma.interest.update({
      where: { id: veraInterest },
      data: { status: "DESCARTADA" },
    });

    try {
      actAs(vera);
      await expect(
        createSignedUploadForInterest(
          "comprobante-pago",
          "application/pdf",
          1024,
        ),
      ).rejects.toBeInstanceOf(ForbiddenError);
    } finally {
      await prisma.interest.update({
        where: { id: veraInterest },
        data: { status: "REGISTRADA" },
      });
    }
  });

  it("con el viaje FINALIZADO no se cobra más", async () => {
    // ABIERTO y CERRADO admiten cobrar; FINALIZADO ya pasó. La positiva de
    // control es el primer test de este bloque: con el viaje ABIERTO y la
    // captación cerrada, Lena sí puede.
    await prisma.trip.update({
      where: { id: tripOtro },
      data: { status: "FINALIZADO" },
    });

    try {
      actAs(lena);
      await expect(
        createSignedUploadForInterest(
          "comprobante-pago",
          "application/pdf",
          1024,
        ),
      ).rejects.toBeInstanceOf(ForbiddenError);
    } finally {
      await prisma.trip.update({
        where: { id: tripOtro },
        data: { status: "ABIERTO" },
      });
    }
  });
});

describe("una seña vigente por interesada · el índice parcial", () => {
  it("la segunda subida choca mientras la primera está en revisión", async () => {
    await subir(vera);

    await expect(subir(vera)).rejects.toMatchObject({
      reason: "YA_HAY_UNA_VIGENTE",
    });
    await expect(subir(vera)).rejects.toBeInstanceOf(DepositError);

    // Y no quedó una fila a medias: sigue habiendo exactamente una.
    const total = await prisma.depositProof.count({
      where: { interestId: veraInterest },
    });
    expect(total).toBe(1);
  });

  it("después de un rechazo SÍ puede volver a subir, y las dos filas quedan", async () => {
    const { depositId } = await subir(vera);

    actAs(coty);
    await rejectDeposit({
      depositId,
      reason: "El comprobante está cortado y no se lee el importe.",
    });

    // La vigente se liberó: el índice es parcial, no absoluto.
    await expect(subir(vera)).resolves.toBeTruthy();

    const filas = await prisma.depositProof.findMany({
      where: { interestId: veraInterest },
      select: { status: true },
    });
    expect(filas).toHaveLength(2);
    expect(filas.map((f) => f.status).sort()).toEqual([
      "EN_REVISION",
      "RECHAZADO",
    ]);
  });

  it("la subida de una NO bloquea a la otra: el índice es por interesada", async () => {
    await subir(vera);
    // Si el índice fuera global en vez de por interestId, esto fallaría.
    await expect(subir(nadia)).resolves.toBeTruthy();
  });
});

describe("el motivo del rechazo llega a la pantalla de la interesada", () => {
  it("ve el motivo del ÚLTIMO rechazo, no el de los anteriores", async () => {
    const primera = await subir(vera);
    actAs(coty);
    await rejectDeposit({
      depositId: primera.depositId,
      reason: "MOTIVO VIEJO: la fecha no coincide con el extracto.",
    });

    const segunda = await subir(vera);
    actAs(coty);
    await rejectDeposit({
      depositId: segunda.depositId,
      reason: "MOTIVO NUEVO: el importe transferido es menor al de la seña.",
    });

    actAs(vera);
    const view = await getMyDepositView("es");

    expect(view!.lastRejection!.reason).toContain("MOTIVO NUEVO");
    // La positiva y la negativa juntas: si mostrara el primero, o los dos
    // concatenados, esto lo dice.
    expect(view!.lastRejection!.reason).not.toContain("MOTIVO VIEJO");
    expect(view!.current).toBeNull();
  });

  it("al volver a subir, el rechazo viejo deja de mostrarse", async () => {
    const primera = await subir(vera);
    actAs(coty);
    await rejectDeposit({
      depositId: primera.depositId,
      reason: "El comprobante no se lee.",
    });

    actAs(vera);
    expect((await getMyDepositView("es"))!.lastRejection).not.toBeNull();

    await subir(vera);

    actAs(vera);
    const view = await getMyDepositView("es");
    // Ya subió otra y está esperando: el rechazo viejo al lado de "en
    // revisión" solo confunde.
    expect(view!.current!.status).toBe("EN_REVISION");
    expect(view!.lastRejection).toBeNull();
  });

  it("Vera no ve el rechazo de Nadia", async () => {
    const deNadia = await subir(nadia);
    actAs(coty);
    await rejectDeposit({
      depositId: deNadia.depositId,
      reason: "RECHAZO DE NADIA: comprobante ilegible.",
    });

    actAs(vera);
    const view = await getMyDepositView("es");
    expect(view!.lastRejection).toBeNull();

    // Positiva de control: Nadia sí lo ve. Sin esto, el null de arriba podría
    // ser que getMyDepositView no devuelve rechazos nunca.
    actAs(nadia);
    const suyo = await getMyDepositView("es");
    expect(suyo!.lastRejection!.reason).toContain("RECHAZO DE NADIA");
  });
});

describe("la aceptación conserva su versión del texto", () => {
  it("editar las condiciones no toca las aceptaciones ya guardadas", async () => {
    const { depositId } = await subir(vera, TERMS_V1);

    // Las coordinadoras reescriben la condición DESPUÉS de que ella aceptó.
    await prisma.trip.update({
      where: { id: tripAbierto },
      data: { depositTermsEs: TERMS_V2 },
    });

    const guardada = await prisma.depositProof.findUniqueOrThrow({
      where: { id: depositId },
      select: { acceptedTermsText: true, acceptedTermsLang: true },
    });

    // Es una copia, no una referencia. Esa es toda la propiedad.
    expect(guardada.acceptedTermsText).toBe(TERMS_V1);
    expect(guardada.acceptedTermsText).not.toBe(TERMS_V2);
    expect(guardada.acceptedTermsLang).toBe("ES");
  });

  it("volver a subir después de un rechazo acepta el texto NUEVO", async () => {
    const primera = await subir(vera, TERMS_V1);
    actAs(coty);
    await rejectDeposit({
      depositId: primera.depositId,
      reason: "Falta el comprobante completo.",
    });

    await prisma.trip.update({
      where: { id: tripAbierto },
      data: { depositTermsEs: TERMS_V2 },
    });

    // El texto viejo ya no rige: mandarlo es exactamente el caso de
    // "cambiaron las condiciones mientras completabas el formulario".
    await expect(subir(vera, TERMS_V1)).rejects.toMatchObject({
      reason: "CONDICIONES_CAMBIARON",
    });

    // Con el vigente, entra.
    const segunda = await subir(vera, TERMS_V2);

    const filas = await prisma.depositProof.findMany({
      where: { interestId: veraInterest },
      orderBy: { createdAt: "asc" },
      select: { id: true, acceptedTermsText: true },
    });

    // Cada fila con SU versión. La vieja no se actualizó ni la nueva heredó.
    expect(filas).toHaveLength(2);
    expect(filas[0]!.acceptedTermsText).toBe(TERMS_V1);
    expect(filas[1]!.acceptedTermsText).toBe(TERMS_V2);
    expect(filas[1]!.id).toBe(segunda.depositId);
  });

  it("se guarda el monto y la moneda que se le mostraron, no los de hoy", async () => {
    const { depositId } = await subir(vera);

    // Le suben la seña después de que aceptó.
    await prisma.trip.update({
      where: { id: tripAbierto },
      data: { depositAmount: "800.00" },
    });

    const guardada = await prisma.depositProof.findUniqueOrThrow({
      where: { id: depositId },
      select: { shownAmount: true, shownCurrency: true },
    });

    expect(guardada.shownAmount.toString()).toBe("500");
    expect(guardada.shownCurrency).toBe("GBP");

    await prisma.trip.update({
      where: { id: tripAbierto },
      data: { depositAmount: "500.00" },
    });
  });
});

describe("conversión doble concurrente", () => {
  it("dos confirmaciones en paralelo crean UNA sola pasajera", async () => {
    const { depositId } = await subir(vera);

    actAs(coty);
    const [a, b] = await Promise.all([
      confirmDepositAndConvert({
        depositId,
        fxRateUsed: null,
        fxRateSource: null,
      }),
      confirmDepositAndConvert({
        depositId,
        fxRateUsed: null,
        fxRateSource: null,
      }),
    ]);

    // Una aplica, la otra encuentra el trabajo hecho. Cuál de las dos gane es
    // indistinto; lo que no puede pasar es que ganen las dos.
    const resultados = [a.outcome, b.outcome].sort();
    expect(resultados).toEqual(["APLICADO", "YA_RESUELTO"]);

    const pasajeras = await prisma.passenger.count({
      where: { tripId: tripAbierto, personId: vera.personId },
    });
    expect(pasajeras).toBe(1);

    const miembros = await prisma.tripMember.count({
      where: { tripId: tripAbierto, userId: vera.id },
    });
    expect(miembros).toBe(1);
  });

  it("la seña queda sellada contra la pasajera que se creó", async () => {
    const { depositId } = await subir(vera);

    actAs(coty);
    const { passengerId } = await confirmDepositAndConvert({
      depositId,
      fxRateUsed: null,
      fxRateSource: null,
    });

    const deposit = await prisma.depositProof.findUniqueOrThrow({
      where: { id: depositId },
      select: { passengerId: true, status: true },
    });

    // Sin este sello, `generatePaymentPlan` no encuentra la seña y la pasajera
    // arranca debiendo lo que ya pagó.
    expect(deposit.passengerId).toBe(passengerId);
    expect(deposit.status).toBe("CONFIRMADO");

    const interest = await prisma.interest.findUniqueOrThrow({
      where: { id: veraInterest },
      select: { status: true },
    });
    expect(interest.status).toBe("CONVERTIDA");
  });

  it("confirmar sigue funcionando con la captación YA CERRADA", async () => {
    /**
     * Cerrar el registro no puede dejarla trabada: significa "no entra gente
     * nueva", no "se congela lo que ya entró". Ella pagó cuando estaba
     * abierto.
     *
     * ── Por qué se usa a Lena y no se cierra el viaje de Vera ────────────
     *
     * Porque el viaje de Lena YA está cerrado y no hace falta tocar nada. La
     * versión anterior de este test apagaba `acceptingInterest` en el viaje
     * de Vera y lo volvía a encender en un `finally`, y eso resultó ser
     * frágil de una manera que importa: ese flag tiene un índice único
     * GLOBAL —como máximo un viaje captando en toda la base— así que
     * apagarlo y encenderlo es tomar y devolver un candado compartido. Si
     * cualquier otra cosa lo toma en el medio, el `finally` explota con una
     * violación de índice y el test falla por su limpieza y no por lo que
     * estaba mirando, que es la peor forma de fallar.
     *
     * Un test que necesita un viaje cerrado tiene que PEDIR uno cerrado, no
     * cerrar el que había.
     */
    const { depositId } = await subir(lena);

    actAs(otto);
    const { outcome, passengerId } = await confirmDepositAndConvert({
      depositId,
      fxRateUsed: null,
      fxRateSource: null,
    });

    expect(outcome).toBe("APLICADO");
    expect(passengerId).not.toBeNull();

    // Y quedó efectivamente convertida, en un viaje que no está captando.
    const trip = await prisma.trip.findUniqueOrThrow({
      where: { id: tripOtro },
      select: { acceptingInterest: true },
    });
    expect(trip.acceptingInterest).toBe(false);

    const pasajeras = await prisma.passenger.count({
      where: { tripId: tripOtro, personId: lena.personId },
    });
    expect(pasajeras).toBe(1);
  });

  it("una interesada no puede confirmarse a sí misma", async () => {
    const { depositId } = await subir(vera);

    actAs(vera);
    await expect(
      confirmDepositAndConvert({
        depositId,
        fxRateUsed: null,
        fxRateSource: null,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const pasajeras = await prisma.passenger.count({
      where: { tripId: tripAbierto, personId: vera.personId },
    });
    expect(pasajeras).toBe(0);
  });
});

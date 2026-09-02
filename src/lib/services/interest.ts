import "server-only";

import { headers } from "next/headers";
import { prisma } from "@/lib/db/prisma";
import {
  getSessionUser,
  requireCapability,
  requireSessionUser,
} from "@/lib/auth/guards";
import { ForbiddenError } from "@/lib/auth/errors";
import {
  checkRateLimit,
  INTEREST_SIGNUP_GLOBAL_KEY,
} from "@/lib/auth/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  createPersonForSignup,
  enrollPassengerFromInterest,
  listEnrolledPersonIds,
} from "./passengers";
import { recordAudit } from "./audit";
import {
  appUrl,
  footerFor,
  langOf,
  tripEmailContext,
  tryDeliver,
} from "./notifications";
import { newInterestEmail } from "@/lib/email/templates";
import { pickLocalized } from "@/lib/domain/rich-text";
import type { InterestStatus, RoomType } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";

/**
 * El embudo de interesadas: de la landing pública a pasajera.
 *
 * ── Lo que este módulo NO hace ────────────────────────────────────────────
 *
 * No toca `Passenger` ni `Person` con Prisma. Las tres cosas que necesita de
 * esas tablas —crear la Person del registro, crear el Passenger de la
 * conversión y saber quién ya está anotado— viven en `services/passengers.ts`,
 * que es el único módulo autorizado. Acá se las llama; no se las reimplementa.
 * `check:layers` lo verifica archivo por archivo.
 *
 * ── Por qué una interesada no llega a nada ────────────────────────────────
 *
 * Porque no tiene `TripMember`. Todo el aislamiento sale de esa ausencia, sin
 * una sola regla nueva de autorización: `getTripViewer()` le devuelve
 * `tripRole: null`, `can()` le dice que no a todo, `requireTripRole()` tira
 * ForbiddenError y `passengerVisibilityFilter()` devuelve una condición
 * imposible. Ver el docblock del modelo Interest en prisma/schema.prisma.
 *
 * Lo único que puede leer del viaje es lo que devuelve `getMyInterestView()`,
 * y esa función selecciona campo por campo.
 */

export class InterestError extends Error {
  constructor(
    message: string,
    readonly reason:
      | "SIN_VIAJE_ABIERTO"
      | "EMAIL_YA_REGISTRADO"
      | "DATOS_INVALIDOS"
      | "DEMASIADOS_INTENTOS"
      | "NO_CONVERTIBLE",
  ) {
    super(message);
    this.name = "InterestError";
  }
}

// ---------------------------------------------------------------------------
// 1 · La zona pública: qué viaje está abierto
// ---------------------------------------------------------------------------

export interface PublicTripInfo {
  id: string;
  name: string;
  /** Propuesta del viaje. Texto plano; el link se autolinkea al renderizar. */
  infoForInterested: string | null;
  welcomeMessage: string | null;
  nextStepMessage: string | null;
}

/**
 * Los campos PÚBLICOS del viaje que está aceptando interesadas, o `null`.
 *
 * El `select` es la frontera entera de esta pantalla: enumera exactamente lo
 * que puede salir sin sesión. No están —y no pueden estar— los cupos, los
 * precios, las fechas ni nada de las pasajeras. Que la lista sea explícita y
 * corta es lo que hace revisable esa afirmación de un vistazo.
 *
 * Es la única función del sistema que lee un viaje sin pedir sesión, y por eso
 * está arriba de todo y no perdida entre las demás.
 */
export async function getPublicTrip(
  locale: string,
): Promise<PublicTripInfo | null> {
  const trip = await prisma.trip.findFirst({
    where: { acceptingInterest: true },
    select: {
      id: true,
      name: true,
      infoForInterestedEs: true,
      infoForInterestedEn: true,
      welcomeMessageEs: true,
      welcomeMessageEn: true,
      nextStepMessageEs: true,
      nextStepMessageEn: true,
    },
  });

  if (!trip) return null;

  return {
    id: trip.id,
    name: trip.name,
    infoForInterested: pickLocalized(
      trip.infoForInterestedEs,
      trip.infoForInterestedEn,
      locale,
    ),
    welcomeMessage: pickLocalized(
      trip.welcomeMessageEs,
      trip.welcomeMessageEn,
      locale,
    ),
    nextStepMessage: pickLocalized(
      trip.nextStepMessageEs,
      trip.nextStepMessageEn,
      locale,
    ),
  };
}

/**
 * El mensaje editable de "no hay viaje abierto".
 *
 * Se busca en cualquier viaje porque, por definición, cuando hace falta no hay
 * ninguno aceptando. Se toma el más reciente: es el que tiene el texto que las
 * coordinadoras escribieron última vez. Si no hay ninguno cargado, la pantalla
 * cae a un texto del catálogo de i18n — que una escuela sin viajes todavía vea
 * algo razonable importa más que la voz de marca.
 */
export async function getClosedMessage(locale: string): Promise<string | null> {
  const trip = await prisma.trip.findFirst({
    where: {
      OR: [
        { closedMessageEs: { not: null } },
        { closedMessageEn: { not: null } },
      ],
    },
    orderBy: { createdAt: "desc" },
    select: { closedMessageEs: true, closedMessageEn: true },
  });

  if (!trip) return null;
  return pickLocalized(trip.closedMessageEs, trip.closedMessageEn, locale);
}

// ---------------------------------------------------------------------------
// 2 · El registro público
// ---------------------------------------------------------------------------

export interface RegisterInterestInput {
  fullName: string;
  email: string;
  password: string;
  residenceCountry: string;
  phone: string | null;
  locale: string;
}

export interface RegisterInterestResult {
  tripId: string;
  interestId: string;
  /**
   * Los textos de la pantalla de confirmación, del viaje contra el que quedó
   * anotada.
   *
   * Se devuelven desde acá y no se vuelven a consultar afuera por dos razones:
   * ya tenemos el viaje en la mano, y volver a preguntar "¿cuál está abierto?"
   * podría devolver otro si alguien cerró la captación en el medio — y
   * entonces le mostraríamos el "qué sigue" de un viaje que no es el suyo.
   */
  welcomeMessage: string | null;
  nextStepMessage: string | null;
}

/** IP de quien manda el formulario, para el rate limiting por origen. */
async function requestIp(): Promise<string> {
  const headerList = await headers();
  const forwarded = headerList.get("x-forwarded-for");
  // El primero de la cadena es el cliente; el resto son proxies.
  return forwarded?.split(",")[0]?.trim() || "sin-ip";
}

/**
 * Registra una interesada contra el viaje activo.
 *
 * ── Sin sesión, y por qué eso no la vuelve una puerta abierta ─────────────
 *
 * Es la PRIMERA superficie del sistema que crea usuarios sin invitación, y
 * revierte una decisión que estaba tomada ("no hay registro abierto"). Lo que
 * la acota son tres cosas, y ninguna es un guard:
 *
 *   · tiene que haber un viaje aceptando. Sin eso no hay contra qué anotarse y
 *     la función no llega a crear nada;
 *   · rate limiting en tres capas —IP, mail y un tope global diario— porque
 *     las dos primeras se esquivan rotando justamente esas dos cosas;
 *   · el usuario que crea nace SIN NINGÚN TripMember, o sea sin acceso a nada.
 *
 * ── El orden de las escrituras ────────────────────────────────────────────
 *
 * Auth primero, después la transacción de la base, y el mail al final y por
 * fuera. El mail va último y envuelto porque un proveedor caído no puede
 * costarle a la escuela una interesada que ya completó el formulario: quedó
 * registrada, y de eso se enteran igual entrando al listado.
 */
export async function registerInterest(
  input: RegisterInterestInput,
): Promise<RegisterInterestResult> {
  const email = input.email.trim().toLowerCase();

  // El tope global va PRIMERO: es el que frena un alta automatizada, y
  // evaluarlo después de los otros dos significaría que rotando IP y casilla
  // nunca se llega a él.
  for (const [action, identifier] of [
    ["interestSignupGlobal", INTEREST_SIGNUP_GLOBAL_KEY],
    ["interestSignup", await requestIp()],
    ["interestSignupEmail", email],
  ] as const) {
    const limit = await checkRateLimit(action, identifier);
    if (!limit.allowed) {
      throw new InterestError(
        "Recibimos muchas solicitudes. Probá de nuevo en un rato.",
        "DEMASIADOS_INTENTOS",
      );
    }
  }

  const trip = await prisma.trip.findFirst({
    where: { acceptingInterest: true },
    select: {
      id: true,
      welcomeMessageEs: true,
      welcomeMessageEn: true,
      nextStepMessageEs: true,
      nextStepMessageEn: true,
    },
  });

  if (!trip) {
    throw new InterestError(
      "No hay ningún viaje abierto en este momento.",
      "SIN_VIAJE_ABIERTO",
    );
  }

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  // Decisión explícita: se le dice que ya tiene cuenta, en vez de mostrar una
  // pantalla de éxito falsa. Sí, eso revela que ese mail está registrado. A
  // esta escala —dos viajes por año, decenas de interesadas— enumerar mails
  // contra este sistema no da nada, y una pantalla de éxito mentirosa le hace
  // perder la conversión a alguien que llegó desde Instagram y no vuelve. La
  // contracara es el límite por mail de arriba.
  if (existing) {
    throw new InterestError(
      "Ya tenés una cuenta con este email.",
      "EMAIL_YA_REGISTRADO",
    );
  }

  // El mismo mínimo que exige el canje de invitación, y validado también acá y
  // no solo en el schema de la Server Action. Es el mismo criterio que sigue
  // `redeemInvitation`: los dos flujos crean una cuenta en Auth, y una regla
  // de contraseña que vive en una sola de las dos capas es una regla que se
  // puede saltear llamando al servicio desde otro lado.
  if (input.password.length < 8) {
    throw new InterestError(
      "Elegí una contraseña de al menos 8 caracteres.",
      "DATOS_INVALIDOS",
    );
  }

  const preferredLanguage = input.locale.toLowerCase().startsWith("en")
    ? ("EN" as const)
    : ("ES" as const);

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: input.password,
    // Se da por confirmada: el próximo paso es que las coordinadoras le
    // escriban, no que verifique la casilla. Un mail de verificación acá sería
    // un paso más entre ella y una conversación que igual va a pasar por
    // WhatsApp.
    email_confirm: true,
  });

  if (error || !data.user) {
    // NO se reusa EMAIL_YA_REGISTRADO: ese motivo hace que la pantalla ofrezca
    // "iniciá sesión", y mandar al login a alguien cuya cuenta no se creó es
    // dejarla girando en un círculo.
    throw new InterestError(
      "No pudimos crear tu cuenta. Probá de nuevo en un momento.",
      "DATOS_INVALIDOS",
    );
  }

  const userId = data.user.id;

  // Person, User e Interest en UNA transacción: son un solo hecho. Con la
  // Person creada aparte, un fallo en `user.create` —dos formularios con el
  // mismo mail a la vez— dejaría datos personales de alguien que nunca
  // terminó de registrarse, sin nadie que los borre.
  const interest = await prisma.$transaction(async (tx) => {
    const personId = await createPersonForSignup(tx, {
      fullName: input.fullName.trim(),
      residenceCountry: input.residenceCountry.trim(),
      mobilePhone: input.phone?.trim() || null,
      preferredLanguage,
    });

    await tx.user.create({
      data: { id: userId, email, role: "USER", personId },
    });

    // NO se crea TripMember. Es el corazón del diseño y no un olvido: sin fila
    // en esa tabla, todos los guards del sistema le dicen que no sin que haya
    // que escribir una sola regla nueva.
    return tx.interest.create({
      data: { userId, tripId: trip.id, status: "REGISTRADA" },
      select: { id: true },
    });
  });

  await notifyCoordinators(trip.id, {
    fullName: input.fullName.trim(),
    email,
    residenceCountry: input.residenceCountry.trim(),
    phone: input.phone?.trim() || null,
  });

  return {
    tripId: trip.id,
    interestId: interest.id,
    welcomeMessage: pickLocalized(
      trip.welcomeMessageEs,
      trip.welcomeMessageEn,
      input.locale,
    ),
    nextStepMessage: pickLocalized(
      trip.nextStepMessageEs,
      trip.nextStepMessageEn,
      input.locale,
    ),
  };
}

/**
 * Avisa a las coordinadoras. NUNCA hace fallar el registro.
 *
 * ── A qué dirección ───────────────────────────────────────────────────────
 *
 * A `INTEREST_NOTIFICATION_EMAIL` si está definida; si no, a las coordinadoras
 * del viaje, que salen de TripMember.
 *
 * Se eligió la variable de entorno con fallback derivado, y no un campo del
 * viaje, por el precedente que el sistema ya tiene con EMAIL_REPLY_TO. Un
 * campo en Trip sería una tercera copia de un dato que ya está en TripMember,
 * y habría que volver a llenarlo en cada viaje: olvidarlo una sola vez es una
 * interesada que nadie contesta. El fallback garantiza que no exista un estado
 * en el que el aviso no le llegue a nadie.
 */
async function notifyCoordinators(
  tripId: string,
  interested: {
    fullName: string;
    email: string;
    residenceCountry: string;
    phone: string | null;
  },
): Promise<void> {
  try {
    const override = process.env.INTEREST_NOTIFICATION_EMAIL?.trim();

    const recipients = override
      ? [{ email: override, lang: "ES" as const }]
      : (
          await prisma.tripMember.findMany({
            where: { tripId, role: "COORDINADOR" },
            select: {
              user: {
                select: {
                  email: true,
                  person: { select: { preferredLanguage: true } },
                },
              },
            },
          })
        ).map((member) => ({
          email: member.user.email,
          lang: member.user.person?.preferredLanguage ?? ("ES" as const),
        }));

    if (recipients.length === 0) return;

    const context = await tripEmailContext(tripId);

    for (const recipient of recipients) {
      const lang = langOf(recipient.lang);
      const rendered = newInterestEmail(lang, {
        interestedName: interested.fullName,
        interestedEmail: interested.email,
        residenceCountry: interested.residenceCountry,
        phone: interested.phone,
        url: appUrl(`/viajes/${tripId}/interesadas`, lang),
        footer: footerFor(context, lang),
      });

      await tryDeliver({ to: recipient.email, lang, rendered, context });
    }
  } catch (error) {
    // El registro YA ocurrió. Que el aviso falle no puede deshacerlo, así que
    // el error se traga acá y no sube. No se loguean ni el mail ni el nombre
    // de la interesada: son datos personales.
    console.error(
      "[interest] no se pudo avisar de una interesada nueva:",
      error instanceof Error ? error.message : "error desconocido",
    );
  }
}

// ---------------------------------------------------------------------------
// 3 · La vista de la interesada
// ---------------------------------------------------------------------------

export interface MyInterestView {
  status: InterestStatus;
  tripName: string;
  infoForInterested: string | null;
  nextStepMessage: string | null;
}

/**
 * Lo único que una interesada puede ver del viaje.
 *
 * El `select` enumera cuatro campos y esa es toda la superficie: el nombre del
 * viaje, la propuesta, qué sigue, y su propio estado en el embudo. No hay
 * cupos, ni precios, ni fechas, ni una sola referencia a otra persona. Si algo
 * no está en este select, para ella no existe.
 *
 * Devuelve `null` si el usuario no tiene ninguna Interest. Una PASAJERA que
 * entre acá también recibe `null`: esta pantalla no es suya.
 */
export async function getMyInterestView(
  locale: string,
): Promise<MyInterestView | null> {
  const user = await getSessionUser();
  if (!user) return null;

  const interest = await prisma.interest.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    select: {
      status: true,
      trip: {
        select: {
          name: true,
          infoForInterestedEs: true,
          infoForInterestedEn: true,
          nextStepMessageEs: true,
          nextStepMessageEn: true,
        },
      },
    },
  });

  if (!interest) return null;

  return {
    status: interest.status,
    tripName: interest.trip.name,
    infoForInterested: pickLocalized(
      interest.trip.infoForInterestedEs,
      interest.trip.infoForInterestedEn,
      locale,
    ),
    nextStepMessage: pickLocalized(
      interest.trip.nextStepMessageEs,
      interest.trip.nextStepMessageEn,
      locale,
    ),
  };
}

/**
 * ¿Este usuario es SOLO una interesada?
 *
 * La usa el punto de entrada para elegir a qué panel mandarlo. El "solo"
 * importa: alguien que se anotó, la convirtieron y ahora es pasajera tiene las
 * dos filas, y en ese caso manda la de pasajera. Por eso se pregunta por la
 * AUSENCIA de TripMember y no por la presencia de Interest.
 */
export async function viewerIsOnlyInterested(): Promise<boolean> {
  const user = await requireSessionUser();
  if (user.role === "ADMIN") return false;

  const [membership, interest] = await Promise.all([
    prisma.tripMember.findFirst({
      where: { userId: user.id },
      select: { id: true },
    }),
    prisma.interest.findFirst({
      where: { userId: user.id },
      select: { id: true },
    }),
  ]);

  return membership === null && interest !== null;
}

// ---------------------------------------------------------------------------
// 4 · El listado de la coordinadora
// ---------------------------------------------------------------------------

export interface InterestListItem {
  id: string;
  status: InterestStatus;
  meetingDone: boolean;
  notes: string | null;
  createdAt: Date;
  fullName: string | null;
  email: string;
  residenceCountry: string | null;
  phone: string | null;
  /** Ya es pasajera de este viaje: la conversión no se ofrece dos veces. */
  alreadyPassenger: boolean;
}

/**
 * Las interesadas del viaje, con sus datos de contacto.
 *
 * Trae de la Person SOLO los tres campos que dejó en el formulario público.
 * Una interesada convertida sigue apareciendo en la lista, y para entonces su
 * Person ya tiene pasaporte y datos de salud: si acá hubiera un `person: true`,
 * esta pantalla los mostraría. Por eso el select enumera.
 */
export async function listInterests(
  tripId: string,
): Promise<InterestListItem[]> {
  await requireCapability(tripId, "interest:manage");

  const rows = await prisma.interest.findMany({
    where: { tripId },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      status: true,
      meetingDone: true,
      notes: true,
      createdAt: true,
      user: {
        select: {
          email: true,
          personId: true,
          person: {
            select: {
              fullName: true,
              residenceCountry: true,
              mobilePhone: true,
            },
          },
        },
      },
    },
  });

  // Quiénes ya tienen Passenger en este viaje. Se resuelve en UNA consulta
  // para las N filas y no una por fila.
  const personIds = rows
    .map((row) => row.user.personId)
    .filter((id): id is string => id !== null);

  const enrolled = new Set(
    personIds.length === 0 ? [] : await listEnrolledPersonIds(tripId, personIds),
  );

  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    meetingDone: row.meetingDone,
    notes: row.notes,
    createdAt: row.createdAt,
    fullName: row.user.person?.fullName ?? null,
    email: row.user.email,
    residenceCountry: row.user.person?.residenceCountry ?? null,
    phone: row.user.person?.mobilePhone ?? null,
    alreadyPassenger:
      row.user.personId !== null && enrolled.has(row.user.personId),
  }));
}

// ---------------------------------------------------------------------------
// 5 · Mover el embudo
// ---------------------------------------------------------------------------

/** Resuelve el viaje de una Interest sin confiar en el que mande el cliente. */
async function tripOf(interestId: string): Promise<string> {
  const interest = await prisma.interest.findUnique({
    where: { id: interestId },
    select: { tripId: true },
  });
  if (!interest) throw new ForbiddenError();
  return interest.tripId;
}

/**
 * Cambia el estado del embudo.
 *
 * CONVERTIDA no se puede poner a mano: la pone `convertInterestToPassenger()`
 * cuando efectivamente creó el Passenger. Si se pudiera tipear, el embudo
 * mostraría conversiones que no ocurrieron, y el embudo existe justamente para
 * medir eso.
 */
export async function setInterestStatus(
  interestId: string,
  status: Exclude<InterestStatus, "CONVERTIDA">,
): Promise<void> {
  const tripId = await tripOf(interestId);
  const viewer = await requireCapability(tripId, "interest:manage");

  const before = await prisma.interest.findUniqueOrThrow({
    where: { id: interestId },
    select: { status: true },
  });

  await prisma.interest.update({
    where: { id: interestId },
    data: { status },
  });

  await recordAudit(viewer.userId, [
    {
      entity: "Interest",
      entityId: interestId,
      field: "status",
      oldValue: before.status,
      newValue: status,
    },
  ]);
}

/** Marca (o desmarca) que ya tuvieron la reunión. Es una marca manual. */
export async function setMeetingDone(
  interestId: string,
  done: boolean,
): Promise<void> {
  const tripId = await tripOf(interestId);
  const viewer = await requireCapability(tripId, "interest:manage");

  await prisma.interest.update({
    where: { id: interestId },
    data: { meetingDone: done },
  });

  await recordAudit(viewer.userId, [
    {
      entity: "Interest",
      entityId: interestId,
      field: "meetingDone",
      oldValue: String(!done),
      newValue: String(done),
    },
  ]);
}

/** Notas internas de la coordinadora. La interesada no las ve nunca. */
export async function setInterestNotes(
  interestId: string,
  notes: string | null,
): Promise<void> {
  const tripId = await tripOf(interestId);
  await requireCapability(tripId, "interest:manage");

  await prisma.interest.update({
    where: { id: interestId },
    data: { notes: notes?.trim() || null },
  });
}

// ---------------------------------------------------------------------------
// 6 · La conversión
// ---------------------------------------------------------------------------

/**
 * Las tres escrituras de la conversión, DENTRO de la transacción del llamador.
 *
 * Recibe el cliente transaccional en vez de abrir el suyo porque hay dos
 * caminos que llegan hasta acá y el segundo necesita meter más cosas en la
 * misma transacción:
 *
 *   · la conversión a secas, que decide la coordinadora después del Zoom
 *     (`convertInterestToPassenger`, acá abajo);
 *   · confirmar la seña, que convierte Y sella el DepositProof contra el
 *     Passenger recién creado (`services/deposits.ts`).
 *
 * Si esta función abriera su propia transacción, el segundo camino tendría dos
 * transacciones anidadas y el sellado del DepositProof podría quedar afuera:
 * una pasajera creada con una seña que no la señala, que es justo el estado
 * que hace imposible encontrar la seña al generar el plan.
 *
 * Está exportada y no es privada porque `deposits.ts` la necesita, y NO toca
 * Passenger con Prisma: se lo pide a `enrollPassengerFromInterest`, que vive
 * en el único módulo autorizado.
 */
export async function convertWithinTransaction(
  tx: Prisma.TransactionClient,
  input: {
    interestId: string;
    tripId: string;
    personId: string;
    userId: string;
    roomType: RoomType;
  },
): Promise<{ id: string }> {
  const created = await enrollPassengerFromInterest(tx, {
    tripId: input.tripId,
    personId: input.personId,
    roomType: input.roomType,
  });

  // Esta es la línea que efectivamente le abre el sistema: hasta acá no tenía
  // acceso a nada, porque no tenía TripMember.
  await tx.tripMember.upsert({
    where: { tripId_userId: { tripId: input.tripId, userId: input.userId } },
    update: {},
    create: { tripId: input.tripId, userId: input.userId, role: "PASAJERO" },
  });

  await tx.interest.update({
    where: { id: input.interestId },
    data: { status: "CONVERTIDA" },
  });

  return created;
}

/**
 * Convierte una interesada en pasajera, sin cobrarle nada.
 *
 * Es la conversión MANUAL: la decisión la toma la coordinadora después de la
 * reunión. Sigue existiendo junto a la conversión por seña —el camino de
 * `deposits.ts`— porque no toda interesada paga seña: una invitada de la
 * escuela, o alguien a quien le hicieron una excepción, entra por acá.
 *
 * Las tres escrituras van en una transacción porque describen un solo hecho:
 *
 *   1. el Passenger, en INVITADO, para que entre al formulario de 3 pasos;
 *   2. el TripMember con rol PASAJERO, que es lo que efectivamente le abre el
 *      sistema — hasta esta línea no tenía acceso a nada;
 *   3. la Interest pasa a CONVERTIDA.
 *
 * Si esto no fuera atómico y fallara en el medio, quedaría alguien con
 * Passenger y sin acceso, o convertida en el embudo y sin Passenger. Las dos
 * cosas se descubren tarde y se arreglan a mano.
 *
 * NO se manda invitación: ya tiene cuenta y contraseña desde que se registró.
 * Ese es exactamente el ahorro de haberla hecho pasar por Person desde el
 * principio.
 */
export async function convertInterestToPassenger(
  interestId: string,
  roomType: RoomType,
): Promise<{ passengerId: string }> {
  const tripId = await tripOf(interestId);
  const viewer = await requireCapability(tripId, "interest:manage");

  const interest = await prisma.interest.findUnique({
    where: { id: interestId },
    select: {
      status: true,
      userId: true,
      user: { select: { personId: true } },
    },
  });

  if (!interest) throw new ForbiddenError();

  if (interest.status === "DESCARTADA") {
    throw new InterestError(
      "Esta interesada está descartada. Cambiá su estado antes de convertirla.",
      "NO_CONVERTIBLE",
    );
  }

  const personId = interest.user.personId;
  if (!personId) {
    // No debería poder pasar: el registro crea la Person antes que la
    // Interest. Si pasa, es un dato roto y no un caso de negocio.
    throw new InterestError(
      "Esta interesada no tiene datos personales cargados.",
      "NO_CONVERTIBLE",
    );
  }

  const passenger = await prisma.$transaction((tx) =>
    convertWithinTransaction(tx, {
      interestId,
      tripId,
      personId,
      userId: interest.userId,
      roomType,
    }),
  );

  await recordAudit(viewer.userId, [
    {
      entity: "Interest",
      entityId: interestId,
      field: "status",
      oldValue: interest.status,
      newValue: "CONVERTIDA",
    },
    {
      entity: "Passenger",
      entityId: passenger.id,
      field: "creadoDesdeInteres",
      oldValue: null,
      newValue: `interest:${interestId} · ${roomType}`,
    },
  ]);

  return { passengerId: passenger.id };
}

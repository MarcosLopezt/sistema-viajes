import "server-only";

import { prisma } from "@/lib/db/prisma";
import {
  getSessionUser,
  getTripViewer,
  requirePassengerAccess,
  requireCapability,
} from "@/lib/auth/guards";
import { editRequiresAudit, passengerVisibilityFilter } from "@/lib/auth/policy";
import { ForbiddenError } from "@/lib/auth/errors";
import {
  auditMoney,
  auditValue,
  recordAudit,
  type AuditEntry,
} from "./audit";
import { confirmUpload, removeFile } from "./storage";
import {
  evaluatePassport,
  type PassportEvaluation,
} from "@/lib/domain/passport";
import {
  evaluatePersonCompleteness,
  isPersonComplete,
  type PersonCompleteness,
} from "@/lib/domain/person";
import type { PassengerMixInput } from "@/lib/domain/pricing";
import { toCalendarDate, type CalendarDate } from "@/lib/domain/calendar";
import type { PersonDraftInput } from "@/lib/validation/person";
import type { PassengerStatus, RoomType } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";

/**
 * ÚNICO punto de acceso a Passenger y Person.
 *
 * Ninguna página, Server Action ni servicio consulta esas dos tablas por
 * fuera de este módulo. La razón es que el aislamiento entre pasajeros
 * depende de que `passengerVisibilityFilter()` se aplique SIEMPRE, y una
 * regla que hay que acordarse de repetir en cada consulta es una regla que
 * tarde o temprano se olvida en alguna.
 *
 * Si aparece una consulta a `prisma.passenger` o `prisma.person` en otro
 * archivo, es un bug de seguridad, no un atajo.
 *
 * Regla que se repite en todas las funciones: el identificador del viewer
 * sale de la sesión; el que llega del cliente es el del recurso.
 */

export class PassengerStateError extends Error {
  constructor(
    message: string,
    readonly reason: "DATOS_INCOMPLETOS" | "PASAPORTE" | "TRANSICION" | "CUARTO",
  ) {
    super(message);
    this.name = "PassengerStateError";
  }
}

/** Campos de Person que puede ver un coordinador en el listado. */
const PERSON_LIST_FIELDS = {
  id: true,
  fullName: true,
  nationalityCountry: true,
  passportNumber: true,
  passportExpiryDate: true,
  preferredLanguage: true,
  hasDietaryRestrictions: true,
  hasMobilityRestrictions: true,
} as const;

/**
 * Campos que alimentan `isPersonComplete`. Se traen siempre juntos.
 *
 * Incluye `psychTreatment` y `anxietyOrPanic` —los BOOLEANOS, no los
 * detalles— porque de ellos depende si el detalle es un campo requerido, y sin
 * eso el porcentaje de completitud sería incorrecto justo para quien declaró
 * algo. Los detalles no hacen falta acá: `isFilled()` los evalúa solo cuando
 * el booleano está en true, y en ese caso quien llame ya trae la ficha entera.
 */
const PERSON_COMPLETENESS_FIELDS = {
  fullName: true,
  birthDate: true,
  nationalityCountry: true,
  passportIssuingCountry: true,
  residenceCountry: true,
  residenceAddress: true,
  residenceCity: true,
  mobilePhone: true,
  documentNumber: true,
  passportNumber: true,
  passportExpiryDate: true,
  emergencyContactName: true,
  emergencyContactRelationship: true,
  emergencyContactPhone: true,
  medicalAssuranceCompany: true,
  medicalAssuranceId: true,
  medicalAssurancePhone: true,
  medicalAssuranceEmail: true,
  hasDietaryRestrictions: true,
  dietaryRestrictionsDetail: true,
  hasMobilityRestrictions: true,
  mobilityRestrictionsDetail: true,
  takesMedication: true,
  takesMedicationDetail: true,
  psychTreatment: true,
  psychTreatmentDetail: true,
  anxietyOrPanic: true,
  anxietyOrPanicDetail: true,
  medicalAssuranceFileId: true,
} as const;

/**
 * TODOS los campos de la ficha, enumerados uno por uno.
 *
 * ── Por qué no `person: true` ─────────────────────────────────────────────
 *
 * Hasta la fase 7 `getPassenger()` traía la Person entera con `person: true`.
 * Funcionaba, y la autorización estaba bien puesta: `requirePassengerAccess()`
 * garantiza que solo lleguen acá la propia pasajera, las coordinadoras del
 * viaje y un admin.
 *
 * Lo que cambió es lo que hay adentro de la tabla. Con datos de salud mental
 * en Person, un `select *` significa que la próxima columna sensible que
 * alguien agregue al modelo sale publicada hacia todos los llamadores de esta
 * función sin que nadie lo haya decidido. La lista explícita convierte esa
 * decisión en una línea de diff que se ve en la revisión.
 *
 * Si agregás una columna a Person y no aparece en la ficha, este es el lugar.
 */
const PERSON_FULL_FIELDS = {
  ...PERSON_COMPLETENESS_FIELDS,
  id: true,
  profession: true,
  otherHealthNotes: true,
  additionalInfo: true,
  preferredLanguage: true,
  createdAt: true,
  updatedAt: true,
} as const;

// ------------------------------ Listado ------------------------------------

export interface PassengerListItem {
  id: string;
  roomType: RoomType;
  status: PassengerStatus;
  isCoordinator: boolean;
  roomId: string | null;
  roomLabel: string | null;
  person: {
    id: string;
    fullName: string | null;
    nationalityCountry: string | null;
    passportNumber: string | null;
    passportExpiryDate: Date | null;
    preferredLanguage: "ES" | "EN";
    hasDietaryRestrictions: boolean;
    hasMobilityRestrictions: boolean;
  };
  /** Semáforo: datos completos. */
  completeness: PersonCompleteness;
  /** Semáforo: pasaporte. */
  passport: PassportEvaluation;
  /** Está en base doble y sin compañero asignado. */
  needsRoommate: boolean;
}

/**
 * Pasajeros del viaje que el viewer tiene derecho a ver, con los tres
 * indicadores del semáforo ya resueltos.
 *
 * Un coordinador ve a todos; un pasajero se ve solo a sí mismo. El alcance lo
 * impone el `where`, no un filtrado posterior en memoria: así una fila ajena
 * nunca llega siquiera a salir de la base.
 */
export async function listPassengers(
  tripId: string,
): Promise<PassengerListItem[]> {
  const viewer = await getTripViewer(tripId);

  if (viewer.tripRole === null && viewer.globalRole !== "ADMIN") {
    throw new ForbiddenError();
  }

  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: {
      endDate: true,
      passportValidityMonths: true,
      requireFullPassportValidity: true,
    },
  });
  if (!trip) throw new ForbiddenError();

  const rows = await prisma.passenger.findMany({
    where: { tripId, ...passengerVisibilityFilter(viewer) },
    orderBy: [{ isCoordinator: "desc" }, { person: { fullName: "asc" } }],
    select: {
      id: true,
      roomType: true,
      status: true,
      isCoordinator: true,
      roomId: true,
      room: { select: { label: true, _count: { select: { passengers: true } } } },
      person: {
        select: { ...PERSON_LIST_FIELDS, ...PERSON_COMPLETENESS_FIELDS },
      },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    roomType: row.roomType,
    status: row.status,
    isCoordinator: row.isCoordinator,
    roomId: row.roomId,
    roomLabel: row.room?.label ?? null,
    person: {
      id: row.person.id,
      fullName: row.person.fullName,
      nationalityCountry: row.person.nationalityCountry,
      passportNumber: row.person.passportNumber,
      passportExpiryDate: row.person.passportExpiryDate,
      preferredLanguage: row.person.preferredLanguage,
      hasDietaryRestrictions: row.person.hasDietaryRestrictions,
      hasMobilityRestrictions: row.person.hasMobilityRestrictions,
    },
    completeness: evaluatePersonCompleteness(row.person),
    passport: evaluatePassport(row.person.passportExpiryDate, {
      tripEndDate: trip.endDate,
      passportValidityMonths: trip.passportValidityMonths,
      requireFullPassportValidity: trip.requireFullPassportValidity,
    }),
    // Alerta, no acción: el precio NO cambia solo. La decisión de qué hacer
    // con quien quedó sin compañero es del coordinador.
    needsRoommate:
      !row.isCoordinator &&
      row.roomType === "DOBLE" &&
      (row.room?._count.passengers ?? 0) < 2,
  }));
}

// ------------------------------ Detalle ------------------------------------

/**
 * Un pasajero puntual, con todo lo que hace falta para su ficha.
 *
 * `requirePassengerAccess` resuelve el viaje desde el pasajero, así que no se
 * puede pedir el pasajero de un viaje pasando el tripId de otro.
 */
export async function getPassenger(passengerId: string) {
  const { viewer } = await requirePassengerAccess(passengerId, "view");

  const passenger = await prisma.passenger.findUnique({
    where: { id: passengerId },
    select: {
      id: true,
      tripId: true,
      roomType: true,
      roomId: true,
      status: true,
      isCoordinator: true,
      priceOverride: true,
      priceOverrideReason: true,
      paymentInstructions: true,
      // Lista explícita, no `person: true`. El porqué está en el docblock de
      // PERSON_FULL_FIELDS: acá adentro ahora hay datos de salud mental.
      person: { select: PERSON_FULL_FIELDS },
      room: {
        select: {
          id: true,
          label: true,
          passengers: {
            select: {
              id: true,
              person: { select: { fullName: true } },
            },
          },
        },
      },
      trip: {
        select: {
          id: true,
          name: true,
          startDate: true,
          endDate: true,
          currency: true,
          status: true,
          passportValidityMonths: true,
          requireFullPassportValidity: true,
          paymentInstructionsEs: true,
          paymentInstructionsEn: true,
        },
      },
    },
  });

  if (!passenger) throw new ForbiddenError();

  const passport = evaluatePassport(passenger.person.passportExpiryDate, {
    tripEndDate: passenger.trip.endDate,
    passportValidityMonths: passenger.trip.passportValidityMonths,
    requireFullPassportValidity: passenger.trip.requireFullPassportValidity,
  });

  /**
   * Del compañero de habitación se expone SOLO el nombre.
   *
   * Es información que va a saber igual apenas llegue al hotel, y tenerla
   * antes le ahorra una consulta al coordinador. Ningún otro dato de esa
   * persona —ni mail, ni teléfono, ni nada de salud— sale de acá.
   */
  const roommateName =
    passenger.room?.passengers.find((p) => p.id !== passenger.id)?.person
      .fullName ?? null;

  return {
    ...passenger,
    priceOverride: passenger.priceOverride?.toString() ?? null,
    room: passenger.room
      ? { id: passenger.room.id, label: passenger.room.label }
      : null,
    roommateName,
    completeness: evaluatePersonCompleteness(passenger.person),
    passport,
    /** Si es su propia ficha, el viewer es el pasajero mismo. */
    isOwnRecord: viewer.ownPassengerId === passenger.id,
  };
}

/**
 * El Passenger propio del usuario en un viaje, o `null` si no viaja.
 * Se resuelve desde la sesión: es la función que usa la home del pasajero.
 */
export async function getOwnPassenger(tripId: string) {
  const viewer = await getTripViewer(tripId);
  if (viewer.ownPassengerId === null) return null;
  return getPassenger(viewer.ownPassengerId);
}

/** El viaje activo del usuario logueado, sin necesidad de saber el tripId. */
export async function getMyActivePassenger() {
  const user = await getSessionUser();
  if (!user?.personId) return null;

  const passenger = await prisma.passenger.findFirst({
    where: { personId: user.personId, status: { not: "CANCELADO" } },
    orderBy: { trip: { startDate: "desc" } },
    select: { id: true },
  });

  return passenger ? getPassenger(passenger.id) : null;
}

// ------------------------- Datos del pasajero ------------------------------

/**
 * Autoguardado. Acepta datos parciales, incompletos y mal formados.
 *
 * Este método NO valida contenido a propósito: lo que llega ya pasó por
 * `personDraftSchema`, que solo normaliza y acota longitudes. Si acá se
 * aplicara la validación estricta, un mail a medio escribir haría fallar el
 * guardado del paso entero y el pasajero perdería todo lo demás.
 *
 * La validación de verdad corre al finalizar el registro.
 */
export async function savePersonDraft(
  passengerId: string,
  draft: PersonDraftInput,
): Promise<void> {
  await requirePassengerAccess(passengerId, "edit");

  const passenger = await prisma.passenger.findUnique({
    where: { id: passengerId },
    select: { personId: true },
  });
  if (!passenger) throw new ForbiddenError();

  await prisma.person.update({
    where: { id: passenger.personId },
    data: {
      ...draft,
      passportExpiryDate: draft.passportExpiryDate
        ? new Date(`${draft.passportExpiryDate}T00:00:00.000Z`)
        : null,
    },
  });
}

/**
 * Finaliza el registro: pasa de INVITADO a REGISTRADO.
 *
 * Exige `isPersonComplete`, que es el MISMO predicado que alimenta el
 * porcentaje que ve el pasajero. Si fueran dos definiciones distintas,
 * llegaría al 100% y el botón seguiría sin dejarlo terminar.
 */
export async function finalizeRegistration(passengerId: string): Promise<void> {
  await requirePassengerAccess(passengerId, "edit");

  const passenger = await prisma.passenger.findUnique({
    where: { id: passengerId },
    select: {
      status: true,
      person: { select: PERSON_COMPLETENESS_FIELDS },
    },
  });
  if (!passenger) throw new ForbiddenError();

  if (!isPersonComplete(passenger.person)) {
    throw new PassengerStateError(
      "Todavía faltan datos obligatorios.",
      "DATOS_INCOMPLETOS",
    );
  }

  if (passenger.status === "INVITADO") {
    await prisma.passenger.update({
      where: { id: passengerId },
      data: { status: "REGISTRADO" },
    });
  }
}

/** Guarda la path del certificado médico, verificándola contra el bucket. */
export async function attachMedicalFile(
  passengerId: string,
  uploadedPath: string,
): Promise<void> {
  await requirePassengerAccess(passengerId, "edit");

  // `confirmUpload` consulta el objeto real: tipo y tamaño no salen de lo que
  // dijo el cliente.
  const path = await confirmUpload(passengerId, uploadedPath);

  const passenger = await prisma.passenger.findUnique({
    where: { id: passengerId },
    select: {
      personId: true,
      person: { select: { medicalAssuranceFileId: true } },
    },
  });
  if (!passenger) throw new ForbiddenError();

  const previous = passenger.person.medicalAssuranceFileId;

  await prisma.person.update({
    where: { id: passenger.personId },
    data: { medicalAssuranceFileId: path },
  });

  // El anterior se borra DESPUÉS de guardar el nuevo: si el borrado falla
  // queda un huérfano, que es mejor que perder el archivo que sí vale.
  if (previous && previous !== path) {
    await removeFile(previous).catch(() => {});
  }
}

// --------------------------- Edición por el coordinador --------------------

/** Campos que el coordinador puede editar de un pasajero. */
/**
 * Qué puede corregirle un coordinador a un pasajero.
 *
 * ── Lo que NO está en esta lista, y por qué ───────────────────────────────
 *
 * `psychTreatmentDetail` y `anxietyOrPanicDetail` NO están, a propósito.
 *
 * Cada campo de esta lista que cambia genera una entrada de AuditLog con el
 * valor viejo y el nuevo EN CLARO (ver `updatePersonByCoordinator`). Eso es
 * exactamente lo que queremos para un número de pasaporte mal tipeado, y
 * exactamente lo que no puede pasar con una nota de salud mental: el texto
 * terminaría persistido en una tabla que nadie piensa como contenedora de
 * datos personales, y la regla es que esos datos no van a un log nunca.
 *
 * Se resolvió sacándolos de la lista y no filtrándolos dentro del bucle
 * porque un filtro es una línea que alguien puede olvidar al agregar el
 * próximo campo; una ausencia se sostiene sola. (Además, auditarlos "solo por
 * nombre" no funcionaría: `recordAudit` descarta las entradas donde nada
 * cambió, así que una con los dos valores nulos se perdería en silencio.)
 *
 * Consecuencia aceptada: esos dos campos los corrige ÚNICAMENTE la pasajera.
 * La pantalla del coordinador lo dice con todas las letras para que no
 * parezca un error.
 */
const COORDINATOR_EDITABLE = [
  "fullName",
  "birthDate",
  "nationalityCountry",
  "passportIssuingCountry",
  "residenceCountry",
  "residenceAddress",
  "residenceCity",
  "mobilePhone",
  "documentNumber",
  "passportNumber",
  "passportExpiryDate",
  "profession",
  "emergencyContactName",
  "emergencyContactRelationship",
  "emergencyContactPhone",
  "medicalAssuranceCompany",
  "medicalAssuranceId",
  "medicalAssurancePhone",
  "medicalAssuranceEmail",
  "dietaryRestrictionsDetail",
  "mobilityRestrictionsDetail",
  "takesMedicationDetail",
  "otherHealthNotes",
  "additionalInfo",
] as const;

/**
 * Edición de los datos de un pasajero por parte de un coordinador.
 *
 * Cada campo que cambia genera una entrada de AuditLog. El pasajero ve
 * después un aviso de que sus datos fueron modificados y cuándo: que alguien
 * más toque tu número de pasaporte sin que te enteres no es aceptable.
 */
export async function updatePersonByCoordinator(
  passengerId: string,
  changes: PersonDraftInput,
): Promise<number> {
  const { viewer } = await requirePassengerAccess(passengerId, "edit");

  const passenger = await prisma.passenger.findUnique({
    where: { id: passengerId },
    select: { personId: true, person: true },
  });
  if (!passenger) throw new ForbiddenError();

  const before = passenger.person as unknown as Record<string, unknown>;
  const entries: AuditEntry[] = [];
  const data: Record<string, unknown> = {};

  // Las columnas @db.Date llegan del formulario como "AAAA-MM-DD" y hay que
  // convertirlas. Es un CONJUNTO y no una comparación contra un solo nombre:
  // cuando la fase 7 sumó birthDate a los campos editables, la versión con
  // `field === "passportExpiryDate"` habría intentado escribir un string en
  // una columna de fecha.
  const DATE_FIELDS = new Set(["passportExpiryDate", "birthDate"]);

  for (const field of COORDINATOR_EDITABLE) {
    if (!(field in changes)) continue;

    const raw = (changes as Record<string, unknown>)[field];
    const next =
      DATE_FIELDS.has(field) && typeof raw === "string" && raw !== ""
        ? new Date(`${raw}T00:00:00.000Z`)
        : (raw ?? null);

    data[field] = next;

    entries.push({
      entity: "Person",
      entityId: passenger.personId,
      field,
      oldValue: normalizeForAudit(before[field]),
      newValue: normalizeForAudit(next),
    });
  }

  if (Object.keys(data).length === 0) return 0;

  await prisma.person.update({ where: { id: passenger.personId }, data });

  // El pasajero editando lo suyo no genera auditoría: se audita lo que hace
  // un tercero sobre sus datos.
  if (!editRequiresAudit(viewer, passengerId)) return 0;

  return recordAudit(viewer.userId, entries);
}

/**
 * Dónde transferir, para ESTA pasajera. Pisa entero al texto del viaje.
 *
 * ── Por qué no está en COORDINATOR_EDITABLE ──────────────────────────────
 *
 * Tiene el mismo contrato que esa lista —lo edita la coordinadora y cada
 * cambio va a AuditLog— pero no puede estar adentro: aquella enumera columnas
 * de `Person` y termina en un `prisma.person.update()`, y esta columna vive en
 * `Passenger`. Son instrucciones para un viaje concreto, no un dato de la
 * persona: la cuenta a la que transfiere depende del país de residencia Y del
 * viaje, y la misma persona que viaja dos veces puede tener dos.
 *
 * ── Por qué se audita ────────────────────────────────────────────────────
 *
 * No es un dato personal: es una instrucción sobre DÓNDE MANDAR PLATA. Si
 * alguien la cambia y la pasajera transfiere a la cuenta equivocada, la
 * pregunta va a ser quién la tocó y cuándo, y esa pregunta solo la contesta un
 * log. Por eso se audita aunque no lo pida el invariante de datos personales.
 *
 * Vacío significa "usa el del viaje", y por eso se guarda `null` y no `""`:
 * un string vacío se leería como "esta pasajera no tiene dónde pagar".
 */
export async function setPassengerPaymentInstructions(
  passengerId: string,
  instructions: string | null,
): Promise<void> {
  // La capability, y no solo el acceso de edición: `requirePassengerAccess`
  // en modo "edit" también se lo concede a la propia pasajera sobre su ficha,
  // y esto no es suyo para tocar — es dónde la escuela le pide que transfiera.
  const { viewer, tripId } = await requirePassengerAccess(passengerId, "edit");
  await requireCapability(tripId, "passenger:editAny");

  const before = await prisma.passenger.findUniqueOrThrow({
    where: { id: passengerId },
    select: { paymentInstructions: true },
  });

  const next = instructions?.trim() || null;
  if (before.paymentInstructions === next) return;

  await prisma.passenger.update({
    where: { id: passengerId },
    data: { paymentInstructions: next },
  });

  await recordAudit(viewer.userId, [
    {
      entity: "Passenger",
      entityId: passengerId,
      field: "paymentInstructions",
      oldValue: before.paymentInstructions,
      newValue: next,
    },
  ]);
}

function normalizeForAudit(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value).trim();
  return text === "" ? null : text;
}

export interface CoordinatorEdit {
  field: string;
  at: Date;
}

/**
 * Ediciones recientes hechas por un tercero sobre los datos del pasajero.
 * Alimenta el aviso "un coordinador actualizó tus datos el DD/MM/AAAA".
 */
export async function getRecentCoordinatorEdits(
  passengerId: string,
): Promise<CoordinatorEdit[]> {
  const { viewer } = await requirePassengerAccess(passengerId, "view");

  const passenger = await prisma.passenger.findUnique({
    where: { id: passengerId },
    select: { personId: true },
  });
  if (!passenger) return [];

  const logs = await prisma.auditLog.findMany({
    where: {
      entity: "Person",
      entityId: passenger.personId,
      // Lo que hizo el propio pasajero no es una novedad para él.
      actorUserId: { not: viewer.userId },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { field: true, createdAt: true },
  });

  return logs.map((log) => ({ field: log.field, at: log.createdAt }));
}

// ------------------------------ Altas ---------------------------------------

/**
 * Las funciones de esta sección son las ÚNICAS de este módulo que no exigen
 * una sesión, y eso es deliberado.
 *
 * Corren durante un ALTA, que es el momento exacto en que todavía no hay
 * Passenger contra el cual autorizar. Pedir `requirePassengerAccess` sería
 * pedir permiso sobre una fila que estamos por crear. La autorización de cada
 * flujo está antes de llegar acá, y es distinta en cada uno:
 *
 *   · canje de invitación → el token, que `invitations.ts` valida (vigente,
 *     no revocado, no usado).
 *   · registro público    → no hay ninguna, porque no hay a quién pedírsela:
 *     es una persona anónima anotándose. Lo que la acota es el rate limiting
 *     y que exista un viaje aceptando (ver `interest.ts`).
 *
 * Que no haya guard NO las hace inseguras: ninguna LEE datos de nadie. Crean
 * una fila nueva y devuelven su id. El invariante que protege
 * `passengerVisibilityFilter()` es sobre lecturas, y acá no hay ninguna.
 *
 * Viven acá y no en `invitations.ts` ni en `interest.ts` porque Passenger y
 * Person se tocan desde un solo módulo. Que el alta sea la excepción al guard
 * no la convierte en excepción a esa regla — y por eso `check:layers` sigue
 * pasando sin agregarle un archivo más a la lista de permitidos.
 */

/**
 * Crea una Person vacía y devuelve su id.
 *
 * Vacía a propósito: el pasajero completa sus datos después, en el formulario
 * de tres pasos. Lo único que hace falta ahora es tener un id al que colgar
 * el Passenger y el User.
 */
export async function createBlankPerson(): Promise<string> {
  const person = await prisma.person.create({
    data: {},
    select: { id: true },
  });
  return person.id;
}

/**
 * Crea la Person de alguien que se registra desde la zona pública.
 *
 * No está vacía como la del canje porque el formulario público YA pide tres
 * cosas que son campos de Person: cómo se llama, dónde vive y su teléfono.
 * Guardarlas en otro lado y copiarlas al convertir serían dos fuentes de
 * verdad para "cómo se llama"; guardarlas acá desde el minuto cero significa
 * que convertirla a pasajera es crear el Passenger y nada más, y que llega al
 * formulario de 3 pasos con esos campos ya cargados.
 *
 * Es un alta, no una lectura: no hay ficha de nadie que filtrar. Ver el
 * docblock de la sección.
 *
 * Recibe el cliente transaccional del llamador —y no abre el suyo— porque la
 * Person, el User y la Interest son un solo hecho. Si la Person se creara
 * aparte y `user.create` fallara después (por ejemplo, dos formularios con el
 * mismo mail al mismo tiempo), quedaría una Person huérfana: sin usuario, sin
 * pasajero y sin nadie que la borre. Son datos personales de alguien que,
 * hasta donde el sistema sabe, nunca terminó de registrarse.
 */
export async function createPersonForSignup(
  tx: Prisma.TransactionClient,
  input: {
    fullName: string;
    residenceCountry: string;
    mobilePhone: string | null;
    preferredLanguage: "ES" | "EN";
  },
): Promise<string> {
  const person = await tx.person.create({
    data: {
      fullName: input.fullName,
      residenceCountry: input.residenceCountry,
      mobilePhone: input.mobilePhone,
      preferredLanguage: input.preferredLanguage,
    },
    select: { id: true },
  });
  return person.id;
}

/**
 * De estas personas, cuáles YA son pasajeras de este viaje.
 *
 * La usa el listado de interesadas para no ofrecer "convertir" dos veces sobre
 * la misma persona. Vive acá y no en `interest.ts` porque consulta Passenger, y
 * esa tabla se toca desde un solo módulo.
 *
 * Devuelve `personId`s, no fichas: es exactamente la misma clase de dato que
 * devuelve `passenger-bootstrap.ts` y por la misma razón. Sin datos personales
 * no hay nada que filtrar, así que no hace falta un ViewerContext acá —
 * la autorización la puso el llamador con `requireCapability(interest:manage)`
 * antes de armar la lista.
 */
export async function listEnrolledPersonIds(
  tripId: string,
  personIds: readonly string[],
): Promise<string[]> {
  if (personIds.length === 0) return [];

  const rows = await prisma.passenger.findMany({
    where: { tripId, personId: { in: [...personIds] } },
    select: { personId: true },
  });

  return rows.map((row) => row.personId);
}

/**
 * Da de alta el Passenger de una interesada que se convierte, dentro de la
 * transacción del llamador.
 *
 * Mismo `upsert` y misma razón que el alta por invitación: si la coordinadora
 * aprieta dos veces, la segunda no duplica el pasajero ni le pisa el estado.
 *
 * Recibe el cliente transaccional porque convertir son tres escrituras que
 * tienen que pasar juntas o no pasar: el Passenger, el TripMember que le da
 * acceso al viaje, y el paso de la Interest a CONVERTIDA. Si el Passenger se
 * creara aparte y algo fallara después, quedaría una pasajera que el embudo
 * sigue contando como interesada sin convertir.
 */
export async function enrollPassengerFromInterest(
  tx: Prisma.TransactionClient,
  input: { tripId: string; personId: string; roomType: RoomType },
): Promise<{ id: string }> {
  return tx.passenger.upsert({
    where: {
      tripId_personId: { tripId: input.tripId, personId: input.personId },
    },
    update: {},
    create: {
      tripId: input.tripId,
      personId: input.personId,
      roomType: input.roomType,
      status: "INVITADO",
    },
    select: { id: true },
  });
}

/**
 * Da de alta el Passenger del canje, dentro de la transacción del llamador.
 *
 * Recibe el cliente transaccional en vez de abrir el suyo porque el canje es
 * atómico de punta a punta: marcar la invitación como usada, crear el
 * TripMember y crear el Passenger tienen que pasar juntos o no pasar. Con una
 * transacción propia acá, un fallo posterior dejaría un Passenger huérfano de
 * una invitación que quedó sin marcar.
 *
 * Es un `upsert` sobre (tripId, personId): reabrir un link ya canjeado no
 * duplica al pasajero ni le pisa el estado.
 */
export async function enrollPassengerFromInvitation(
  tx: Prisma.TransactionClient,
  input: { tripId: string; personId: string; roomType: RoomType },
): Promise<{ id: string }> {
  return tx.passenger.upsert({
    where: {
      tripId_personId: { tripId: input.tripId, personId: input.personId },
    },
    update: {},
    create: {
      tripId: input.tripId,
      personId: input.personId,
      roomType: input.roomType,
      status: "INVITADO",
    },
    select: { id: true },
  });
}

// ----------------------------- Estados -------------------------------------

const ALLOWED_TRANSITIONS: Readonly<
  Record<PassengerStatus, readonly PassengerStatus[]>
> = {
  INVITADO: ["REGISTRADO", "CANCELADO"],
  REGISTRADO: ["CONFIRMADO", "CANCELADO"],
  CONFIRMADO: ["CANCELADO"],
  // Volver de CANCELADO se hace re-invitando: así queda registro de la baja.
  CANCELADO: [],
};

/**
 * Confirma a un pasajero.
 *
 * Dos condiciones, las dos validadas ACÁ y no en la UI: los datos tienen que
 * estar completos y el pasaporte no puede ser bloqueante. Un botón
 * deshabilitado en pantalla no protege nada.
 */
export async function confirmPassenger(passengerId: string): Promise<void> {
  const passenger = await prisma.passenger.findUnique({
    where: { id: passengerId },
    select: {
      tripId: true,
      status: true,
      person: { select: PERSON_COMPLETENESS_FIELDS },
      trip: {
        select: {
          endDate: true,
          passportValidityMonths: true,
          requireFullPassportValidity: true,
        },
      },
    },
  });
  if (!passenger) throw new ForbiddenError();

  const viewer = await requireCapability(passenger.tripId, "passenger:editAny");

  if (!ALLOWED_TRANSITIONS[passenger.status].includes("CONFIRMADO")) {
    throw new PassengerStateError(
      `No se puede confirmar a alguien en estado ${passenger.status}.`,
      "TRANSICION",
    );
  }

  if (!isPersonComplete(passenger.person)) {
    throw new PassengerStateError(
      "Le faltan datos obligatorios. No se puede confirmar todavía.",
      "DATOS_INCOMPLETOS",
    );
  }

  const passport = evaluatePassport(passenger.person.passportExpiryDate, {
    tripEndDate: passenger.trip.endDate,
    passportValidityMonths: passenger.trip.passportValidityMonths,
    requireFullPassportValidity: passenger.trip.requireFullPassportValidity,
  });

  if (passport.blocksConfirmation) {
    throw new PassengerStateError(
      "El pasaporte no cumple los requisitos del viaje.",
      "PASAPORTE",
    );
  }

  await prisma.passenger.update({
    where: { id: passengerId },
    data: { status: "CONFIRMADO" },
  });

  await recordAudit(viewer.userId, [
    {
      entity: "Passenger",
      entityId: passengerId,
      field: "status",
      oldValue: passenger.status,
      newValue: "CONFIRMADO",
    },
  ]);
}

export async function cancelPassenger(passengerId: string): Promise<void> {
  const passenger = await prisma.passenger.findUnique({
    where: { id: passengerId },
    select: { tripId: true, status: true },
  });
  if (!passenger) throw new ForbiddenError();

  const viewer = await requireCapability(passenger.tripId, "passenger:editAny");

  if (passenger.status === "CANCELADO") return;

  await prisma.passenger.update({
    where: { id: passengerId },
    data: { status: "CANCELADO", roomId: null },
  });

  await recordAudit(viewer.userId, [
    {
      entity: "Passenger",
      entityId: passengerId,
      field: "status",
      oldValue: passenger.status,
      newValue: "CANCELADO",
    },
  ]);
}

// ----------------------------- Habitaciones --------------------------------

const MAX_PER_ROOM = 2;

export interface RoomListItem {
  id: string;
  label: string;
  occupants: { id: string; fullName: string | null }[];
}

export async function listRooms(tripId: string): Promise<RoomListItem[]> {
  await requireCapability(tripId, "passenger:viewAll");

  const rooms = await prisma.room.findMany({
    where: { tripId },
    orderBy: { label: "asc" },
    select: {
      id: true,
      label: true,
      passengers: {
        select: { id: true, person: { select: { fullName: true } } },
      },
    },
  });

  return rooms.map((room) => ({
    id: room.id,
    label: room.label,
    occupants: room.passengers.map((p) => ({
      id: p.id,
      fullName: p.person.fullName,
    })),
  }));
}

export async function createRoom(
  tripId: string,
  label: string,
): Promise<{ id: string }> {
  await requireCapability(tripId, "passenger:editAny");
  return prisma.room.create({
    data: { tripId, label: label.trim() },
    select: { id: true },
  });
}

/**
 * Asigna un pasajero a una habitación, o lo saca si `roomId` es null.
 *
 * El tope de dos se valida dentro de una transacción con el update: sin eso,
 * dos asignaciones simultáneas podrían dejar tres personas en el mismo cuarto.
 */
export async function assignRoom(
  passengerId: string,
  roomId: string | null,
): Promise<void> {
  const passenger = await prisma.passenger.findUnique({
    where: { id: passengerId },
    select: { tripId: true, roomId: true },
  });
  if (!passenger) throw new ForbiddenError();

  const viewer = await requireCapability(passenger.tripId, "passenger:editAny");

  await prisma.$transaction(async (tx) => {
    if (roomId !== null) {
      const room = await tx.room.findFirst({
        where: { id: roomId, tripId: passenger.tripId },
        select: { id: true, _count: { select: { passengers: true } } },
      });

      // La habitación tiene que ser de ESTE viaje.
      if (!room) throw new ForbiddenError();

      const alreadyThere = passenger.roomId === roomId;
      if (!alreadyThere && room._count.passengers >= MAX_PER_ROOM) {
        throw new PassengerStateError(
          "Esa habitación ya tiene dos personas.",
          "CUARTO",
        );
      }
    }

    await tx.passenger.update({
      where: { id: passengerId },
      data: { roomId },
    });
  });

  await recordAudit(viewer.userId, [
    {
      entity: "Passenger",
      entityId: passengerId,
      field: "roomId",
      oldValue: auditValue(passenger.roomId),
      newValue: auditValue(roomId),
    },
  ]);
}

// ------------------------------ Precio ------------------------------------

/**
 * Precio pactado para un pasajero puntual.
 *
 * Es lo que resuelve el caso del pasajero en base doble que se queda sin
 * compañero: el sistema avisa, pero la decisión —y el precio— son del
 * coordinador. También queda auditado.
 *
 * Vive acá, y no en el módulo de viajes, porque escribe sobre Passenger.
 * Que el campo se llame "precio" no lo saca de esta tabla.
 */
export async function setPassengerPriceOverride(
  passengerId: string,
  priceOverride: string | null,
  reason: string | null,
): Promise<void> {
  const passenger = await prisma.passenger.findUnique({
    where: { id: passengerId },
    select: { id: true, tripId: true, priceOverride: true },
  });

  if (!passenger) throw new ForbiddenError();

  const viewer = await requireCapability(passenger.tripId, "payment:definePlan");

  await prisma.passenger.update({
    where: { id: passengerId },
    data: { priceOverride, priceOverrideReason: reason },
  });

  await recordAudit(viewer.userId, [
    {
      entity: "Passenger",
      entityId: passengerId,
      field: "priceOverride",
      oldValue: auditMoney(passenger.priceOverride),
      newValue: auditMoney(priceOverride),
    },
  ]);
}

/**
 * Cuántos pasajeros del viaje ya tienen un plan de pagos generado.
 *
 * Un plan congela su totalAmount y sus cuotas al crearse: cambiar el precio
 * del viaje NO los toca. Eso es deliberado —nadie quiere que a alguien que ya
 * pagó dos cuotas se le reescriba la deuda— pero es invisible si no se dice,
 * así que este número alimenta la advertencia del paso de precios.
 *
 * Exige `trip:viewFinancials`, igual que getPassengerMix(): alimenta una
 * pantalla que el pasajero no ve.
 */
export async function countPassengersWithActivePlan(
  tripId: string,
): Promise<number> {
  await requireCapability(tripId, "trip:viewFinancials");

  return prisma.passenger.count({
    where: { tripId, isCoordinator: false, paymentPlan: { isNot: null } },
  });
}

// ------------------------- Datos para el presupuesto -----------------------

/**
 * Distribución de pasajeros para el cálculo del margen total.
 *
 * Exige `trip:viewFinancials`, no solo pertenencia al viaje: esto alimenta un
 * número que el pasajero nunca debe ver. Devuelve lo mínimo que el motor
 * necesita y ningún dato personal.
 */
export async function getPassengerMix(
  tripId: string,
): Promise<PassengerMixInput[]> {
  await requireCapability(tripId, "trip:viewFinancials");

  const rows = await prisma.passenger.findMany({
    where: { tripId },
    select: {
      roomType: true,
      isCoordinator: true,
      status: true,
      priceOverride: true,
    },
  });

  return rows.map((row) => ({
    roomType: row.roomType,
    isCoordinator: row.isCoordinator,
    status: row.status,
    priceOverride: row.priceOverride?.toString() ?? null,
  }));
}

/** Conteo por estado, para las tarjetas del panel del coordinador. */
export async function countPassengersByStatus(
  tripId: string,
): Promise<Record<string, number>> {
  await requireCapability(tripId, "passenger:viewAll");

  const grouped = await prisma.passenger.groupBy({
    by: ["status"],
    where: { tripId, isCoordinator: false },
    _count: { _all: true },
  });

  return Object.fromEntries(
    grouped.map((row) => [row.status, row._count._all]),
  );
}

// --------------------------- Datos para pagos ------------------------------

/**
 * Lo que el módulo de pagos necesita saber de un pasajero y su viaje.
 *
 * Existe porque `lib/services/payments.ts` NO puede consultar `prisma.passenger`
 * ni `prisma.person`: ese es el invariante que hace que el aislamiento entre
 * pasajeros dependa de un solo archivo y no de que cada consulta nueva se
 * acuerde de acotarse. En vez de abrir una excepción "chica" —que es como
 * empiezan todas— el módulo de pagos pide acá lo que necesita, y lo que
 * necesita es esto y nada más: ningún dato personal, ninguno de salud.
 *
 * La autorización es de LECTURA: un coordinador pasa, y el pasajero pasa solo
 * para sí mismo. Las operaciones de escritura suman su propia capability en
 * el servicio de pagos.
 */
export interface PassengerForPayments {
  id: string;
  tripId: string;
  status: PassengerStatus;
  isCoordinator: boolean;
  roomType: RoomType;
  /** Precio pactado que pisa el de lista. String o null. */
  priceOverride: string | null;
  fullName: string | null;
  preferredLanguage: "ES" | "EN";
  /**
   * Casilla a la que se le escribe. `null` si todavía no canjeó la
   * invitación: hay Person pero no hay User, y por lo tanto no hay dónde
   * mandarle nada.
   */
  email: string | null;
  trip: {
    id: string;
    name: string;
    currency: "GBP" | "USD" | "EUR";
    /** Fecha de calendario: el módulo de pagos no razona con instantes. */
    startDate: CalendarDate;
    priceDouble: string | null;
    priceSingle: string | null;
    paymentToleranceAmount: string;
    /** Zona en la que se decide qué día es "hoy". Ver lib/domain/calendar.ts. */
    timezone: string;
    /** Defaults del plan CON seña. Ver domain/payments.ts. */
    defaultInstallmentCount: number;
    installmentIntervalMonths: number;
    /** Dónde transferir, del viaje. `Passenger.paymentInstructions` lo pisa. */
    paymentInstructionsEs: string | null;
    paymentInstructionsEn: string | null;
  };
  /**
   * Instrucciones de pago propias de esta pasajera, si se las cargaron.
   *
   * Las cuentas bancarias se acuerdan una por una por WhatsApp según el país
   * de residencia, así que el texto del viaje es apenas un default razonable y
   * este lo pisa entero — no se concatenan. Dos juegos de datos bancarios en
   * la misma pantalla es la forma más segura de que transfiera al equivocado.
   */
  paymentInstructions: string | null;
  /** El viewer es este mismo pasajero. */
  isOwnRecord: boolean;
}

export async function getPassengerForPayments(
  passengerId: string,
): Promise<PassengerForPayments> {
  const { viewer } = await requirePassengerAccess(passengerId, "view");

  const row = await prisma.passenger.findUnique({
    where: { id: passengerId },
    select: {
      id: true,
      tripId: true,
      status: true,
      isCoordinator: true,
      roomType: true,
      priceOverride: true,
      paymentInstructions: true,
      person: {
        select: {
          fullName: true,
          preferredLanguage: true,
          user: { select: { email: true } },
        },
      },
      trip: {
        select: {
          id: true,
          name: true,
          currency: true,
          startDate: true,
          priceDouble: true,
          priceSingle: true,
          paymentToleranceAmount: true,
          timezone: true,
          defaultInstallmentCount: true,
          installmentIntervalMonths: true,
          paymentInstructionsEs: true,
          paymentInstructionsEn: true,
        },
      },
    },
  });

  if (!row) throw new ForbiddenError();

  return {
    id: row.id,
    tripId: row.tripId,
    status: row.status,
    isCoordinator: row.isCoordinator,
    roomType: row.roomType,
    priceOverride: row.priceOverride?.toString() ?? null,
    fullName: row.person.fullName,
    preferredLanguage: row.person.preferredLanguage,
    email: row.person.user?.email ?? null,
    trip: {
      id: row.trip.id,
      name: row.trip.name,
      currency: row.trip.currency,
      startDate: toCalendarDate(row.trip.startDate),
      priceDouble: row.trip.priceDouble?.toString() ?? null,
      priceSingle: row.trip.priceSingle?.toString() ?? null,
      paymentToleranceAmount: row.trip.paymentToleranceAmount.toString(),
      timezone: row.trip.timezone,
      defaultInstallmentCount: row.trip.defaultInstallmentCount,
      installmentIntervalMonths: row.trip.installmentIntervalMonths,
      paymentInstructionsEs: row.trip.paymentInstructionsEs,
      paymentInstructionsEn: row.trip.paymentInstructionsEn,
    },
    paymentInstructions: row.paymentInstructions,
    isOwnRecord: viewer.ownPassengerId === row.id,
  };
}

export interface PassengerForPaymentsList {
  id: string;
  fullName: string | null;
  status: PassengerStatus;
  roomType: RoomType;
}

/**
 * Pasajeros facturables de un viaje, para la vista de pagos del coordinador.
 *
 * Excluye a los coordinadores porque no generan plan (decisión 2). El alcance
 * lo sigue imponiendo `passengerVisibilityFilter`: si esto lo llamara un
 * pasajero, se vería solo a sí mismo en vez de a todo el viaje.
 */
export async function listPassengersForPayments(
  tripId: string,
): Promise<PassengerForPaymentsList[]> {
  const viewer = await getTripViewer(tripId);

  if (viewer.tripRole === null && viewer.globalRole !== "ADMIN") {
    throw new ForbiddenError();
  }

  const rows = await prisma.passenger.findMany({
    where: {
      tripId,
      isCoordinator: false,
      ...passengerVisibilityFilter(viewer),
    },
    orderBy: { person: { fullName: "asc" } },
    select: {
      id: true,
      status: true,
      roomType: true,
      person: { select: { fullName: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    fullName: row.person.fullName,
    status: row.status,
    roomType: row.roomType,
  }));
}

// ------------------------------ Exportación --------------------------------

export interface PassengerExportRow {
  fullName: string | null;
  nationalityCountry: string | null;
  documentNumber: string | null;
  passportNumber: string | null;
  passportExpiryDate: Date | null;
  dietaryRestrictions: string | null;
  mobilityRestrictions: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  roomLabel: string | null;
  roomType: RoomType;
  status: PassengerStatus;
  isCoordinator: boolean;
}

/**
 * Los pasajeros del viaje con los datos que pide el hotel o el mayorista.
 *
 * Exige `passenger:viewAll` en vez de aplicar passengerVisibilityFilter():
 * una exportación con el filtro de visibilidad le daría a un pasajero un
 * archivo con una sola fila —la suya— en lugar de negarle el acceso, y eso es
 * peor que fallar. Acá se falla.
 *
 * Los cancelados NO entran: la lista se manda al hotel y quien se bajó del
 * viaje no tiene que aparecer en ella.
 *
 * Las restricciones se devuelven como el texto que escribió la persona, no
 * como un booleano: al hotel le sirve "celíaca", no "true".
 */
export async function listPassengersForExport(
  tripId: string,
): Promise<PassengerExportRow[]> {
  await requireCapability(tripId, "passenger:viewAll");

  const rows = await prisma.passenger.findMany({
    where: { tripId, status: { not: "CANCELADO" } },
    orderBy: [{ isCoordinator: "desc" }, { person: { fullName: "asc" } }],
    select: {
      roomType: true,
      status: true,
      isCoordinator: true,
      room: { select: { label: true } },
      person: {
        select: {
          fullName: true,
          nationalityCountry: true,
          documentNumber: true,
          passportNumber: true,
          passportExpiryDate: true,
          hasDietaryRestrictions: true,
          dietaryRestrictionsDetail: true,
          hasMobilityRestrictions: true,
          mobilityRestrictionsDetail: true,
          emergencyContactName: true,
          emergencyContactPhone: true,
        },
      },
    },
  });

  return rows.map((row) => ({
    fullName: row.person.fullName,
    nationalityCountry: row.person.nationalityCountry,
    documentNumber: row.person.documentNumber,
    passportNumber: row.person.passportNumber,
    passportExpiryDate: row.person.passportExpiryDate,
    // Marcada pero sin detalle: el hotel tiene que saber que hay algo, y
    // "sí" es más útil que una celda vacía que parece un "no".
    dietaryRestrictions: row.person.hasDietaryRestrictions
      ? (row.person.dietaryRestrictionsDetail ?? "sí")
      : null,
    mobilityRestrictions: row.person.hasMobilityRestrictions
      ? (row.person.mobilityRestrictionsDetail ?? "sí")
      : null,
    emergencyContactName: row.person.emergencyContactName,
    emergencyContactPhone: row.person.emergencyContactPhone,
    roomLabel: row.room?.label ?? null,
    roomType: row.roomType,
    status: row.status,
    isCoordinator: row.isCoordinator,
  }));
}

export interface RoomingRow {
  roomLabel: string;
  occupants: { fullName: string | null; roomType: RoomType }[];
}

/**
 * La rooming list, armada desde Room — que es para lo que se creó la tabla.
 *
 * Incluye una fila final con los que todavía no tienen habitación asignada.
 * Omitirlos daría una lista que parece completa y no lo está, y eso se
 * descubre en el mostrador del hotel.
 */
export async function listRoomingForExport(
  tripId: string,
): Promise<{ rooms: RoomingRow[]; unassigned: PassengerExportRow[] }> {
  await requireCapability(tripId, "passenger:viewAll");

  const [rooms, all] = await Promise.all([
    prisma.room.findMany({
      where: { tripId },
      orderBy: { label: "asc" },
      select: {
        label: true,
        passengers: {
          where: { status: { not: "CANCELADO" } },
          orderBy: { person: { fullName: "asc" } },
          select: {
            roomType: true,
            person: { select: { fullName: true } },
          },
        },
      },
    }),
    listPassengersForExport(tripId),
  ]);

  return {
    rooms: rooms.map((room) => ({
      roomLabel: room.label,
      occupants: room.passengers.map((passenger) => ({
        fullName: passenger.person.fullName,
        roomType: passenger.roomType,
      })),
    })),
    unassigned: all.filter((row) => row.roomLabel === null),
  };
}

// ------------------------ Acceso del cron (sin sesión) ---------------------

export interface PassengerForSystemJob {
  id: string;
  tripId: string;
  fullName: string | null;
  /** `null` si todavía no canjeó la invitación: no hay dónde escribirle. */
  email: string | null;
  preferredLanguage: "ES" | "EN";
  status: PassengerStatus;
  isCoordinator: boolean;
  passportExpiryDate: Date | null;
}

/**
 * Pasajeros de un viaje, PARA EL CRON. No hay viewer ni filtro de visibilidad.
 *
 * ── Por qué esta función existe y por qué no es un agujero ────────────────
 *
 * El cron no tiene sesión: no lo dispara una persona, lo dispara Vercel. No
 * hay un `ViewerContext` que derivar, así que `passengerVisibilityFilter()` no
 * tiene contra qué acotar. Fingir un viewer "de sistema" sería peor: metería
 * en la matriz de permisos un actor que puede todo, y esa es exactamente la
 * clase de excepción que después alguien reutiliza desde una pantalla.
 *
 * En cambio se aísla acá, con tres condiciones:
 *
 *  1. Vive en ESTE archivo, que sigue siendo el único que consulta Passenger
 *     y Person. El invariante no se rompe.
 *  2. El nombre dice qué es. Nadie la va a llamar desde una página creyendo
 *     que filtra algo.
 *  3. Su ÚNICO llamador legítimo es el endpoint de cron, que se autentica con
 *     CRON_SECRET antes de tocar nada. La autorización está ahí, no acá.
 *
 * Devuelve lo mínimo para decidir a quién notificar: ningún dato de salud,
 * ningún número de documento.
 */
export async function listPassengersForSystemJob(
  tripId: string,
): Promise<PassengerForSystemJob[]> {
  const rows = await prisma.passenger.findMany({
    where: { tripId },
    select: {
      id: true,
      tripId: true,
      status: true,
      isCoordinator: true,
      person: {
        select: {
          fullName: true,
          preferredLanguage: true,
          passportExpiryDate: true,
          user: { select: { email: true } },
        },
      },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    tripId: row.tripId,
    fullName: row.person.fullName,
    email: row.person.user?.email ?? null,
    preferredLanguage: row.person.preferredLanguage,
    status: row.status,
    isCoordinator: row.isCoordinator,
    passportExpiryDate: row.person.passportExpiryDate,
  }));
}

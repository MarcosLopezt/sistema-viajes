import "server-only";

import { prisma } from "@/lib/db/prisma";
import { requireCapability } from "@/lib/auth/guards";
import { recordAudit } from "./audit";
import {
  listPassengersForExport,
  listRoomingForExport,
} from "./passengers";
import { getTripPaymentsOverview } from "./payments";
import { buildXlsx, type XlsxRow, type XlsxSheet } from "@/lib/domain/xlsx";
import { formatDate, formatDateTimeInZone, formatMoney } from "@/lib/format";

/**
 * Exportaciones a Excel.
 *
 * ── La fila 1 ─────────────────────────────────────────────────────────────
 *
 * Las tres planillas empiezan con la fecha y hora de generación, en el huso
 * del viaje y con el huso escrito al lado. No es decoración: estos archivos se
 * mandan por mail al hotel o al mayorista y se miran semanas después, cuando
 * ya hay tres versiones dando vueltas y nadie sabe cuál es la última. Un
 * archivo sin fecha adentro es un archivo en el que no se puede confiar.
 *
 * ── Auditoría ─────────────────────────────────────────────────────────────
 *
 * Cada descarga queda registrada. Son datos personales —pasaportes, contactos
 * de emergencia, restricciones alimenticias y de salud— saliendo del sistema
 * hacia un archivo que después vive en la casilla de alguien. Quién se lo
 * llevó y cuándo tiene que quedar escrito.
 *
 * El registro se hace ACÁ y no en el route handler, para que no exista una
 * forma de generar el archivo sin dejar rastro.
 */

export type ExportKind = "pasajeros" | "pagos" | "rooming";

export interface ExportResult {
  filename: string;
  bytes: Uint8Array<ArrayBuffer>;
}

/** Datos del viaje que necesita el encabezado de cualquier exportación. */
async function exportContext(tripId: string) {
  const trip = await prisma.trip.findUniqueOrThrow({
    where: { id: tripId },
    select: {
      name: true,
      timezone: true,
      currency: true,
      startDate: true,
      endDate: true,
    },
  });
  return trip;
}

/**
 * Nombre de archivo con el viaje y la fecha adentro.
 *
 * Se saneia porque el nombre del viaje lo escribe una persona y puede traer
 * barras o dos puntos, que en Windows no son válidos en un nombre de archivo.
 */
function filenameFor(kind: ExportKind, tripName: string, now: Date): string {
  const slug = tripName
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 40);

  const stamp = now.toISOString().slice(0, 10);
  return `${kind}-${slug || "viaje"}-${stamp}.xlsx`;
}

/** Las dos primeras filas, iguales en las tres planillas. */
function headerRows(
  title: string,
  tripName: string,
  timezone: string,
  now: Date,
): XlsxRow[] {
  return [
    {
      cells: [`${title} · ${tripName} · generado el ${formatDateTimeInZone(now, timezone)}`],
      bold: true,
    },
    { cells: [] },
  ];
}

const ROOM_TYPE_LABEL: Record<string, string> = {
  DOBLE: "Compartida",
  SINGLE: "Individual",
};

/**
 * Nunca un default silencioso: alguien sin tipo de habitación todavía no lo
 * eligió, y decir "Compartida" en su lugar sería inventarle una respuesta
 * que no dio. Distinto es un cuarto SIN ocupantes (nadie para leerle el tipo
 * a nadie): ese caso lo decide cada llamador, no esta función.
 */
function roomTypeLabel(roomType: "DOBLE" | "SINGLE" | null): string {
  return roomType === null ? "Sin elegir" : (ROOM_TYPE_LABEL[roomType] ?? roomType);
}

// ---------------------------------------------------------------------------
// 1 · Listado de pasajeros para el hotel o el mayorista
// ---------------------------------------------------------------------------

/**
 * El listado que se le manda al hotel.
 *
 * Lleva los datos que el hotel efectivamente necesita y ninguno más: no van
 * el certificado de cobertura médica, ni el mail, ni el domicilio. Cuantos
 * menos datos personales salgan del sistema, mejor.
 */
export async function buildPassengerListExport(
  tripId: string,
  now: Date = new Date(),
): Promise<ExportResult> {
  const viewer = await requireCapability(tripId, "passenger:viewAll");
  const [trip, passengers] = await Promise.all([
    exportContext(tripId),
    listPassengersForExport(tripId),
  ]);

  const rows: XlsxRow[] = [
    ...headerRows("Listado de pasajeros", trip.name, trip.timezone, now),
    {
      cells: [
        "Nombre completo",
        "Nacionalidad",
        "Documento",
        "Pasaporte",
        "Vence",
        "Restricciones alimenticias",
        "Restricciones de movilidad",
        "Contacto de emergencia",
        "Teléfono de emergencia",
        "Habitación",
        "Tipo",
        "Estado",
      ],
      bold: true,
    },
    ...passengers.map((passenger) => ({
      cells: [
        passenger.fullName,
        passenger.nationalityCountry,
        passenger.documentNumber,
        passenger.passportNumber,
        passenger.passportExpiryDate
          ? formatDate(passenger.passportExpiryDate)
          : null,
        passenger.dietaryRestrictions,
        passenger.mobilityRestrictions,
        passenger.emergencyContactName,
        passenger.emergencyContactPhone,
        passenger.roomLabel,
        roomTypeLabel(passenger.roomType),
        passenger.isCoordinator ? "Coordinador" : passenger.status,
      ],
    })),
  ];

  const sheet: XlsxSheet = {
    name: "Pasajeros",
    columnWidths: [30, 16, 16, 16, 12, 28, 28, 26, 20, 14, 12, 14],
    rows,
  };

  await audit(viewer.userId, tripId, "pasajeros", passengers.length);

  return {
    filename: filenameFor("pasajeros", trip.name, now),
    bytes: buildXlsx([sheet]),
  };
}

// ---------------------------------------------------------------------------
// 2 · Estado de pagos
// ---------------------------------------------------------------------------

/**
 * Estado de pagos por pasajero.
 *
 * Los importes van con símbolo de moneda, como en toda la aplicación: la
 * planilla se lee fuera de contexto y "1.200" no dice si son libras o euros.
 *
 * Los pasajeros CANCELADOS aparecen marcados en vez de omitirse: su plata
 * entró de verdad y probablemente haya que devolverla. Sacarlos de la
 * planilla haría que ese dinero desapareciera de la vista.
 */
export async function buildPaymentsExport(
  tripId: string,
  now: Date = new Date(),
): Promise<ExportResult> {
  const viewer = await requireCapability(tripId, "payment:review");
  const [trip, overview] = await Promise.all([
    exportContext(tripId),
    getTripPaymentsOverview(tripId, now),
  ]);

  const money = (value: string) => formatMoney(value, overview.currency, "es");

  const rows: XlsxRow[] = [
    ...headerRows("Estado de pagos", trip.name, trip.timezone, now),
    {
      cells: [
        "Pasajero",
        "Estado",
        "Total del plan",
        "Pagado",
        "En revisión",
        "Saldo",
        "A favor",
        "Cuotas vencidas",
        "Próxima cuota",
        "Vence",
        "Semáforo",
      ],
      bold: true,
    },
    ...overview.rows.map((row) => ({
      cells: [
        row.fullName,
        row.cancelled ? "CANCELADO" : row.status,
        row.hasPlan ? money(row.totalAmount) : "sin plan",
        row.hasPlan ? money(row.paidTotal) : null,
        row.hasPlan ? money(row.underReviewTotal) : null,
        row.hasPlan ? money(row.balance) : null,
        row.hasPlan && Number(row.credit) > 0 ? money(row.credit) : null,
        row.hasPlan ? row.overdueCount : null,
        row.nextInstallmentNumber,
        row.nextDueDate ? formatDate(String(row.nextDueDate)) : null,
        row.light,
      ],
    })),
    { cells: [] },
    {
      cells: [
        "Totales (planes activos)",
        null,
        money(overview.expected),
        money(overview.collected),
        money(overview.underReview),
        null,
        null,
        null,
        null,
        null,
        null,
      ],
      bold: true,
    },
  ];

  // Los números parciales se explican en la planilla, no solo en pantalla.
  // Un "esperado" que ignora a los pasajeros sin plan engaña hacia arriba, y
  // fuera de la aplicación no hay ninguna nota al pie que lo aclare.
  if (overview.passengersWithoutPlan > 0) {
    rows.push({
      cells: [
        `Atención: ${overview.passengersWithoutPlan} pasajero(s) todavía sin plan de pagos. El total esperado no los incluye.`,
      ],
    });
  }
  if (Number(overview.collectedFromCancelled) > 0) {
    rows.push({
      cells: [
        `Cobrado de pasajeros cancelados, fuera de los totales: ${money(overview.collectedFromCancelled)}.`,
      ],
    });
  }

  const sheet: XlsxSheet = {
    name: "Pagos",
    columnWidths: [30, 14, 16, 16, 14, 16, 12, 10, 14, 12, 12],
    rows,
  };

  await audit(viewer.userId, tripId, "pagos", overview.rows.length);

  return {
    filename: filenameFor("pagos", trip.name, now),
    bytes: buildXlsx([sheet]),
  };
}

// ---------------------------------------------------------------------------
// 3 · Rooming list
// ---------------------------------------------------------------------------

/**
 * La rooming list, armada desde Room.
 *
 * Termina con los pasajeros sin habitación asignada. Esa sección puede estar
 * vacía y eso es información: si tiene filas, la lista todavía no se puede
 * mandar.
 */
export async function buildRoomingExport(
  tripId: string,
  now: Date = new Date(),
): Promise<ExportResult> {
  const viewer = await requireCapability(tripId, "passenger:viewAll");
  const [trip, rooming] = await Promise.all([
    exportContext(tripId),
    listRoomingForExport(tripId),
  ]);

  const rows: XlsxRow[] = [
    ...headerRows("Rooming list", trip.name, trip.timezone, now),
    {
      cells: ["Habitación", "Tipo", "Pasajero 1", "Pasajero 2", "Ocupación"],
      bold: true,
    },
    ...rooming.rooms.map((room) => ({
      cells: [
        room.roomLabel,
        // Un cuarto sin ocupantes no tiene tipo que leerle a nadie: "Compartida"
        // acá es un rótulo genérico para una fila vacía, no una respuesta
        // inventada sobre una persona — por eso NO pasa por `roomTypeLabel`.
        room.occupants.length === 0
          ? roomTypeLabel("DOBLE")
          : roomTypeLabel(room.occupants[0]!.roomType),
        room.occupants[0]?.fullName ?? null,
        room.occupants[1]?.fullName ?? null,
        room.occupants.length,
      ],
    })),
  ];

  if (rooming.unassigned.length > 0) {
    rows.push(
      { cells: [] },
      {
        cells: [`Sin habitación asignada (${rooming.unassigned.length})`],
        bold: true,
      },
      ...rooming.unassigned.map((passenger) => ({
        cells: [
          null,
          roomTypeLabel(passenger.roomType),
          passenger.fullName,
        ],
      })),
    );
  }

  const sheet: XlsxSheet = {
    name: "Rooming",
    columnWidths: [18, 14, 30, 30, 12],
    rows,
  };

  await audit(
    viewer.userId,
    tripId,
    "rooming",
    rooming.rooms.length + rooming.unassigned.length,
  );

  return {
    filename: filenameFor("rooming", trip.name, now),
    bytes: buildXlsx([sheet]),
  };
}

// ---------------------------------------------------------------------------

/**
 * Deja constancia de la descarga.
 *
 * Se guarda el tipo de exportación y cuántas filas salieron. El "cuántas" no
 * es adorno: si alguien se llevó 40 fichas o 1, no es el mismo hecho.
 */
async function audit(
  actorUserId: string,
  tripId: string,
  kind: ExportKind,
  rowCount: number,
): Promise<void> {
  await recordAudit(actorUserId, [
    {
      entity: "Export",
      entityId: tripId,
      field: kind,
      // `oldValue` nulo y `newValue` con el detalle: recordAudit descarta las
      // entradas donde nada cambió, y una descarga siempre es un hecho nuevo.
      oldValue: null,
      newValue: `${rowCount} fila(s)`,
    },
  ]);
}

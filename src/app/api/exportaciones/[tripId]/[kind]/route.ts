import { NextResponse, type NextRequest } from "next/server";
import { ForbiddenError, UnauthorizedError } from "@/lib/auth/errors";
import {
  buildPassengerListExport,
  buildPaymentsExport,
  buildRoomingExport,
  type ExportKind,
  type ExportResult,
} from "@/lib/services/exports";

/**
 * Descarga de las exportaciones a Excel.
 *
 * ── Por qué un Route Handler y no una Server Action ───────────────────────
 *
 * Una Server Action devuelve datos serializables al componente, no un archivo
 * con sus headers. Para que el navegador ofrezca "guardar como" hace falta un
 * `Content-Disposition`, y eso solo se manda desde una respuesta HTTP propia.
 *
 * ── Autorización y auditoría ──────────────────────────────────────────────
 *
 * Las dos viven en lib/services/exports.ts. Este handler resuelve qué
 * exportación se pidió y traduce errores a códigos; no decide nada y no
 * registra nada por su cuenta. Que la auditoría esté del lado del servicio es
 * lo que hace imposible generar el archivo sin dejar rastro.
 */

const BUILDERS: Record<
  ExportKind,
  (tripId: string) => Promise<ExportResult>
> = {
  pasajeros: buildPassengerListExport,
  pagos: buildPaymentsExport,
  rooming: buildRoomingExport,
};

function isExportKind(value: string): value is ExportKind {
  return value === "pasajeros" || value === "pagos" || value === "rooming";
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ tripId: string; kind: string }> },
) {
  const { tripId, kind } = await context.params;

  if (!/^[0-9a-f-]{36}$/i.test(tripId) || !isExportKind(kind)) {
    return new NextResponse(null, { status: 404 });
  }

  try {
    const { filename, bytes } = await BUILDERS[kind](tripId);

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        // `filename*` con codificación UTF-8 además del `filename` simple: el
        // nombre del viaje puede traer acentos y sin esto llegan rotos.
        "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Content-Length": String(bytes.length),
        // Contiene datos personales: que no quede en ningún cache intermedio.
        "Cache-Control": "no-store, private",
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return new NextResponse(null, { status: 401 });
    }
    // 404 y no 403: un 403 le confirmaría a quien prueba ids que el viaje
    // existe. Mismo criterio que el resto de los endpoints.
    if (error instanceof ForbiddenError) {
      return new NextResponse(null, { status: 404 });
    }
    console.error("[exportaciones] fallo al generar", (error as Error).message);
    return new NextResponse(null, { status: 500 });
  }
}

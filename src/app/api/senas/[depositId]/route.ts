import { NextResponse, type NextRequest } from "next/server";
import { ForbiddenError, UnauthorizedError } from "@/lib/auth/errors";
import { getDepositProofUrl } from "@/lib/services/deposits";
import { StorageError } from "@/lib/services/storage";

/**
 * Abre el comprobante de una seña.
 *
 * Es el hermano de `/api/comprobantes/[paymentId]` y existe por separado
 * porque el DUEÑO es distinto: aquel resuelve el archivo por el Payment y su
 * pasajera; este, por el DepositProof y su interesada — que no tiene Passenger
 * y por lo tanto no pasa por ninguno de los guards de aquel camino.
 *
 * Se podría haber metido en el mismo endpoint con un discriminador, pero
 * entonces un solo handler decidiría sobre dos reglas de acceso distintas, y
 * la forma de equivocarse ahí es aplicar la más laxa de las dos.
 *
 * ── Por qué un redirect y no un link directo ─────────────────────────────
 *
 * Mismo motivo que en los comprobantes de pago: el bucket es privado y las
 * URLs firmadas viven un minuto. Incrustarlas en el HTML las dejaría en el
 * cache del navegador y en el historial, y una URL ya vencida rompería el
 * link. Firmar en el momento de pedirlo no tiene ninguno de los dos problemas.
 *
 * ── Autorización ─────────────────────────────────────────────────────────
 *
 * Toda la decisión está en `getDepositProofUrl`: lo abre la coordinadora del
 * viaje al que pertenece esa seña, o la propia interesada. Este handler no
 * decide nada — si decidiera algo por su cuenta habría dos reglas y en algún
 * momento diferirían.
 *
 * Una interesada pidiendo el comprobante de otra recibe 404, no 403: un 403 le
 * confirmaría que esa seña existe.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ depositId: string }> },
) {
  const { depositId } = await context.params;

  // Un id que ni siquiera tiene forma de uuid no llega a la base.
  if (!/^[0-9a-f-]{36}$/i.test(depositId)) {
    return new NextResponse(null, { status: 404 });
  }

  try {
    const url = await getDepositProofUrl(depositId);
    return NextResponse.redirect(url, { status: 307 });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return new NextResponse(null, { status: 401 });
    }
    if (error instanceof ForbiddenError || error instanceof StorageError) {
      return new NextResponse(null, { status: 404 });
    }
    console.error("[senas] fallo al firmar", (error as Error).message);
    return new NextResponse(null, { status: 500 });
  }
}

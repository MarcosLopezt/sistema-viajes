import { NextResponse, type NextRequest } from "next/server";
import { ForbiddenError, UnauthorizedError } from "@/lib/auth/errors";
import { getProofUrl } from "@/lib/services/payments";
import { StorageError } from "@/lib/services/storage";

/**
 * Abre el comprobante de un pago.
 *
 * ── Por qué existe este endpoint y no un link directo ─────────────────────
 *
 * El bucket es privado y las URLs firmadas viven un minuto. Si el servidor
 * las incrustara en el HTML, quedarían en el cache del navegador, en el
 * historial y en cualquier captura de pantalla; y como el HTML de una página
 * se puede regenerar en cualquier momento, una URL ya vencida rompería el
 * link. Un redirect que se firma en el momento de pedirlo no tiene ninguno de
 * los dos problemas.
 *
 * ── Autorización ─────────────────────────────────────────────────────────
 *
 * Toda la decisión está en `getProofUrl` → `createSignedDownloadUrl`, que
 * exige acceso de lectura al PASAJERO dueño del archivo y verifica que la path
 * caiga dentro de su carpeta. Este handler no decide nada: si decidiera algo
 * por su cuenta habría dos reglas y en algún momento diferirían.
 *
 * Un pasajero pidiendo el comprobante de otro recibe 404, no 403: un 403 le
 * confirmaría que ese pago existe.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ paymentId: string }> },
) {
  const { paymentId } = await context.params;

  // Un id que ni siquiera tiene forma de uuid ni llega a la base.
  if (!/^[0-9a-f-]{36}$/i.test(paymentId)) {
    return new NextResponse(null, { status: 404 });
  }

  try {
    const url = await getProofUrl(paymentId);
    return NextResponse.redirect(url, { status: 307 });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return new NextResponse(null, { status: 401 });
    }
    if (error instanceof ForbiddenError || error instanceof StorageError) {
      return new NextResponse(null, { status: 404 });
    }
    console.error("[comprobantes] fallo al firmar", (error as Error).message);
    return new NextResponse(null, { status: 500 });
  }
}

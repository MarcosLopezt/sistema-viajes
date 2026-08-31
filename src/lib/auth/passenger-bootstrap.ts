import "server-only";

import { prisma } from "@/lib/db/prisma";

/**
 * LA ÚNICA EXCEPCIÓN al invariante "Passenger y Person se tocan solo desde
 * lib/services/passengers.ts".
 *
 * ── Por qué existe ────────────────────────────────────────────────────────
 *
 * `passengers.ts` aplica `passengerVisibilityFilter()`, que necesita un
 * ViewerContext. Y un ViewerContext necesita saber cuál es el Passenger propio
 * del usuario. Eso es circular: para leer la tabla hace falta el viewer, y
 * para armar el viewer hace falta leer la tabla.
 *
 * Este módulo corta ese círculo, y por eso es de una sola función que hace una
 * sola cosa. Está en un archivo aparte —y no adentro de guards.ts— a propósito:
 * así la excepción es verificable por archivo. `scripts/check-layers.ts` exige
 * que Passenger y Person solo aparezcan en `services/passengers.ts` y acá, y el
 * resto de `guards.ts` queda tan impedido de consultar la tabla como cualquier
 * otro módulo del sistema.
 *
 * ── Por qué es segura ─────────────────────────────────────────────────────
 *
 * No decide nada y no devuelve un solo dato personal: solo ids. Quien la llama
 * usa el resultado para CONSTRUIR el viewer, nunca para saltear una
 * verificación. Toda la lectura de datos del pasajero sigue pasando por
 * `passengers.ts` con el filtro aplicado.
 *
 * Si algún día esta función necesita devolver un campo que no sea un id,
 * la excepción dejó de ser de bootstrap y hay que rediscutirla.
 *
 * ── El `personId` en la salida (fase 8) ───────────────────────────────────
 *
 * Al principio devolvía `{ id, tripId }`. Desde la fase 8 devuelve también el
 * `personId`, y conviene que quede escrito por qué eso NO amplía la excepción.
 *
 * La convención de paths del bucket pasó a ser `{tripId}/{personId}/` (ver
 * `lib/domain/storage-paths.ts`): la carpeta es de la PERSONA, porque la
 * persona es la identidad que sobrevive a la conversión de interesada a
 * pasajera. Entonces `services/storage.ts`, que autoriza por pasajero, tiene
 * que poder traducir un `passengerId` al `personId` con el que se arma el
 * prefijo. Ese es el único uso.
 *
 * Cabe dentro de la regla tal como está escrita —"no devuelve un dato
 * personal: solo ids"— y `personId` es un id: es una clave foránea, no dice
 * nada de nadie. Quien la recibe la usa para construir una path, igual que usa
 * el `tripId`, nunca para saltear una verificación: el guard de acceso se
 * resuelve antes y por separado, contra el Passenger.
 *
 * Lo que SÍ seguiría fuera de la excepción es devolver un `fullName`, un
 * `status` o cualquier columna que describa a la persona o su situación. Ahí
 * dejaría de ser bootstrap.
 */
export async function bootstrapPassengerLookup(
  key: { tripId: string; personId: string } | { passengerId: string },
): Promise<{ id: string; tripId: string; personId: string } | null> {
  if ("passengerId" in key) {
    return prisma.passenger.findUnique({
      where: { id: key.passengerId },
      select: { id: true, tripId: true, personId: true },
    });
  }

  return prisma.passenger.findUnique({
    where: { tripId_personId: { tripId: key.tripId, personId: key.personId } },
    select: { id: true, tripId: true, personId: true },
  });
}

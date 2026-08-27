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
 */
export async function bootstrapPassengerLookup(
  key: { tripId: string; personId: string } | { passengerId: string },
): Promise<{ id: string; tripId: string } | null> {
  if ("passengerId" in key) {
    return prisma.passenger.findUnique({
      where: { id: key.passengerId },
      select: { id: true, tripId: true },
    });
  }

  return prisma.passenger.findUnique({
    where: { tripId_personId: { tripId: key.tripId, personId: key.personId } },
    select: { id: true, tripId: true },
  });
}

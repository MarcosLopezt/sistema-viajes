import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/guards";
import { viewerCoordinatesAnyTrip } from "@/lib/services/trip";
import { viewerIsOnlyInterested } from "@/lib/services/interest";

/**
 * Punto de entrada. No muestra nada: decide a qué panel corresponde mandar a
 * quien entró.
 *
 * El criterio es el rol real en la base, no una preferencia guardada en el
 * cliente. Un usuario puede ser coordinador de un viaje y pasajero de otro:
 * en ese caso ve el panel de coordinador, que es el que incluye lo demás.
 *
 * ── El orden de las tres ramas importa ────────────────────────────────────
 *
 * Coordinadora → pasajera → interesada, de más a menos alcance. La rama de
 * interesada va ÚLTIMA y pregunta por "solo interesada", no por "tiene una
 * Interest": alguien que se anotó y después la convirtieron tiene las dos
 * filas, y a esa hay que mandarla a su panel de pasajera. Preguntando al revés
 * quedaría atrapada para siempre en la pantalla de la que ya salió.
 */
export default async function EntryPage() {
  const user = await getSessionUser();

  if (!user) {
    redirect("/login");
  }

  if (await viewerCoordinatesAnyTrip()) {
    redirect("/viajes");
  }

  if (await viewerIsOnlyInterested()) {
    redirect("/mi-viaje");
  }

  redirect("/inicio");
}

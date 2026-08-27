import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/guards";
import { viewerCoordinatesAnyTrip } from "@/lib/services/trip";

/**
 * Punto de entrada. No muestra nada: decide a qué panel corresponde mandar a
 * quien entró.
 *
 * El criterio es el rol real en la base, no una preferencia guardada en el
 * cliente. Un usuario puede ser coordinador de un viaje y pasajero de otro:
 * en ese caso ve el panel de coordinador, que es el que incluye lo demás.
 */
export default async function EntryPage() {
  const user = await getSessionUser();

  if (!user) {
    redirect("/login");
  }

  redirect((await viewerCoordinatesAnyTrip()) ? "/viajes" : "/inicio");
}

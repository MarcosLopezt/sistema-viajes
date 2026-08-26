import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/db/prisma";

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

  if (user.role === "ADMIN") {
    redirect("/viajes");
  }

  const coordinates = await prisma.tripMember.findFirst({
    where: { userId: user.id, role: "COORDINADOR" },
    select: { id: true },
  });

  redirect(coordinates ? "/viajes" : "/inicio");
}

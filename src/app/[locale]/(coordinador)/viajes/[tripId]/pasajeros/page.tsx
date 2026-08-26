import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { requireCapability } from "@/lib/auth/guards";
import { prisma } from "@/lib/db/prisma";
import { listPassengers, listRooms } from "@/lib/services/passengers";
import { listInvitations } from "@/lib/services/invitations";
import { toIsoDate } from "@/lib/validation/trip";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PassengerTable } from "./passenger-table";
import { InvitationsPanel } from "./invitations-panel";
import { RoomsPanel } from "./rooms-panel";

/**
 * Panel de pasajeros del viaje.
 *
 * Tres pestañas: la lista con el semáforo, las invitaciones y las
 * habitaciones. Todo lo que se ve acá exige `passenger:viewAll`, así que un
 * pasajero que escriba la URL a mano no pasa de la primera consulta.
 */
export default async function PassengersPage({
  params,
}: PageProps<"/[locale]/viajes/[tripId]/pasajeros">) {
  const { tripId } = await params;
  await requireCapability(tripId, "passenger:viewAll");

  const [trip, passengers, invitations, rooms, t] = await Promise.all([
    prisma.trip.findUniqueOrThrow({
      where: { id: tripId },
      select: { id: true, name: true, currency: true, status: true },
    }),
    listPassengers(tripId),
    listInvitations(tripId),
    listRooms(tripId),
    getTranslations("passengers"),
  ]);

  // Las fechas y los objetos de dominio se serializan antes de cruzar al
  // cliente: ningún Date ni Decimal viaja como tal.
  const rows = passengers.map((passenger) => ({
    id: passenger.id,
    fullName: passenger.person.fullName,
    nationality: passenger.person.nationalityCountry,
    roomType: passenger.roomType,
    roomId: passenger.roomId,
    roomLabel: passenger.roomLabel,
    status: passenger.status,
    isCoordinator: passenger.isCoordinator,
    passportLevel: passenger.passport.level,
    completionPercentage: passenger.completeness.completionPercentage,
    isComplete: passenger.completeness.complete,
    needsRoommate: passenger.needsRoommate,
  }));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-2">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/viajes/${trip.id}`}>
            <ArrowLeft aria-hidden="true" />
            {trip.name}
          </Link>
        </Button>
        <h1 className="text-3xl font-semibold">{t("title")}</h1>
      </div>

      <Tabs defaultValue="list">
        <TabsList>
          <TabsTrigger value="list">{t("tabList")}</TabsTrigger>
          <TabsTrigger value="invitations">{t("tabInvitations")}</TabsTrigger>
          <TabsTrigger value="rooms">{t("tabRooms")}</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="pt-5">
          <PassengerTable tripId={trip.id} passengers={rows} />
        </TabsContent>

        <TabsContent value="invitations" className="pt-5">
          <InvitationsPanel
            tripId={trip.id}
            invitations={invitations.map((invitation) => ({
              ...invitation,
              expiresAt: toIsoDate(invitation.expiresAt),
              createdAt: toIsoDate(invitation.createdAt),
            }))}
          />
        </TabsContent>

        <TabsContent value="rooms" className="pt-5">
          <RoomsPanel
            tripId={trip.id}
            rooms={rooms}
            passengers={rows.filter(
              (row) => !row.isCoordinator && row.status !== "CANCELADO",
            )}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

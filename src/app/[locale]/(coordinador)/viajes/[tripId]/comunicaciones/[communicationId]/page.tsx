import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { requireCapability } from "@/lib/auth/guards";
import { getCommunication } from "@/lib/services/communications";
import { listPassengersForPayments } from "@/lib/services/passengers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CommunicationEditor } from "../editor";

/**
 * Una comunicación puntual.
 *
 * El mismo editor sirve para el borrador y para una ya enviada: en ese caso
 * queda en solo lectura y lo que importa pasa a ser la lista de destinatarios
 * con su estado, que es donde se ve a quién no le llegó.
 */
export default async function CommunicationPage({
  params,
}: PageProps<"/[locale]/viajes/[tripId]/comunicaciones/[communicationId]">) {
  const { tripId, communicationId } = await params;
  await requireCapability(tripId, "communication:send");

  const [communication, passengers, t] = await Promise.all([
    getCommunication(communicationId),
    listPassengersForPayments(tripId),
    getTranslations("communications"),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-2">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/viajes/${tripId}/comunicaciones`}>
            <ArrowLeft aria-hidden="true" />
            {t("backToList")}
          </Link>
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold">{communication.subjectEs}</h1>
          <Badge variant="outline">
            {t(`statuses.${communication.status}`)}
          </Badge>
        </div>
      </div>

      <CommunicationEditor
        tripId={tripId}
        communication={{
          id: communication.id,
          subjectEs: communication.subjectEs,
          bodyEs: communication.bodyEs,
          subjectEn: communication.subjectEn,
          bodyEn: communication.bodyEn,
          audience: communication.audience,
          includeCancelled: communication.includeCancelled,
          status: communication.status,
          passengerIds: communication.passengerIds,
          recipients: communication.recipients.map((recipient) => ({
            id: recipient.id,
            fullName: recipient.fullName,
            lang: recipient.lang,
            status: recipient.status,
            error: recipient.error,
          })),
        }}
        passengers={passengers.map((passenger) => ({
          id: passenger.id,
          fullName: passenger.fullName,
          cancelled: passenger.status === "CANCELADO",
        }))}
      />
    </div>
  );
}

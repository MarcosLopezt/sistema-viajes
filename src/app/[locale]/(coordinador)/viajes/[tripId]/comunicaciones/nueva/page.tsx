import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { requireCapability } from "@/lib/auth/guards";
import { listPassengersForPayments } from "@/lib/services/passengers";
import { Button } from "@/components/ui/button";
import { CommunicationEditor } from "../editor";

/** Comunicación nueva. El borrador se crea al primer guardado, no antes. */
export default async function NewCommunicationPage({
  params,
}: PageProps<"/[locale]/viajes/[tripId]/comunicaciones/nueva">) {
  const { tripId } = await params;
  await requireCapability(tripId, "communication:send");

  const [passengers, t] = await Promise.all([
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
        <h1 className="text-3xl font-semibold">{t("editorNew")}</h1>
      </div>

      <CommunicationEditor
        tripId={tripId}
        communication={null}
        passengers={passengers.map((passenger) => ({
          id: passenger.id,
          fullName: passenger.fullName,
          cancelled: passenger.status === "CANCELADO",
        }))}
      />
    </div>
  );
}

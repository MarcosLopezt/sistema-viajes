import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { getTripHeader } from "@/lib/services/trip";
import { listInterests } from "@/lib/services/interest";
import { Button } from "@/components/ui/button";
import { InterestTable } from "./interest-table";

/**
 * El embudo de interesadas de un viaje.
 *
 * `listInterests` exige la capability `interest:manage`: si entra alguien que
 * no es coordinadora ni admin —escribiendo la URL a mano— la consulta falla
 * antes de traer un solo dato de contacto. La página no vuelve a chequear
 * permisos porque no hace falta: el servicio es el que decide.
 */
export default async function InterestsPage({
  params,
}: PageProps<"/[locale]/viajes/[tripId]/interesadas">) {
  const { tripId } = await params;

  const [trip, interests] = await Promise.all([
    getTripHeader(tripId),
    listInterests(tripId),
  ]);

  const t = await getTranslations("interests");

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/viajes/${trip.id}`}>
            <ArrowLeft aria-hidden="true" />
            {trip.name}
          </Link>
        </Button>
        <h1 className="text-3xl font-semibold">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>

      {interests.length === 0 ? (
        <p className="text-muted-foreground py-10 text-center">{t("empty")}</p>
      ) : (
        <InterestTable tripId={tripId} rows={interests} />
      )}
    </div>
  );
}

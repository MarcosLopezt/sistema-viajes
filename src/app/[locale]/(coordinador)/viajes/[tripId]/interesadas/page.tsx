import { getLocale, getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { getTripHeader } from "@/lib/services/trip";
import { listInterests } from "@/lib/services/interest";
import { listPendingDeposits } from "@/lib/services/deposits";
import { Button } from "@/components/ui/button";
import { InterestTable } from "./interest-table";
import { DepositQueue } from "./deposit-queue";

/**
 * El embudo de interesadas de un viaje.
 *
 * `listInterests` exige la capability `interest:manage`: si entra alguien que
 * no es coordinadora ni admin —escribiendo la URL a mano— la consulta falla
 * antes de traer un solo dato de contacto. La página no vuelve a chequear
 * permisos porque no hace falta: el servicio es el que decide.
 *
 * La cola de señas va ARRIBA del embudo, y no es una preferencia de orden:
 * una seña sin revisar es plata que alguien ya transfirió y que nadie le
 * confirmó. Es lo único de esta pantalla que tiene a una persona esperando del
 * otro lado, así que es lo primero que se ve. El embudo, en cambio, se mira
 * cuando hay tiempo.
 */
export default async function InterestsPage({
  params,
}: PageProps<"/[locale]/viajes/[tripId]/interesadas">) {
  const { tripId } = await params;

  const [trip, interests, deposits] = await Promise.all([
    getTripHeader(tripId),
    listInterests(tripId),
    listPendingDeposits(tripId),
  ]);

  const t = await getTranslations("interests");
  const locale = await getLocale();
  const localeCode = locale.toLowerCase().startsWith("en") ? "en" : "es";

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

      {deposits.length > 0 ? (
        <DepositQueue
          tripId={tripId}
          rows={deposits}
          locale={localeCode}
        />
      ) : null}

      {interests.length === 0 ? (
        <p className="text-muted-foreground py-10 text-center">{t("empty")}</p>
      ) : (
        <InterestTable tripId={tripId} rows={interests} />
      )}
    </div>
  );
}

import { getTranslations } from "next-intl/server";
import { ArrowLeft, Lock } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { getTripBudget } from "@/lib/services/trip";
import { getPassengerMix } from "@/lib/services/passengers";
import { toIsoDate } from "@/lib/validation/trip";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { BudgetWizard } from "@/components/budget/budget-wizard";
import type { WizardTrip } from "@/components/budget/types";

/**
 * Wizard de presupuesto.
 *
 * `getTripBudget` exige `trip:viewFinancials`: si entra alguien que no es
 * coordinador ni admin —escribiendo la URL a mano, por ejemplo— la consulta
 * falla antes de leer un solo costo. La página no vuelve a chequear permisos
 * porque no hace falta: el servicio es el que decide.
 */
export default async function BudgetPage({
  params,
}: PageProps<"/[locale]/viajes/[tripId]/presupuesto">) {
  const { tripId } = await params;
  const [{ trip }, passengerMix] = await Promise.all([
    getTripBudget(tripId),
    getPassengerMix(tripId),
  ]);
  const t = await getTranslations("budget");
  const tDetail = await getTranslations("budget.detail");

  // Las fechas se pasan como "aaaa-mm-dd", que es lo que consume un
  // <input type="date">; ningún Date cruza al cliente.
  const wizardTrip: WizardTrip = {
    id: trip.id,
    name: trip.name,
    startDate: toIsoDate(trip.startDate),
    endDate: toIsoDate(trip.endDate),
    currency: trip.currency,
    status: trip.status,
    minPassengers: trip.minPassengers,
    maxPassengers: trip.maxPassengers,
    budgetedPassengers: trip.budgetedPassengers,
    coordinatorCount: trip.coordinatorCount,
    passportValidityMonths: trip.passportValidityMonths,
    requireFullPassportValidity: trip.requireFullPassportValidity,
    priceDouble: trip.priceDouble,
    priceSingle: trip.priceSingle,
    stops: trip.stops.map((stop) => ({
      id: stop.id,
      order: stop.order,
      city: stop.city,
      country: stop.country,
      fromDate: toIsoDate(stop.fromDate),
      toDate: toIsoDate(stop.toDate),
      notes: stop.notes,
      accommodations: stop.accommodations.map((a) => ({ ...a })),
    })),
    directCosts: trip.directCosts.map((c) => ({ ...c })),
    indirectCosts: trip.indirectCosts.map((c) => ({ ...c })),
  };

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
      </div>

      {trip.status === "FINALIZADO" ? (
        <Alert role="status">
          <Lock aria-hidden="true" />
          <AlertDescription>{tDetail("readOnly")}</AlertDescription>
        </Alert>
      ) : null}

      <BudgetWizard
        initialTrip={wizardTrip}
        passengerMix={passengerMix.map((p) => ({
          roomType: p.roomType,
          isCoordinator: p.isCoordinator,
          status: p.status,
          priceOverride:
            typeof p.priceOverride === "string" ? p.priceOverride : null,
        }))}
      />
    </div>
  );
}

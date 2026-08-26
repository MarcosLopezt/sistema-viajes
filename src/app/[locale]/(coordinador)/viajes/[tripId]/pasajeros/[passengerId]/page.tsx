import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { getPassenger } from "@/lib/services/passengers";
import { toIsoDate } from "@/lib/validation/trip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PassportAlert } from "@/components/passenger/passport-alert";
import { PassengerEditor } from "./passenger-editor";

/**
 * Ficha del pasajero, para el coordinador.
 *
 * `getPassenger` aplica `requirePassengerAccess`: si el id no pertenece a un
 * viaje que el viewer coordina, falla antes de leer un dato. Un pasajero que
 * pruebe esta URL con el id de otro no pasa de ahí.
 */
export default async function PassengerDetailPage({
  params,
}: PageProps<"/[locale]/viajes/[tripId]/pasajeros/[passengerId]">) {
  const { tripId, passengerId } = await params;

  const passenger = await getPassenger(passengerId);
  const t = await getTranslations("passengers");
  const tRooms = await getTranslations("roomTypes");

  const person = passenger.person;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-2">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/viajes/${tripId}/pasajeros`}>
            <ArrowLeft aria-hidden="true" />
            {t("title")}
          </Link>
        </Button>

        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold">
            {person.fullName ?? "—"}
          </h1>
          <Badge variant="outline">{t(`statuses.${passenger.status}`)}</Badge>
          {passenger.isCoordinator ? (
            <Badge variant="secondary">{t("coordinatorTag")}</Badge>
          ) : null}
        </div>

        <p className="text-muted-foreground text-base">
          {passenger.roomType === "DOBLE"
            ? tRooms("DOBLE")
            : tRooms("SINGLE")}
          {passenger.room ? ` · ${passenger.room.label}` : ""}
          {passenger.roommateName
            ? ` · ${tRooms("roommate", { name: passenger.roommateName })}`
            : ""}
        </p>
      </div>

      <PassportAlert
        level={passenger.passport.level}
        expiryDate={
          person.passportExpiryDate
            ? toIsoDate(person.passportExpiryDate)
            : null
        }
        tripEndDate={toIsoDate(passenger.trip.endDate)}
        minimumToConfirm={toIsoDate(passenger.passport.minimumExpiryToConfirm)}
        validityMonths={passenger.trip.passportValidityMonths}
        requiresFullValidity={passenger.trip.requireFullPassportValidity}
      />

      <PassengerEditor
        tripId={tripId}
        passengerId={passenger.id}
        passengerName={person.fullName ?? ""}
        currency={passenger.trip.currency}
        status={passenger.status}
        isCoordinator={passenger.isCoordinator}
        completionPercentage={passenger.completeness.completionPercentage}
        isComplete={passenger.completeness.complete}
        blocksConfirmation={passenger.passport.blocksConfirmation}
        priceOverride={passenger.priceOverride}
        priceOverrideReason={passenger.priceOverrideReason}
        values={{
          fullName: person.fullName ?? "",
          nationalityCountry: person.nationalityCountry ?? "",
          residenceCountry: person.residenceCountry ?? "",
          residenceAddress: person.residenceAddress ?? "",
          residenceCity: person.residenceCity ?? "",
          mobilePhone: person.mobilePhone ?? "",
          documentNumber: person.documentNumber ?? "",
          passportNumber: person.passportNumber ?? "",
          passportExpiryDate: person.passportExpiryDate
            ? toIsoDate(person.passportExpiryDate)
            : "",
          emergencyContactName: person.emergencyContactName ?? "",
          emergencyContactPhone: person.emergencyContactPhone ?? "",
          medicalAssuranceCompany: person.medicalAssuranceCompany ?? "",
          medicalAssuranceId: person.medicalAssuranceId ?? "",
          medicalAssurancePhone: person.medicalAssurancePhone ?? "",
          medicalAssuranceEmail: person.medicalAssuranceEmail ?? "",
          dietaryRestrictionsDetail: person.dietaryRestrictionsDetail ?? "",
          mobilityRestrictionsDetail: person.mobilityRestrictionsDetail ?? "",
          otherHealthNotes: person.otherHealthNotes ?? "",
        }}
        hasDietaryRestrictions={person.hasDietaryRestrictions}
        hasMobilityRestrictions={person.hasMobilityRestrictions}
        medicalFilePath={person.medicalAssuranceFileId}
      />
    </div>
  );
}

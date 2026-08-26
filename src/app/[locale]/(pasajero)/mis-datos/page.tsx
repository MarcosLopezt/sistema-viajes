import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Link } from "@/i18n/navigation";
import {
  getMyActivePassenger,
  getRecentCoordinatorEdits,
} from "@/lib/services/passengers";
import { toIsoDate } from "@/lib/validation/trip";
import { Button } from "@/components/ui/button";
import { PassportAlert } from "@/components/passenger/passport-alert";
import {
  RegistrationForm,
  type PersonValues,
} from "@/components/passenger/registration-form";
import { CoordinatorEditNotice } from "@/components/passenger/coordinator-edit-notice";

/**
 * "Mis datos": el formulario de tres pasos.
 *
 * El pasajero llega acá desde su home o directo después de canjear la
 * invitación. Los datos vienen precargados con lo que ya haya —incluido lo
 * que cargó para un viaje anterior— para que confirme o actualice en vez de
 * escribir todo de nuevo.
 */
export default async function MyDataPage() {
  const passenger = await getMyActivePassenger();
  if (!passenger) redirect("/inicio");

  const [t, edits] = await Promise.all([
    getTranslations("register"),
    getRecentCoordinatorEdits(passenger.id),
  ]);

  const person = passenger.person;

  const initialValues: PersonValues = {
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
    hasDietaryRestrictions: person.hasDietaryRestrictions,
    dietaryRestrictionsDetail: person.dietaryRestrictionsDetail ?? "",
    hasMobilityRestrictions: person.hasMobilityRestrictions,
    mobilityRestrictionsDetail: person.mobilityRestrictionsDetail ?? "",
    otherHealthNotes: person.otherHealthNotes ?? "",
    preferredLanguage: person.preferredLanguage,
    medicalAssuranceFileId: person.medicalAssuranceFileId,
  };

  return (
    <div className="space-y-6 py-2">
      <div className="space-y-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/inicio">
            <ArrowLeft aria-hidden="true" />
            {passenger.trip.name}
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
      </div>

      {edits.length > 0 ? <CoordinatorEditNotice edits={edits} /> : null}

      {/* La alerta de pasaporte va arriba del formulario: si está en rojo, es
          lo primero que tiene que resolver. */}
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

      <RegistrationForm
        passengerId={passenger.id}
        initialValues={initialValues}
      />
    </div>
  );
}

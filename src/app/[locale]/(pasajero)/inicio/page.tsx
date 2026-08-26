import { getLocale, getTranslations } from "next-intl/server";
import {
  BedDouble,
  CheckCircle2,
  ChevronRight,
  Megaphone,
  Receipt,
  UserRound,
} from "lucide-react";
import { Link } from "@/i18n/navigation";
import { requireSessionUser } from "@/lib/auth/guards";
import {
  getMyActivePassenger,
  getRecentCoordinatorEdits,
} from "@/lib/services/passengers";
import { toIsoDate } from "@/lib/validation/trip";
import { formatMoney, type LocaleCode } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PassportAlert } from "@/components/passenger/passport-alert";
import { CoordinatorEditNotice } from "@/components/passenger/coordinator-edit-notice";

/**
 * Home del pasajero: exactamente tres tarjetas, nada más.
 *
 * Mis datos (con % de completitud) · Mis pagos · Novedades.
 *
 * El pasajero no ve ni puede llegar a los costos, el presupuesto o el margen:
 * esta consulta ni siquiera los trae. Tampoco aparecen las palabras "base
 * doble", "costo indirecto" ni "margen" en ninguna parte.
 */
export default async function PassengerHomePage() {
  await requireSessionUser();

  const locale = (await getLocale()) as LocaleCode;
  const t = await getTranslations("passengerHome");
  const tRooms = await getTranslations("roomTypes");

  const passenger = await getMyActivePassenger();

  if (!passenger) {
    return (
      <div className="py-10 text-center">
        <p className="text-muted-foreground text-base">{t("newsEmpty")}</p>
      </div>
    );
  }

  const edits = await getRecentCoordinatorEdits(passenger.id);
  const person = passenger.person;
  const firstName = person.fullName?.split(" ")[0] ?? "";
  const missingPercent = 100 - passenger.completeness.completionPercentage;

  return (
    <div className="space-y-5 py-2">
      {firstName ? (
        <h1 className="text-2xl font-semibold">
          {t("greeting", { name: firstName })}
        </h1>
      ) : null}

      {edits.length > 0 ? <CoordinatorEditNotice edits={edits} /> : null}

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

      {/* 1 — Mis datos */}
      <Card>
        <CardHeader className="gap-1">
          <CardTitle className="flex items-center gap-2 text-lg">
            <UserRound className="size-5" aria-hidden="true" />
            {t("myDataTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {passenger.completeness.complete ? (
            <>
              <p className="text-status-ok flex items-center gap-2 text-base">
                <CheckCircle2 className="size-5" aria-hidden="true" />
                {t("myDataComplete")}
              </p>
              <Button asChild variant="outline" className="w-full">
                <Link href="/mis-datos">{t("myDataAction")}</Link>
              </Button>
            </>
          ) : (
            <>
              <p className="text-base">
                {t("myDataIncomplete", { percent: missingPercent })}
              </p>
              <div
                role="progressbar"
                aria-valuenow={passenger.completeness.completionPercentage}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={t("myDataTitle")}
                className="bg-muted h-2.5 w-full overflow-hidden rounded-full"
              >
                <div
                  className="bg-primary h-full rounded-full transition-all"
                  style={{
                    width: `${passenger.completeness.completionPercentage}%`,
                  }}
                />
              </div>
              {/* Único botón primario de la pantalla. */}
              <Button asChild size="lg" className="w-full">
                <Link href="/mis-datos">
                  {t("myDataAction")}
                  <ChevronRight aria-hidden="true" />
                </Link>
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* Habitación: solo el nombre de la compañera, ningún otro dato. */}
      <Card>
        <CardHeader className="gap-1">
          <CardTitle className="flex items-center gap-2 text-lg">
            <BedDouble className="size-5" aria-hidden="true" />
            {tRooms("yourRoom")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <p className="text-base">
            {passenger.roomType === "DOBLE"
              ? tRooms("doubleExplained")
              : tRooms("singleExplained")}
          </p>
          {passenger.roomType === "DOBLE" ? (
            <p className="text-muted-foreground text-base">
              {passenger.roommateName
                ? tRooms("roommate", { name: passenger.roommateName })
                : tRooms("roommatePending")}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* 2 — Mis pagos */}
      <Card>
        <CardHeader className="gap-1">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Receipt className="size-5" aria-hidden="true" />
            {t("myPaymentsTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {passenger.priceOverride ? (
            <p className="text-2xl font-semibold">
              {formatMoney(
                passenger.priceOverride,
                passenger.trip.currency,
                locale,
              )}
            </p>
          ) : (
            <p className="text-muted-foreground text-base">
              {t("myPaymentsEmpty")}
            </p>
          )}
        </CardContent>
      </Card>

      {/* 3 — Novedades */}
      <Card>
        <CardHeader className="gap-1">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Megaphone className="size-5" aria-hidden="true" />
            {t("newsTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-base">{t("newsEmpty")}</p>
        </CardContent>
      </Card>
    </div>
  );
}

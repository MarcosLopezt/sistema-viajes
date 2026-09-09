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
import { getPaymentPlan } from "@/lib/services/payments";
import { listCommunicationsForPassenger } from "@/lib/services/communications";
import { toIsoDate } from "@/lib/validation/trip";
import { formatDate, formatMoney, type LocaleCode } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PassportAlert } from "@/components/passenger/passport-alert";
import { CoordinatorEditNotice } from "@/components/passenger/coordinator-edit-notice";
import { PaymentLightBadge } from "@/components/payments/payment-badges";

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
  const tNews = await getTranslations("news");

  const passenger = await getMyActivePassenger();

  if (!passenger) {
    return (
      // Antes decía "Todavía no hay novedades del viaje", que es el texto
      // equivocado: acá el problema no son las novedades, es que esta
      // persona no está en ningún viaje. Un estado vacío tiene que decir
      // qué pasa y qué hacer.
      <div className="space-y-3 py-10 text-center">
        <h1 className="text-2xl font-semibold">{t("noTripTitle")}</h1>
        <p className="text-muted-foreground text-base">{t("noTripBody")}</p>
      </div>
    );
  }

  const [edits, plan, news] = await Promise.all([
    getRecentCoordinatorEdits(passenger.id),
    getPaymentPlan(passenger.id),
    listCommunicationsForPassenger(passenger.id),
  ]);
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
          {passenger.roomType === null ? (
            <>
              <p className="text-base">{tRooms("notChosen")}</p>
              <p className="text-muted-foreground text-base">
                {tRooms("choosePrompt")}
              </p>
            </>
          ) : (
            <p className="text-base">
              {passenger.roomType === "DOBLE"
                ? tRooms("doubleExplained")
                : tRooms("singleExplained")}
            </p>
          )}
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
        <CardContent className="space-y-3">
          {plan === null ? (
            <p className="text-muted-foreground text-base">
              {t("myPaymentsEmpty")}
            </p>
          ) : (
            <>
              {/* El número grande es lo que DEBE, no lo que ya pagó: es la
                  pregunta que trae a alguien a esta tarjeta. */}
              <p className="text-3xl font-semibold tabular-nums">
                {formatMoney(plan.balance, plan.currency, locale)}
              </p>
              <p className="text-muted-foreground text-base">
                {t("myPaymentsSummary", {
                  paid: formatMoney(plan.paidTotal, plan.currency, locale),
                  total: formatMoney(plan.totalAmount, plan.currency, locale),
                })}
              </p>
              {plan.nextInstallment ? (
                <p className="flex flex-wrap items-center gap-2 text-base">
                  <PaymentLightBadge light={plan.light} />
                  {t("myPaymentsNext", {
                    label: `${formatMoney(plan.nextInstallment.remaining, plan.currency, locale)} · ${formatDate(plan.nextInstallment.dueDate)}`,
                  })}
                </p>
              ) : (
                <p className="text-status-ok text-base">
                  {t("myPaymentsSettled")}
                </p>
              )}
              {/* Primario SOLO si los datos ya están completos. Con datos
                  incompletos el botón primario de esta pantalla es el de
                  "Mis datos": dos primarios no priorizan nada. */}
              <Button
                asChild
                size="lg"
                variant={
                  passenger.completeness.complete ? "default" : "outline"
                }
                className="w-full"
              >
                <Link href="/mis-pagos">
                  {t("myPaymentsAction")}
                  <ChevronRight aria-hidden="true" />
                </Link>
              </Button>
            </>
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
        <CardContent className="space-y-3">
          {news.length === 0 ? (
            <p className="text-muted-foreground text-base">{t("newsEmpty")}</p>
          ) : (
            <>
              {/* Solo las tres últimas: la home son tres tarjetas y esta no
                  puede crecer sin fin. El resto está en /novedades. */}
              <ul className="divide-border divide-y">
                {news.slice(0, 3).map((item, index) => (
                  <li key={`${item.id}-${index}`} className="space-y-0.5 py-2">
                    <p className="text-base font-medium">{item.subject}</p>
                    <p className="text-muted-foreground text-sm">
                      {tNews("receivedOn", {
                        date: formatDate(item.sentAt),
                      })}
                    </p>
                  </li>
                ))}
              </ul>
              <Button asChild variant="outline" className="w-full">
                <Link href="/novedades">
                  {tNews("seeAll")}
                  <ChevronRight aria-hidden="true" />
                </Link>
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

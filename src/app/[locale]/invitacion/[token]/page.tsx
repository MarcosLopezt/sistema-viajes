import { getTranslations, setRequestLocale } from "next-intl/server";
import { AlertCircle } from "lucide-react";
import { Link } from "@/i18n/navigation";
import {
  InvitationError,
  peekInvitation,
  type InvitationPreview,
} from "@/lib/services/invitations";
import { formatDate } from "@/lib/format";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { RedeemForm } from "./redeem-form";

/**
 * Pantalla de bienvenida de la invitación.
 *
 * Es la primera pantalla que ve un pasajero, y probablemente llegó acá desde
 * un WhatsApp, en el celular, sin saber bien qué es. Por eso lo primero que
 * dice es a qué viaje lo invitan y cuándo es, y recién después le pide algo.
 *
 * Vive fuera de los grupos (coordinador) y (pasajero) porque quien la abre
 * todavía no tiene sesión.
 */
export default async function InvitationPage({
  params,
}: PageProps<"/[locale]/invitacion/[token]">) {
  const { locale, token } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("redeem");
  const tInvite = await getTranslations("invitations");
  const tRooms = await getTranslations("roomTypes");

  let preview: InvitationPreview;
  try {
    preview = await peekInvitation(token);
  } catch (error) {
    const reason =
      error instanceof InvitationError ? error.reason : "INVALIDA";

    return (
      <Shell>
        <Alert variant="destructive" role="alert">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{tInvite(`errors.${reason}`)}</AlertDescription>
        </Alert>
        <Button asChild variant="outline" size="lg" className="mt-4 w-full">
          <Link href="/login">{t("goToLogin")}</Link>
        </Button>
      </Shell>
    );
  }

  return (
    <Shell>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl text-balance">
            {t("title", { trip: preview.trip.name })}
          </CardTitle>
          <CardDescription className="text-base">
            {t("subtitle", {
              from: formatDate(preview.trip.startDate),
              to: formatDate(preview.trip.endDate),
            })}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">
          {/* Sin jerga: el tipo de habitación se explica, no se nombra. */}
          <p className="text-muted-foreground text-base text-balance">
            {preview.roomType === "DOBLE"
              ? tRooms("doubleExplained")
              : tRooms("singleExplained")}
          </p>

          {preview.hasAccount ? (
            <div className="space-y-3">
              <Alert role="status">
                <AlertDescription className="space-y-1">
                  <strong className="font-medium">
                    {t("hasAccountTitle")}
                  </strong>
                  <p>{t("hasAccountBody")}</p>
                </AlertDescription>
              </Alert>
              <Button asChild size="lg" className="w-full">
                <Link href="/login">{t("goToLogin")}</Link>
              </Button>
            </div>
          ) : (
            <RedeemForm token={token} email={preview.email} />
          )}

          {preview.prefill?.hasData ? (
            <Alert role="status">
              <AlertDescription className="space-y-1">
                <strong className="font-medium">{t("prefilledTitle")}</strong>
                <p>{t("prefilledBody")}</p>
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-end">
          <LanguageSwitcher />
        </div>
        {children}
      </div>
    </main>
  );
}

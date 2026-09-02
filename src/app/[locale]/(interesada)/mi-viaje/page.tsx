import { getLocale, getTranslations } from "next-intl/server";
import { Clock, Check, TriangleAlert } from "lucide-react";
import { redirect } from "@/i18n/navigation";
import { requireSessionUser } from "@/lib/auth/guards";
import { getMyInterestView } from "@/lib/services/interest";
import { getMyDepositView } from "@/lib/services/deposits";
import { PlainText } from "@/components/public/plain-text";
import { DepositForm } from "@/components/interest/deposit-form";
import { UserMenu } from "@/components/layout/user-menu";
import { formatMoney } from "@/lib/format";

/**
 * La pantalla de la interesada. Es TODO lo que ve del sistema.
 *
 * La propuesta del viaje, qué sigue, la seña, y nada más. No hay cupos, ni
 * precios del viaje, ni fechas, ni una sola referencia a otra persona: los dos
 * servicios que alimentan esta página seleccionan campo por campo.
 *
 * ── Por qué no hace falta un guard de rol acá ─────────────────────────────
 *
 * Porque no hay ningún rol que verificar. Esta página no lee nada del viaje
 * por su cuenta: le pide al servicio lo suyo, y el servicio lo resuelve desde
 * la sesión. Alguien que no tenga Interest recibe `null` y se va a `/`, que lo
 * reencamina al panel que le corresponde.
 *
 * Lo que impide que una interesada entre a las pantallas internas no es una
 * comprobación de esta página: es que no tiene TripMember, y por eso todos los
 * guards del sistema le dicen que no. Ver el docblock del modelo Interest.
 *
 * ── La identidad es la de la zona pública, no la interna ─────────────────
 *
 * `zona-calida` —serifa en los títulos, paleta cálida— es la misma que usan
 * `/interes` y la pantalla de confirmación del registro. Para ella este es el
 * mismo lugar donde dejó sus datos, no un sistema de gestión: si acá se
 * encontrara con la tipografía y los grises del panel de coordinación, la
 * conclusión razonable sería que se metió donde no debía.
 */
export default async function MyTripPage() {
  const user = await requireSessionUser();

  const locale = await getLocale();
  const t = await getTranslations("interest");
  const tDeposit = await getTranslations("deposit");
  const tCommon = await getTranslations("common");

  const [view, deposit] = await Promise.all([
    getMyInterestView(locale),
    getMyDepositView(locale),
  ]);

  // Sin Interest esta pantalla no es suya. Se la manda al punto de entrada, que
  // decide adónde va según lo que sí sea.
  if (!view) redirect({ href: "/", locale });

  const localeCode = locale.toLowerCase().startsWith("en") ? "en" : "es";

  return (
    <div className="zona-calida flex min-h-full flex-1 flex-col">
      <a href="#contenido" className="skip-link">
        {tCommon("skipToContent")}
      </a>

      <header className="border-border flex h-16 shrink-0 items-center justify-between gap-2 border-b px-5">
        <span className="text-lg font-semibold">{tCommon("appName")}</span>
        <UserMenu email={user.email} />
      </header>

      <main
        id="contenido"
        className="mx-auto w-full max-w-xl flex-1 space-y-8 px-5 py-10"
      >
        <header className="space-y-2">
          <p className="text-muted-foreground text-sm tracking-wide uppercase">
            {t("eyebrow")}
          </p>
          <h1 className="text-4xl leading-tight">{view.tripName}</h1>
        </header>

        {view.infoForInterested ? (
          <PlainText text={view.infoForInterested} className="text-lg" />
        ) : (
          <p className="text-muted-foreground text-lg">{t("noInfoYet")}</p>
        )}

        {/* ── La seña ────────────────────────────────────────────────────
            Solo aparece si las coordinadoras ya cargaron el monto Y la
            condición. Sin cualquiera de los dos no hay nada que pedirle: un
            formulario de pago sin importe, o una aceptación sin texto que
            aceptar, son peores que la ausencia de la sección. */}
        {deposit && deposit.amount && deposit.terms ? (
          <section className="border-border bg-card space-y-5 rounded-lg border p-5">
            <div className="space-y-1">
              <h2 className="text-xl">{tDeposit("title")}</h2>
              <p className="text-3xl font-semibold">
                {formatMoney(deposit.amount, deposit.currency, localeCode)}
              </p>
            </div>

            {deposit.current ? (
              <DepositStatus
                status={deposit.current.status}
                label={
                  deposit.current.status === "EN_REVISION"
                    ? tDeposit("underReview")
                    : tDeposit("confirmed")
                }
                detail={
                  deposit.current.status === "EN_REVISION"
                    ? tDeposit("underReviewDetail")
                    : tDeposit("confirmedDetail")
                }
              />
            ) : (
              <>
                {/* El motivo del último rechazo, arriba del formulario y no en
                    un mail: es lo primero que va a preguntar al volver. */}
                {deposit.lastRejection ? (
                  <div
                    role="alert"
                    className="border-status-danger/40 bg-status-danger-surface space-y-2 rounded-lg border p-4"
                  >
                    <p className="text-status-danger flex items-center gap-2 text-base font-medium">
                      <TriangleAlert className="size-5 shrink-0" aria-hidden="true" />
                      {tDeposit("rejectedTitle")}
                    </p>
                    {deposit.lastRejection.reason ? (
                      <p className="text-base">{deposit.lastRejection.reason}</p>
                    ) : null}
                    <p className="text-muted-foreground text-sm">
                      {tDeposit("rejectedRetry")}
                    </p>
                  </div>
                ) : null}

                {/* Dónde transferir. Va ARRIBA del formulario: primero hay que
                    poder pagar, después subir el comprobante de haberlo hecho. */}
                {deposit.paymentInstructions ? (
                  <div className="border-border bg-muted/40 space-y-2 rounded-lg border p-4">
                    <h3 className="text-base font-medium">
                      {tDeposit("whereToPay")}
                    </h3>
                    <PlainText
                      text={deposit.paymentInstructions}
                      className="text-sm"
                    />
                  </div>
                ) : null}

                <DepositForm
                  terms={deposit.terms}
                  amountLabel={tDeposit("amountHint", {
                    amount: formatMoney(
                      deposit.amount,
                      deposit.currency,
                      localeCode,
                    ),
                  })}
                />
              </>
            )}
          </section>
        ) : null}

        {/* El MISMO bloque que vio al registrarse, y por la misma razón: si
            cerró la pestaña en ese momento, este es el único lugar donde
            vuelve a encontrar el número de WhatsApp. Se renderiza siempre,
            con el mismo texto de reserva. */}
        <section className="border-border bg-card rounded-lg border p-5">
          <h2 className="mb-2 text-xl">{t("nextStepTitle")}</h2>
          <PlainText text={view.nextStepMessage ?? t("nextStepFallback")} />
        </section>
      </main>
    </div>
  );
}

/** El estado de una seña ya enviada. Sin acciones: no hay nada que hacer. */
function DepositStatus({
  status,
  label,
  detail,
}: {
  status: "EN_REVISION" | "CONFIRMADO";
  label: string;
  detail: string;
}) {
  const review = status === "EN_REVISION";
  const Icon = review ? Clock : Check;

  return (
    <div
      className={
        review
          ? "border-status-warning/40 bg-status-warning-surface space-y-1 rounded-lg border p-4"
          : "border-status-ok/40 bg-status-ok-surface space-y-1 rounded-lg border p-4"
      }
    >
      <p
        className={
          review
            ? "text-status-warning flex items-center gap-2 text-base font-medium"
            : "text-status-ok flex items-center gap-2 text-base font-medium"
        }
      >
        <Icon className="size-5 shrink-0" aria-hidden="true" />
        {label}
      </p>
      <p className="text-base">{detail}</p>
    </div>
  );
}

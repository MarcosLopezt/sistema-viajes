import { getLocale, getTranslations } from "next-intl/server";
import { CheckCircle2, ChevronRight, Megaphone, Receipt, UserRound } from "lucide-react";
import { requireSessionUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/db/prisma";
import { evaluatePersonCompleteness } from "@/lib/domain/person";
import { formatDate, formatMoney, type LocaleCode } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Home del pasajero: exactamente tres tarjetas, nada más.
 *
 * Mis datos (con % de completitud) · Mis pagos · Novedades.
 *
 * El pasajero no ve ni puede llegar a los costos, el presupuesto o el margen:
 * esta consulta ni siquiera los trae. Tampoco aparecen las palabras "base
 * doble", "costo indirecto" ni "margen" en ninguna de las tarjetas.
 */
export default async function PassengerHomePage() {
  const user = await requireSessionUser();
  const locale = (await getLocale()) as LocaleCode;
  const t = await getTranslations("passengerHome");

  // Solo lo propio: el filtro sale de `user.personId`, que viene de la sesión.
  const passenger = user.personId
    ? await prisma.passenger.findFirst({
        where: { personId: user.personId, status: { not: "CANCELADO" } },
        orderBy: { trip: { startDate: "desc" } },
        select: {
          id: true,
          person: true,
          trip: { select: { id: true, name: true, currency: true } },
          paymentPlan: {
            select: {
              totalAmount: true,
              currency: true,
              installments: {
                where: { status: { in: ["PENDIENTE", "VENCIDA"] } },
                orderBy: { dueDate: "asc" },
                take: 1,
                select: { amount: true, dueDate: true },
              },
            },
          },
        },
      })
    : null;

  const completeness = passenger
    ? evaluatePersonCompleteness(passenger.person)
    : null;
  const nextInstallment = passenger?.paymentPlan?.installments[0] ?? null;
  const firstName = passenger?.person.fullName?.split(" ")[0] ?? "";

  return (
    <div className="space-y-5 py-2">
      {firstName ? (
        <h1 className="text-2xl font-semibold">
          {t("greeting", { name: firstName })}
        </h1>
      ) : null}

      {/* 1 — Mis datos */}
      <Card>
        <CardHeader className="gap-1">
          <CardTitle className="flex items-center gap-2 text-lg">
            <UserRound className="size-5" aria-hidden="true" />
            {t("myDataTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {completeness?.complete ? (
            <p className="text-status-ok flex items-center gap-2 text-base">
              <CheckCircle2 className="size-5" aria-hidden="true" />
              {t("myDataComplete")}
            </p>
          ) : (
            <>
              <p className="text-base">
                {t("myDataIncomplete", {
                  percent: 100 - (completeness?.completionPercentage ?? 0),
                })}
              </p>
              {/* Barra de progreso: `role="progressbar"` para que el lector de
                  pantalla anuncie el avance, no solo el color. */}
              <div
                role="progressbar"
                aria-valuenow={completeness?.completionPercentage ?? 0}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={t("myDataTitle")}
                className="bg-muted h-2.5 w-full overflow-hidden rounded-full"
              >
                <div
                  className="bg-primary h-full rounded-full transition-all"
                  style={{
                    width: `${completeness?.completionPercentage ?? 0}%`,
                  }}
                />
              </div>
              <Button size="lg" className="w-full" disabled>
                {t("myDataAction")}
                <ChevronRight aria-hidden="true" />
              </Button>
            </>
          )}
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
          {passenger?.paymentPlan ? (
            <>
              <p className="text-2xl font-semibold">
                {/* Decimal de Prisma no serializa a Client Components ni a
                    Intl: se convierte a string en el borde, siempre. */}
                {formatMoney(
                  passenger.paymentPlan.totalAmount.toString(),
                  passenger.paymentPlan.currency,
                  locale,
                )}
              </p>
              {nextInstallment ? (
                <p className="text-muted-foreground text-base">
                  {formatMoney(
                    nextInstallment.amount.toString(),
                    passenger.paymentPlan.currency,
                    locale,
                  )}{" "}
                  · {formatDate(nextInstallment.dueDate)}
                </p>
              ) : null}
              <Button size="lg" className="w-full" disabled>
                {t("myPaymentsAction")}
              </Button>
            </>
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

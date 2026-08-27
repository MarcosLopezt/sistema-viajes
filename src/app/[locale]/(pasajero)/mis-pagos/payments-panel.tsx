"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney, type CurrencyCode, type LocaleCode } from "@/lib/format";
import { InstallmentStateBadge } from "@/components/payments/payment-badges";
import { PaymentForm, type InstallmentOption } from "./payment-form";

/**
 * Lo interactivo de "Mis pagos": la lista de cuotas y el formulario.
 *
 * El resto de la pantalla —la pregunta grande de arriba— se renderiza en el
 * servidor. Acá abajo vive lo secundario, que es exactamente donde tiene que
 * estar: la pantalla responde "cuánto debo y cuándo" antes de que haya que
 * bajar, y el detalle queda para quien lo busque.
 */

export interface InstallmentView {
  id: string;
  number: number;
  amount: string;
  paid: string;
  remaining: string;
  state: "PAGADA" | "VENCIDA" | "EN_REVISION" | "PENDIENTE" | "CONGELADA";
  hasPendingProof: boolean;
  dueDateLabel: string;
}

export function PaymentsPanel({
  passengerId,
  installments,
  currency,
  locale,
  frozen,
  nextInstallmentId,
}: {
  passengerId: string;
  installments: InstallmentView[];
  currency: CurrencyCode;
  locale: LocaleCode;
  frozen: boolean;
  nextInstallmentId: string | null;
}) {
  const t = useTranslations("myPayments");
  const tPayments = useTranslations("payments");
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [formVisible, setFormVisible] = useState(false);

  // Un plan congelado no admite pagos nuevos, y las cuotas ya saldadas
  // tampoco: ofrecer el botón sería ofrecer algo que el servidor va a
  // rechazar.
  const payable = installments.filter(
    (i) => !frozen && i.state !== "PAGADA" && i.state !== "CONGELADA",
  );

  const options: InstallmentOption[] = payable.map((i) => ({
    id: i.id,
    number: i.number,
    remaining: i.remaining,
    dueDate: i.dueDateLabel,
  }));

  return (
    <div className="space-y-5">
      {payable.length > 0 ? (
        <Card>
          <CardHeader className="gap-1">
            <CardTitle className="text-lg">{t("formTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            {formVisible ? (
              <PaymentForm
                passengerId={passengerId}
                installments={options}
                tripCurrency={currency}
                locale={locale}
                defaultInstallmentId={openFor ?? nextInstallmentId}
                onDone={() => {
                  setFormVisible(false);
                  setOpenFor(null);
                }}
              />
            ) : (
              <Button
                size="lg"
                className="w-full"
                onClick={() => setFormVisible(true)}
              >
                <Upload aria-hidden="true" />
                {t("payAction")}
              </Button>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="gap-1">
          <CardTitle className="text-lg">{t("installmentsTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-border divide-y">
            {installments.map((cuota) => (
              <li key={cuota.id} className="flex flex-wrap gap-3 py-3">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="text-base font-medium">
                    {tPayments("installmentOf", {
                      number: cuota.number,
                      total: installments.length,
                    })}
                  </p>
                  <p className="text-muted-foreground text-sm">
                    {cuota.state === "VENCIDA"
                      ? tPayments("overdueSince", { date: cuota.dueDateLabel })
                      : tPayments("dueOn", { date: cuota.dueDateLabel })}
                  </p>
                  {/* Vencida Y con comprobante en revisión no es una
                      contradicción: la plata todavía no entró, pero el
                      pasajero ya hizo lo suyo y merece verlo dicho. */}
                  {cuota.state === "VENCIDA" && cuota.hasPendingProof ? (
                    <p className="text-status-warning text-sm">
                      {tPayments("pendingProofOnOverdue")}
                    </p>
                  ) : null}
                </div>

                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <p className="text-base font-semibold tabular-nums">
                    {formatMoney(cuota.amount, currency, locale)}
                  </p>
                  <InstallmentStateBadge state={cuota.state} />
                  {payable.some((p) => p.id === cuota.id) ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setOpenFor(cuota.id);
                        setFormVisible(true);
                      }}
                    >
                      {t("payAction")}
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

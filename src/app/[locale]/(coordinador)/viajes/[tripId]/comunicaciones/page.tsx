import { getTranslations } from "next-intl/server";
import { ArrowLeft, ChevronRight, PenLine } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { requireCapability } from "@/lib/auth/guards";
import { prisma } from "@/lib/db/prisma";
import { listCommunications } from "@/lib/services/communications";
import { formatDate, formatDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Listado de comunicaciones del viaje.
 *
 * Cada fila dice cuántos mails salieron sobre cuántos: es la pregunta que se
 * hace después de apretar enviar, y tenerla en el listado evita entrar a cada
 * una para averiguarlo.
 */
export default async function CommunicationsPage({
  params,
}: PageProps<"/[locale]/viajes/[tripId]/comunicaciones">) {
  const { tripId } = await params;
  await requireCapability(tripId, "communication:send");

  const [trip, communications, t] = await Promise.all([
    prisma.trip.findUniqueOrThrow({
      where: { id: tripId },
      select: { id: true, name: true },
    }),
    listCommunications(tripId),
    getTranslations("communications"),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-2">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/viajes/${trip.id}`}>
            <ArrowLeft aria-hidden="true" />
            {trip.name}
          </Link>
        </Button>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-semibold">{t("title")}</h1>
          <Button asChild>
            <Link href={`/viajes/${trip.id}/comunicaciones/nueva`}>
              <PenLine aria-hidden="true" />
              {t("new")}
            </Link>
          </Button>
        </div>
      </div>

      {communications.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground py-12 text-center text-base">
            {t("empty")}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-2">
            <ul className="divide-border divide-y">
              {communications.map((communication) => (
                <li key={communication.id}>
                  <Link
                    href={`/viajes/${trip.id}/comunicaciones/${communication.id}`}
                    className="hover:bg-muted/50 -mx-2 flex flex-wrap items-center gap-3 rounded-lg px-2 py-3 transition-colors"
                  >
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="text-base font-medium">
                        {communication.subjectEs}
                      </p>
                      <p className="text-muted-foreground text-sm">
                        {t(`audiences.${communication.audience}`)}
                        {communication.hasEnglish ? " · ES/EN" : " · ES"}
                        {communication.sentAt
                          ? ` · ${formatDateTime(communication.sentAt)}`
                          : communication.scheduledFor
                            ? ` · ${t("scheduledFor", {
                                date: formatDate(communication.scheduledFor),
                              })}`
                            : ""}
                      </p>
                      {communication.counts.total > 0 ? (
                        <p className="text-muted-foreground text-sm tabular-nums">
                          {t("counts", {
                            sent: communication.counts.sent,
                            total: communication.counts.total,
                          })}
                          {communication.counts.failed > 0
                            ? ` · ${t("recipientStatuses.FALLIDO")}: ${communication.counts.failed}`
                            : ""}
                        </p>
                      ) : null}
                    </div>

                    <Badge variant="outline">
                      {t(`statuses.${communication.status}`)}
                    </Badge>
                    <ChevronRight
                      className="text-muted-foreground size-5 shrink-0"
                      aria-hidden="true"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

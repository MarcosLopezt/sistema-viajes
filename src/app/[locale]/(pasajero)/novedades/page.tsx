import { getTranslations } from "next-intl/server";
import { ArrowLeft, Megaphone } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { requireSessionUser } from "@/lib/auth/guards";
import { getMyActivePassenger } from "@/lib/services/passengers";
import { listCommunicationsForPassenger } from "@/lib/services/communications";
import { formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Novedades del pasajero.
 *
 * Lista lo que EFECTIVAMENTE le llegó a esta persona, en el idioma en que se
 * le mandó. No es "las comunicaciones del viaje": alguien que entró la semana
 * pasada no tiene por qué ver los avisos de marzo, y alguien que estaba en una
 * selección de tres destinatarios no vio lo mismo que el resto.
 */
export default async function NewsPage() {
  await requireSessionUser();

  const t = await getTranslations("news");
  const tMyPayments = await getTranslations("myPayments");

  const passenger = await getMyActivePassenger();
  const news = passenger
    ? await listCommunicationsForPassenger(passenger.id)
    : [];

  return (
    <div className="space-y-5 py-2">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/inicio">
          <ArrowLeft aria-hidden="true" />
          {tMyPayments("backHome")}
        </Link>
      </Button>

      <h1 className="flex items-center gap-2 text-2xl font-semibold">
        <Megaphone className="size-6" aria-hidden="true" />
        {t("title")}
      </h1>

      {news.length === 0 ? (
        <p className="text-muted-foreground text-base">{t("empty")}</p>
      ) : (
        <ul className="space-y-4">
          {news.map((item, index) => (
            <li key={`${item.id}-${index}`}>
              <Card>
                <CardHeader className="gap-1">
                  <CardTitle className="text-lg">{item.subject}</CardTitle>
                  <p className="text-muted-foreground text-sm">
                    {t("receivedOn", { date: formatDateTime(item.sentAt) })}
                  </p>
                </CardHeader>
                <CardContent>
                  {/* El cuerpo se muestra como TEXTO, respetando los saltos de
                      línea. Nunca como HTML: lo escribió una persona en un
                      textarea y renderizarlo como marcado sería confiar en que
                      nadie pegue nada raro. */}
                  <p className="text-base whitespace-pre-line">{item.body}</p>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireSessionUser } from "@/lib/auth/guards";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { NewTripForm } from "./new-trip-form";

/**
 * Paso 1 del wizard, antes de que el viaje exista.
 *
 * Al enviarse crea el borrador y redirige al wizard sobre ese id, desde donde
 * cada paso autoguarda. Es el único momento del armado en que hay un
 * formulario que se envía entero: a partir de acá todo es incremental.
 */
export default async function NewTripPage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Cualquier usuario autenticado puede crear un viaje y queda como su
  // coordinador. La restricción por rol aparece recién sobre viajes ajenos.
  await requireSessionUser();

  const t = await getTranslations("budget.newTrip");

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">{t("title")}</CardTitle>
          <CardDescription className="text-base text-balance">
            {t("subtitle")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NewTripForm />
        </CardContent>
      </Card>
    </div>
  );
}

import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ResetForm } from "./reset-form";

/**
 * Pantalla a la que llega el usuario desde el link de recuperación.
 *
 * Para cuando se renderiza, el callback en /api/auth/callback ya canjeó el
 * código por una sesión, así que acá solo se elige la contraseña nueva. Nunca
 * viaja una contraseña por mail: el mail solo lleva un link de un solo uso.
 */
export default async function ResetPage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("auth.reset");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">{t("title")}</CardTitle>
        <CardDescription className="text-base">
          {t("subtitle")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ResetForm />
      </CardContent>
    </Card>
  );
}

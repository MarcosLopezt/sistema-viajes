import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { RecoverForm } from "./recover-form";

export default async function RecoverPage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("auth.recover");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">{t("title")}</CardTitle>
        <CardDescription className="text-base">
          {t("subtitle")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <RecoverForm />
        <div className="text-center">
          <Link
            href="/login"
            className="text-primary inline-block py-2 text-base underline underline-offset-4"
          >
            {t("backToLogin")}
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

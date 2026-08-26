import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LoginForm } from "./login-form";

export default async function LoginPage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("auth.login");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">{t("title")}</CardTitle>
        <CardDescription className="text-base">
          {t("subtitle")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <LoginForm />
        <div className="space-y-3 text-center">
          <Link
            href="/recuperar"
            className="text-primary inline-block py-2 text-base underline underline-offset-4"
          >
            {t("forgotPassword")}
          </Link>
          {/* El sistema no tiene registro abierto: se entra por invitación.
              Decirlo acá evita que alguien busque un botón que no existe. */}
          <p className="text-muted-foreground text-sm text-balance">
            {t("noSelfSignup")}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

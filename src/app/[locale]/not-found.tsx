import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";

export default async function NotFound() {
  const t = await getTranslations("errors");

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-5 px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">{t("notFoundTitle")}</h1>
      <p className="text-muted-foreground max-w-md text-base text-balance">
        {t("notFoundBody")}
      </p>
      <Button asChild size="lg">
        <Link href="/">{t("backHome")}</Link>
      </Button>
    </main>
  );
}

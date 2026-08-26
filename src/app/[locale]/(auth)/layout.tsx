import { LanguageSwitcher } from "@/components/layout/language-switcher";

/**
 * Pantallas de acceso: una sola columna, centrada, pensada a 375px de ancho.
 * El selector de idioma está acá arriba porque es lo primero que puede
 * necesitar alguien que abre el link y no lee español.
 */
export default function AuthLayout({ children }: LayoutProps<"/[locale]">) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-end">
          <LanguageSwitcher />
        </div>
        {children}
      </div>
    </main>
  );
}

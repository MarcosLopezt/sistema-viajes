"use client";

import { useTranslations } from "next-intl";
import { LayoutList, Settings, type LucideIcon } from "lucide-react";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/**
 * Navegación del panel del coordinador.
 *
 * Solo tiene dos entradas a propósito: pasajeros, pagos y comunicaciones
 * cuelgan de un viaje concreto (`/viajes/[id]/pasajeros`), no de un menú
 * global. Un ítem "Pasajeros" suelto obligaría a preguntar "¿de cuál viaje?"
 * en cada pantalla.
 */
interface NavItem {
  href: "/viajes" | "/admin";
  labelKey: "trips" | "admin";
  icon: LucideIcon;
  adminOnly?: boolean;
}

const ITEMS: readonly NavItem[] = [
  { href: "/viajes", labelKey: "trips", icon: LayoutList },
  { href: "/admin", labelKey: "admin", icon: Settings, adminOnly: true },
];

export function CoordinatorNav({ isAdmin }: { isAdmin: boolean }) {
  const t = useTranslations("nav.coordinator");
  const pathname = usePathname();
  const items = ITEMS.filter((item) => !item.adminOnly || isAdmin);

  return (
    <nav
      aria-label={t("sectionLabel")}
      className="border-border bg-sidebar shrink-0 border-b md:w-60 md:border-r md:border-b-0"
    >
      {/* En mobile la navegación es una tira horizontal desplazable; en
          escritorio, una columna fija. */}
      <ul className="flex gap-1 overflow-x-auto p-2 md:flex-col md:gap-0.5 md:p-3">
        {items.map(({ href, labelKey, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center gap-2.5 rounded-lg px-3 py-2 text-base whitespace-nowrap transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/60",
                )}
              >
                <Icon className="size-5 shrink-0" aria-hidden="true" />
                {t(labelKey)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

"use client";

import { useTranslations } from "next-intl";
import { LogOut, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LanguageSwitcher } from "./language-switcher";
import { logoutAction } from "@/app/[locale]/(auth)/actions";

export function UserMenu({ email }: { email: string }) {
  const t = useTranslations("common");

  return (
    <div className="flex items-center gap-1">
      <LanguageSwitcher />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={email}>
            <UserRound aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuLabel className="truncate font-normal">
            {email}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            {/* El logout es una Server Action: invalida la sesión en el
                servidor, no solo borra la cookie del navegador. */}
            <form action={logoutAction}>
              <button type="submit" className="flex w-full items-center gap-2">
                <LogOut className="size-4" aria-hidden="true" />
                {t("logout")}
              </button>
            </form>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

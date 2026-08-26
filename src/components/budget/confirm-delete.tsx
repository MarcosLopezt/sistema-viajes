"use client";

import { useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

/**
 * Confirmación de una acción destructiva.
 *
 * `description` tiene que decir QUÉ se va a perder, no preguntar "¿estás
 * seguro?". Borrar un destino se lleva sus hoteles puestos, y eso hay que
 * decirlo antes, no después.
 */
export function ConfirmDelete({
  description,
  onConfirm,
  label,
}: {
  description: string;
  onConfirm: () => void;
  /** Nombre accesible del botón: "Eliminar «Cena de bienvenida»". */
  label: string;
}) {
  const t = useTranslations("budget.actions");
  const tCommon = useTranslations("common");

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label}>
          <Trash2 className="text-status-danger" aria-hidden="true" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("delete")}</AlertDialogTitle>
          <AlertDialogDescription className="text-base">
            {description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            {t("confirmDelete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

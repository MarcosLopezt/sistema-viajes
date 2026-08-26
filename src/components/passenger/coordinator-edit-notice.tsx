"use client";

import { useTranslations } from "next-intl";
import { Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { formatDate } from "@/lib/format";
import type { CoordinatorEdit } from "@/lib/services/passengers";

/**
 * Aviso de que un coordinador modificó los datos del pasajero.
 *
 * Que alguien más te cambie el número de pasaporte sin que te enteres no es
 * aceptable, así que el aviso dice QUÉ campos se tocaron y CUÁNDO. Se agrupa
 * por fecha para no mostrar diez líneas cuando el coordinador corrigió cinco
 * campos de una sentada.
 *
 * No dice quién lo hizo: en un viaje con dos coordinadores el dato no le
 * aporta nada al pasajero y sí expone actividad interna. En el AuditLog queda
 * completo, con el actor.
 */
export function CoordinatorEditNotice({
  edits,
}: {
  edits: (Omit<CoordinatorEdit, "at"> & { at: Date | string })[];
}) {
  const t = useTranslations("dataNotice");

  if (edits.length === 0) return null;

  // Se agrupa por día: varios campos corregidos en la misma sesión son un
  // solo evento desde el punto de vista de quien lo lee.
  const byDay = new Map<string, string[]>();
  for (const edit of edits) {
    const day = new Date(edit.at).toISOString().slice(0, 10);
    const fields = byDay.get(day) ?? [];
    if (!fields.includes(edit.field)) fields.push(edit.field);
    byDay.set(day, fields);
  }

  const fieldName = (field: string): string => {
    // Si aparece un campo sin traducción, se muestra su nombre crudo en vez
    // de romper la pantalla entera.
    try {
      return t(`fieldNames.${field}`);
    } catch {
      return field;
    }
  };

  return (
    <Alert role="status">
      <Info aria-hidden="true" />
      <AlertDescription className="space-y-1.5">
        <strong className="font-medium">{t("title")}</strong>
        {[...byDay.entries()].slice(0, 3).map(([day, fields]) => (
          <p key={day} className="text-base">
            {t("body", {
              date: formatDate(`${day}T00:00:00.000Z`),
              fields: fields.map(fieldName).join(", "),
            })}
          </p>
        ))}
      </AlertDescription>
    </Alert>
  );
}

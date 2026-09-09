"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Check, UserPlus } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDate } from "@/lib/format";
import {
  convertInterestAction,
  setInterestNotesAction,
  setInterestStatusAction,
  setMeetingDoneAction,
} from "./actions";

/**
 * El listado del embudo.
 *
 * Cada fila muestra los cuatro datos de contacto que dejó, en qué estado está,
 * si ya tuvieron la reunión, y el botón de convertir.
 *
 * El mail y el teléfono van como links `mailto:` y `wa.me`: el próximo paso
 * real es escribirle, y hacer que la coordinadora copie un número a mano desde
 * una tabla es exactamente la fricción que el sistema vino a sacar.
 */

export interface InterestRow {
  id: string;
  status: "REGISTRADA" | "EN_CONVERSACION" | "CONVERTIDA" | "DESCARTADA";
  meetingDone: boolean;
  notes: string | null;
  createdAt: Date;
  fullName: string | null;
  email: string;
  residenceCountry: string | null;
  phone: string | null;
  alreadyPassenger: boolean;
}

const STATUS_VARIANT: Record<InterestRow["status"], "default" | "secondary" | "outline"> = {
  REGISTRADA: "secondary",
  EN_CONVERSACION: "default",
  CONVERTIDA: "outline",
  DESCARTADA: "outline",
};

export function InterestTable({
  tripId,
  rows,
}: {
  tripId: string;
  rows: InterestRow[];
}) {
  const t = useTranslations("interests");

  const [error, setError] = useState<string | null>(null);
  const [converting, setConverting] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handle = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      setError(null);
      const result = await fn();
      if (!result.ok) setError(result.error ?? t("actionFailed"));
      else setConverting(null);
    });

  /** El número para wa.me: sin espacios, paréntesis ni guiones. */
  const whatsappNumber = (phone: string) => phone.replace(/[^\d]/g, "");

  return (
    <div className="space-y-4">
      {error ? (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <ul className="space-y-3">
        {rows.map((row) => (
          <li
            key={row.id}
            className="border-border space-y-3 rounded-lg border p-4"
          >
            {/* ------------------------------------------- quién es y su estado */}
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <p className="text-lg font-medium">
                  {row.fullName ?? t("noName")}
                </p>
                <p className="text-muted-foreground text-sm">
                  <a
                    href={`mailto:${row.email}`}
                    className="underline underline-offset-4"
                  >
                    {row.email}
                  </a>
                  {row.residenceCountry ? ` · ${row.residenceCountry}` : ""}
                </p>
                {row.phone ? (
                  <p className="text-sm">
                    <a
                      href={`https://wa.me/${whatsappNumber(row.phone)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-4"
                    >
                      {row.phone}
                    </a>
                  </p>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    {t("noPhone")}
                  </p>
                )}
              </div>

              <div className="flex flex-col items-end gap-1">
                <Badge variant={STATUS_VARIANT[row.status]}>
                  {t(`status.${row.status}`)}
                </Badge>
                <span className="text-muted-foreground text-xs">
                  {t("signedUpOn", { date: formatDate(row.createdAt) })}
                </span>
              </div>
            </div>

            {/* ------------------------------------------------- mover el embudo */}
            {row.status === "CONVERTIDA" ? (
              <p className="text-muted-foreground flex items-center gap-2 text-sm">
                <Check className="size-4" aria-hidden="true" />
                {t("alreadyConverted")}
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={row.meetingDone}
                    disabled={pending}
                    onCheckedChange={(checked) =>
                      handle(() =>
                        setMeetingDoneAction(row.id, tripId, checked === true),
                      )
                    }
                  />
                  {t("meetingDone")}
                </label>

                <Select
                  value={row.status}
                  disabled={pending}
                  onValueChange={(value) =>
                    handle(() => setInterestStatusAction(row.id, tripId, value))
                  }
                >
                  <SelectTrigger className="w-52">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="REGISTRADA">
                      {t("status.REGISTRADA")}
                    </SelectItem>
                    <SelectItem value="EN_CONVERSACION">
                      {t("status.EN_CONVERSACION")}
                    </SelectItem>
                    <SelectItem value="DESCARTADA">
                      {t("status.DESCARTADA")}
                    </SelectItem>
                  </SelectContent>
                </Select>

                {/* El tipo de habitación ya no se pide acá: nace sin él y lo
                    elige ella en su formulario de datos. */}
                {row.alreadyPassenger ? (
                  <span className="text-muted-foreground text-sm">
                    {t("alreadyPassenger")}
                  </span>
                ) : converting === row.id ? (
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      disabled={pending}
                      onClick={() =>
                        handle(() => convertInterestAction(row.id, tripId))
                      }
                    >
                      {t("confirmConvert")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setConverting(null)}
                    >
                      {t("cancel")}
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending || row.status === "DESCARTADA"}
                    onClick={() => setConverting(row.id)}
                  >
                    <UserPlus aria-hidden="true" />
                    {t("convert")}
                  </Button>
                )}
              </div>
            )}

            {/* Notas de la coordinadora. La interesada NO las ve nunca: no
                salen de `getMyInterestView()`, que devuelve cuatro campos y
                ninguno es este. Se guardan al salir del campo y no con un
                botón, porque son un borrador que se va escribiendo entre
                llamada y llamada. */}
            <NotesField
              key={`${row.id}-notes`}
              initial={row.notes ?? ""}
              disabled={pending}
              onSave={(notes) =>
                handle(() => setInterestNotesAction(row.id, tripId, notes))
              }
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function NotesField({
  initial,
  disabled,
  onSave,
}: {
  initial: string;
  disabled: boolean;
  onSave: (notes: string) => void;
}) {
  const t = useTranslations("interests");
  const [value, setValue] = useState(initial);

  return (
    <Textarea
      rows={2}
      disabled={disabled}
      placeholder={t("notesPlaceholder")}
      aria-label={t("notes")}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      // Solo si cambió: sin esta comparación, hacer foco y salir dispararía
      // una escritura por cada fila que la coordinadora toca al pasar.
      onBlur={() => {
        if (value !== initial) onSave(value);
      }}
    />
  );
}

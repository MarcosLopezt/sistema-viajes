"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Hotel, MapPin, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney, type CurrencyCode, type LocaleCode } from "@/lib/format";
import { Field } from "@/components/form/field";
import { ConfirmDelete } from "./confirm-delete";
import type { WizardAccommodation, WizardStop } from "./types";

/**
 * Paso 2 — itinerario y hoteles.
 *
 * Los hoteles cuelgan del destino porque es como piensa el coordinador: no
 * carga "hoteles del viaje", carga qué hotel en qué ciudad y cuántas noches.
 *
 * Los precios son POR PERSONA y POR NOCHE. El texto de ayuda lo repite en cada
 * hotel: es la confusión más común de esta pantalla, y confundirlo mueve el
 * costo del viaje entero.
 */
export function StepItinerary({
  stops,
  currency,
  disabled,
  onSaveStop,
  onDeleteStop,
  onSaveAccommodation,
  onDeleteAccommodation,
}: {
  stops: WizardStop[];
  currency: CurrencyCode;
  disabled?: boolean;
  onSaveStop: (
    stop: Omit<WizardStop, "accommodations">,
  ) => Promise<{ ok: boolean; error?: string }>;
  onDeleteStop: (stopId: string) => void;
  onSaveAccommodation: (
    stopId: string,
    accommodation: WizardAccommodation,
  ) => Promise<{ ok: boolean; error?: string }>;
  onDeleteAccommodation: (accommodationId: string) => void;
}) {
  const t = useTranslations("budget.itinerary");
  const tActions = useTranslations("budget.actions");

  const [editingStop, setEditingStop] = useState<Omit<
    WizardStop,
    "accommodations"
  > | null>(null);
  const [stopError, setStopError] = useState<string | null>(null);

  const blankStop = () => ({
    id: "",
    order: stops.length + 1,
    city: "",
    country: "",
    fromDate: "",
    toDate: "",
    notes: null,
  });

  return (
    <div className="space-y-5">
      {stops.length === 0 && editingStop === null ? (
        <div className="border-border flex flex-col items-center gap-3 rounded-xl border border-dashed py-10 text-center">
          <MapPin className="text-muted-foreground size-8" aria-hidden="true" />
          <p className="text-muted-foreground text-base text-balance">
            {t("empty")}
          </p>
        </div>
      ) : null}

      <ol className="space-y-4">
        {stops.map((stop) => (
          <li
            key={stop.id}
            className="border-border overflow-hidden rounded-xl border"
          >
            <div className="bg-muted/40 flex items-start justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="text-lg font-medium">
                  {stop.order}. {stop.city}
                </p>
                <p className="text-muted-foreground text-sm">
                  {stop.country} · {stop.fromDate} — {stop.toDate}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  onClick={() =>
                    // Se edita el destino sin sus hoteles: los hoteles tienen
                    // su propio formulario, más abajo en la misma tarjeta.
                    setEditingStop({
                      id: stop.id,
                      order: stop.order,
                      city: stop.city,
                      country: stop.country,
                      fromDate: stop.fromDate,
                      toDate: stop.toDate,
                      notes: stop.notes,
                    })
                  }
                >
                  {tActions("edit")}
                </Button>
                {!disabled ? (
                  <ConfirmDelete
                    label={`${tActions("delete")} ${stop.city}`}
                    description={tActions("deleteStopConfirm", {
                      name: stop.city,
                    })}
                    onConfirm={() => onDeleteStop(stop.id)}
                  />
                ) : null}
              </div>
            </div>

            <Accommodations
              stop={stop}
              currency={currency}
              disabled={disabled}
              onSave={(accommodation) =>
                onSaveAccommodation(stop.id, accommodation)
              }
              onDelete={onDeleteAccommodation}
            />
          </li>
        ))}
      </ol>

      {editingStop !== null ? (
        <StopForm
          stop={editingStop}
          error={stopError}
          onCancel={() => {
            setEditingStop(null);
            setStopError(null);
          }}
          onSubmit={async (stop) => {
            const result = await onSaveStop(stop);
            if (result.ok) {
              setEditingStop(null);
              setStopError(null);
            } else {
              setStopError(result.error ?? tActions("saveError"));
            }
          }}
        />
      ) : (
        <Button
          variant="outline"
          disabled={disabled}
          onClick={() => setEditingStop(blankStop())}
        >
          <Plus aria-hidden="true" />
          {t("addStop")}
        </Button>
      )}
    </div>
  );
}

function StopForm({
  stop,
  error,
  onCancel,
  onSubmit,
}: {
  stop: Omit<WizardStop, "accommodations">;
  error: string | null;
  onCancel: () => void;
  onSubmit: (stop: Omit<WizardStop, "accommodations">) => void;
}) {
  const t = useTranslations("budget.itinerary");
  const tActions = useTranslations("budget.actions");
  const tCommon = useTranslations("common");
  const [draft, setDraft] = useState(stop);

  return (
    <form
      className="border-border space-y-4 rounded-xl border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(draft);
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("city")} required>
          {(props) => (
            <Input
              {...props}
              value={draft.city}
              onChange={(e) => setDraft({ ...draft, city: e.target.value })}
              required
            />
          )}
        </Field>
        <Field label={t("country")} required>
          {(props) => (
            <Input
              {...props}
              value={draft.country}
              onChange={(e) => setDraft({ ...draft, country: e.target.value })}
              required
            />
          )}
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("fromDate")} required>
          {(props) => (
            <Input
              {...props}
              type="date"
              value={draft.fromDate}
              onChange={(e) => setDraft({ ...draft, fromDate: e.target.value })}
              required
            />
          )}
        </Field>
        <Field label={t("toDate")} error={error ?? undefined} required>
          {(props) => (
            <Input
              {...props}
              type="date"
              value={draft.toDate}
              onChange={(e) => setDraft({ ...draft, toDate: e.target.value })}
              required
            />
          )}
        </Field>
      </div>

      <div className="flex gap-2">
        <Button type="submit">{tActions("add")}</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {tCommon("cancel")}
        </Button>
      </div>
    </form>
  );
}

function Accommodations({
  stop,
  currency,
  disabled,
  onSave,
  onDelete,
}: {
  stop: WizardStop;
  currency: CurrencyCode;
  disabled?: boolean;
  onSave: (
    accommodation: WizardAccommodation,
  ) => Promise<{ ok: boolean; error?: string }>;
  onDelete: (accommodationId: string) => void;
}) {
  const t = useTranslations("budget.itinerary");
  const tActions = useTranslations("budget.actions");
  const tCommon = useTranslations("common");
  const locale = useLocale() as LocaleCode;

  const [editing, setEditing] = useState<WizardAccommodation | null>(null);
  const [error, setError] = useState<string | null>(null);

  const blank = (): WizardAccommodation => ({
    id: "",
    hotelName: "",
    nights: 1,
    pricePerNightDouble: "",
    pricePerNightSingle: "",
    notes: null,
  });

  return (
    <div className="space-y-3 p-4">
      <h4 className="text-muted-foreground flex items-center gap-1.5 text-sm font-medium">
        <Hotel className="size-4" aria-hidden="true" />
        {t("hotels")}
      </h4>

      {stop.accommodations.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("noHotels")}</p>
      ) : (
        <ul className="divide-border divide-y">
          {stop.accommodations.map((accommodation) => (
            <li
              key={accommodation.id}
              className="flex min-h-14 flex-wrap items-center justify-between gap-2 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-base">{accommodation.hotelName}</p>
                <p className="text-muted-foreground text-sm tabular-nums">
                  {accommodation.nights} ×{" "}
                  {formatMoney(
                    accommodation.pricePerNightDouble,
                    currency,
                    locale,
                  )}{" "}
                  /{" "}
                  {formatMoney(
                    accommodation.pricePerNightSingle,
                    currency,
                    locale,
                  )}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  onClick={() => setEditing(accommodation)}
                >
                  {tActions("edit")}
                </Button>
                {!disabled ? (
                  <ConfirmDelete
                    label={`${tActions("delete")} ${accommodation.hotelName}`}
                    description={tActions("deleteHotelConfirm", {
                      name: accommodation.hotelName,
                    })}
                    onConfirm={() => onDelete(accommodation.id)}
                  />
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing !== null ? (
        <AccommodationForm
          accommodation={editing}
          error={error}
          onCancel={() => {
            setEditing(null);
            setError(null);
          }}
          onSubmit={async (accommodation) => {
            const result = await onSave(accommodation);
            if (result.ok) {
              setEditing(null);
              setError(null);
            } else {
              setError(result.error ?? tCommon("cancel"));
            }
          }}
        />
      ) : (
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => setEditing(blank())}
        >
          <Plus aria-hidden="true" />
          {t("addHotel")}
        </Button>
      )}
    </div>
  );
}

function AccommodationForm({
  accommodation,
  error,
  onCancel,
  onSubmit,
}: {
  accommodation: WizardAccommodation;
  error: string | null;
  onCancel: () => void;
  onSubmit: (accommodation: WizardAccommodation) => void;
}) {
  const t = useTranslations("budget.itinerary");
  const tActions = useTranslations("budget.actions");
  const tCommon = useTranslations("common");
  const [draft, setDraft] = useState(accommodation);

  return (
    <form
      className="bg-muted/30 space-y-4 rounded-lg p-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(draft);
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("hotelName")} required>
          {(props) => (
            <Input
              {...props}
              value={draft.hotelName}
              onChange={(e) =>
                setDraft({ ...draft, hotelName: e.target.value })
              }
              required
            />
          )}
        </Field>
        <Field label={t("nights")} required>
          {(props) => (
            <Input
              {...props}
              type="number"
              inputMode="numeric"
              min={1}
              value={draft.nights}
              onChange={(e) =>
                setDraft({ ...draft, nights: Number(e.target.value) || 1 })
              }
              required
            />
          )}
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("pricePerNightDouble")} help={t("perPersonHelp")} required>
          {(props) => (
            <Input
              {...props}
              inputMode="decimal"
              placeholder="0.00"
              value={draft.pricePerNightDouble}
              onChange={(e) =>
                setDraft({ ...draft, pricePerNightDouble: e.target.value })
              }
              required
            />
          )}
        </Field>
        <Field
          label={t("pricePerNightSingle")}
          help={t("perPersonHelp")}
          error={error ?? undefined}
          required
        >
          {(props) => (
            <Input
              {...props}
              inputMode="decimal"
              placeholder="0.00"
              value={draft.pricePerNightSingle}
              onChange={(e) =>
                setDraft({ ...draft, pricePerNightSingle: e.target.value })
              }
              required
            />
          )}
        </Field>
      </div>

      <div className="flex gap-2">
        <Button type="submit" size="sm">
          {tActions("add")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {tCommon("cancel")}
        </Button>
      </div>
    </form>
  );
}

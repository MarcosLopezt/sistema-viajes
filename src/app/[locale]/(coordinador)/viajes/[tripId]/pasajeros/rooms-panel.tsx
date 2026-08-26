"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, BedDouble, Plus } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field } from "@/components/form/field";
import { assignRoomAction, createRoomAction } from "./actions";
import type { PassengerRow, RoomRow } from "./types";

const UNASSIGNED = "__sin-asignar__";

/**
 * Armado de habitaciones.
 *
 * Cada habitación admite dos personas como máximo; el tope lo impone el
 * servicio dentro de una transacción, así que dos asignaciones simultáneas no
 * pueden dejar tres.
 *
 * Quien queda solo en habitación compartida aparece marcado, pero el precio
 * NO cambia solo: eso se decide en la ficha del pasajero, con un motivo, y
 * queda auditado.
 */
export function RoomsPanel({
  tripId,
  rooms,
  passengers,
}: {
  tripId: string;
  rooms: RoomRow[];
  passengers: PassengerRow[];
}) {
  const t = useTranslations("rooms");
  const tPassengers = useTranslations("passengers");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function addRoom() {
    setError(null);
    startTransition(async () => {
      const result = await createRoomAction(tripId, label);
      if (result.ok) setLabel("");
      else setError(result.error);
    });
  }

  function assign(passengerId: string, roomId: string) {
    setError(null);
    startTransition(async () => {
      const result = await assignRoomAction(
        tripId,
        passengerId,
        roomId === UNASSIGNED ? null : roomId,
      );
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="space-y-6">
      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          addRoom();
        }}
      >
        <Field label={t("label")} className="min-w-48">
          {(props) => (
            <Input
              {...props}
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="101"
              required
            />
          )}
        </Field>
        <Button type="submit" disabled={pending || label.trim() === ""}>
          <Plus aria-hidden="true" />
          {t("add")}
        </Button>
      </form>

      {rooms.length === 0 ? (
        <div className="border-border flex flex-col items-center gap-3 rounded-xl border border-dashed py-10 text-center">
          <BedDouble
            className="text-muted-foreground size-8"
            aria-hidden="true"
          />
          <p className="text-muted-foreground text-base">{t("empty")}</p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {rooms.map((room) => (
            <li key={room.id} className="border-border rounded-xl border p-4">
              <p className="text-base font-medium">{room.label}</p>
              <p className="text-muted-foreground text-sm">
                {t("occupants", { count: room.occupants.length })}
              </p>
              <ul className="mt-2 space-y-1">
                {room.occupants.map((occupant) => (
                  <li key={occupant.id} className="text-base">
                    {occupant.fullName ?? "—"}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      <section className="space-y-3">
        <h3 className="text-lg font-medium">{tPassengers("title")}</h3>
        <ul className="divide-border divide-y">
          {passengers.map((passenger) => (
            <li
              key={passenger.id}
              className="flex min-h-14 flex-wrap items-center justify-between gap-3 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-base">
                  {passenger.fullName ?? "—"}
                </p>
                {passenger.needsRoommate ? (
                  <p className="text-status-warning text-sm">{t("alone")}</p>
                ) : null}
              </div>

              <Select
                value={passenger.roomId ?? UNASSIGNED}
                disabled={pending}
                onValueChange={(value) => assign(passenger.id, value)}
              >
                <SelectTrigger
                  aria-label={`${t("assign")} ${passenger.fullName ?? ""}`}
                  className="w-48"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>{t("unassigned")}</SelectItem>
                  {rooms.map((room) => (
                    <SelectItem
                      key={room.id}
                      value={room.id}
                      // Una habitación llena no se ofrece, salvo que sea la
                      // que ya ocupa esta persona.
                      disabled={
                        room.occupants.length >= 2 &&
                        passenger.roomId !== room.id
                      }
                    >
                      {room.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

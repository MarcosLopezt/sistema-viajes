"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, Plus, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  assignTripMemberAction,
  removeTripMemberAction,
  setGlobalRoleAction,
} from "./actions";

export interface AdminUserView {
  id: string;
  email: string;
  fullName: string | null;
  role: "ADMIN" | "USER";
  memberships: { tripId: string; tripName: string; role: string }[];
}

export interface TripOption {
  id: string;
  name: string;
}

/**
 * Gestión de usuarios y roles.
 *
 * Dos cosas y nada más: el rol global y la pertenencia a viajes. No hay alta
 * ni baja de usuarios porque no existe tal camino — se entra canjeando una
 * invitación.
 *
 * El propio usuario aparece con el selector de rol deshabilitado. El servicio
 * lo rechaza igual; deshabilitarlo acá evita el intento y explica por qué.
 */
export function UsersPanel({
  users,
  trips,
  currentUserId,
}: {
  users: AdminUserView[];
  trips: TripOption[];
  currentUserId: string;
}) {
  const t = useTranslations("admin");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function act(operation: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await operation();
      if (!result.ok) setError(result.error ?? t("genericError"));
    });
  }

  return (
    <div className="space-y-4">
      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {users.map((user) => (
        <Card key={user.id}>
          <CardContent className="space-y-4 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-base font-medium">
                  {user.fullName ?? user.email}
                </p>
                {user.fullName ? (
                  <p className="text-muted-foreground truncate text-sm">
                    {user.email}
                  </p>
                ) : null}
              </div>

              <div className="flex items-center gap-2">
                {user.id === currentUserId ? (
                  <Badge variant="secondary">{t("you")}</Badge>
                ) : null}
                <Select
                  value={user.role}
                  disabled={pending || user.id === currentUserId}
                  onValueChange={(role) =>
                    act(() => setGlobalRoleAction({ userId: user.id, role }))
                  }
                >
                  <SelectTrigger
                    className="w-36"
                    aria-label={t("globalRoleFor", {
                      name: user.fullName ?? user.email,
                    })}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USER">{t("roleUser")}</SelectItem>
                    <SelectItem value="ADMIN">{t("roleAdmin")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <TripMemberships
              user={user}
              trips={trips}
              pending={pending}
              onAssign={(tripId, role) =>
                act(() =>
                  assignTripMemberAction({ tripId, userId: user.id, role }),
                )
              }
              onRemove={(tripId) =>
                act(() => removeTripMemberAction({ tripId, userId: user.id }))
              }
            />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function TripMemberships({
  user,
  trips,
  pending,
  onAssign,
  onRemove,
}: {
  user: AdminUserView;
  trips: TripOption[];
  pending: boolean;
  onAssign: (tripId: string, role: string) => void;
  onRemove: (tripId: string) => void;
}) {
  const t = useTranslations("admin");
  const [tripId, setTripId] = useState("");
  const [role, setRole] = useState("PASAJERO");

  const assigned = new Set(user.memberships.map((m) => m.tripId));
  const available = trips.filter((trip) => !assigned.has(trip.id));

  return (
    <div className="space-y-3 border-t pt-3">
      {user.memberships.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("noTrips")}</p>
      ) : (
        <ul className="space-y-2">
          {user.memberships.map((membership) => (
            <li
              key={membership.tripId}
              className="flex flex-wrap items-center gap-2"
            >
              <span className="min-w-0 flex-1 truncate text-sm">
                {membership.tripName}
              </span>
              <Badge
                variant={
                  membership.role === "COORDINADOR" ? "default" : "secondary"
                }
              >
                {t(
                  membership.role === "COORDINADOR"
                    ? "tripRoleCoordinator"
                    : "tripRolePassenger",
                )}
              </Badge>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={pending}
                aria-label={t("removeFrom", { trip: membership.tripName })}
                onClick={() => onRemove(membership.tripId)}
              >
                <X aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {available.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={tripId} onValueChange={setTripId} disabled={pending}>
            <SelectTrigger className="w-56" aria-label={t("addToTrip")}>
              <SelectValue placeholder={t("addToTrip")} />
            </SelectTrigger>
            <SelectContent>
              {available.map((trip) => (
                <SelectItem key={trip.id} value={trip.id}>
                  {trip.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={role} onValueChange={setRole} disabled={pending}>
            <SelectTrigger className="w-40" aria-label={t("tripRole")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="PASAJERO">{t("tripRolePassenger")}</SelectItem>
              <SelectItem value="COORDINADOR">
                {t("tripRoleCoordinator")}
              </SelectItem>
            </SelectContent>
          </Select>

          <Button
            size="sm"
            disabled={pending || tripId === ""}
            onClick={() => {
              onAssign(tripId, role);
              setTripId("");
            }}
          >
            <Plus aria-hidden="true" />
            {t("assign")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, Check, Copy, Mail, Plus, Send } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
import { ConfirmDelete } from "@/components/budget/confirm-delete";
import { formatDate } from "@/lib/format";
import {
  inviteAction,
  resendInvitationAction,
  revokeInvitationAction,
  type InvitationCreated,
} from "./actions";
import type { InvitationRow } from "./types";

/**
 * Invitaciones.
 *
 * El botón de copiar el link tiene el mismo peso visual que el mail, no menos:
 * en la práctica el coordinador va a mandar la mayoría por WhatsApp, y tratar
 * esa vía como secundaria sería diseñar para el flujo que no ocurre.
 *
 * Por eso el link se muestra apenas se crea la invitación, sin pedir nada más,
 * y sigue disponible mientras esté pendiente.
 */
export function InvitationsPanel({
  tripId,
  invitations,
}: {
  tripId: string;
  invitations: InvitationRow[];
}) {
  const t = useTranslations("invitations");
  const tRooms = useTranslations("roomTypes");

  const [showForm, setShowForm] = useState(invitations.length === 0);
  const [email, setEmail] = useState("");
  const [roomType, setRoomType] = useState<"DOBLE" | "SINGLE">("DOBLE");
  const [created, setCreated] = useState<InvitationCreated | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await inviteAction(tripId, { email, roomType });
      if (result.ok) {
        setCreated(result.data);
        setEmail("");
        setShowForm(false);
      } else {
        setError(result.error);
      }
    });
  }

  function resend(invitationId: string) {
    setError(null);
    startTransition(async () => {
      const result = await resendInvitationAction(tripId, invitationId);
      if (result.ok) setCreated(result.data);
      else setError(result.error);
    });
  }

  return (
    <div className="space-y-5">
      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {created ? (
        <CreatedInvitation invitation={created} onClose={() => setCreated(null)} />
      ) : null}

      {showForm ? (
        <form
          className="border-border space-y-4 rounded-xl border p-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <Field label={t("email")} help={t("emailHelp")} required>
            {(props) => (
              <Input
                {...props}
                type="email"
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            )}
          </Field>

          <Field label={t("roomType")}>
            {(props) => (
              <Select
                value={roomType}
                onValueChange={(value) =>
                  setRoomType(value as "DOBLE" | "SINGLE")
                }
              >
                <SelectTrigger id={props.id} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DOBLE">{tRooms("DOBLE")}</SelectItem>
                  <SelectItem value="SINGLE">{tRooms("SINGLE")}</SelectItem>
                </SelectContent>
              </Select>
            )}
          </Field>

          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              <Send aria-hidden="true" />
              {pending ? t("sending") : t("send")}
            </Button>
            {invitations.length > 0 ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowForm(false)}
              >
                {t("revoke")}
              </Button>
            ) : null}
          </div>
        </form>
      ) : (
        <Button variant="outline" onClick={() => setShowForm(true)}>
          <Plus aria-hidden="true" />
          {t("inviteAction")}
        </Button>
      )}

      {invitations.length === 0 ? (
        <div className="border-border flex flex-col items-center gap-3 rounded-xl border border-dashed py-10 text-center">
          <Mail className="text-muted-foreground size-8" aria-hidden="true" />
          <p className="text-muted-foreground text-base">{t("empty")}</p>
        </div>
      ) : (
        <ul className="divide-border divide-y">
          {invitations.map((invitation) => (
            <li
              key={invitation.id}
              className="flex min-h-14 flex-wrap items-center justify-between gap-3 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-base">{invitation.email}</p>
                <p className="text-muted-foreground text-sm">
                  {tRooms(invitation.roomType)} ·{" "}
                  {t("expiresOn", { date: formatDate(invitation.expiresAt) })}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge
                  variant={
                    invitation.state === "USADA" ? "default" : "secondary"
                  }
                >
                  {t(`states.${invitation.state}`)}
                </Badge>
                {invitation.state !== "USADA" ? (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() => resend(invitation.id)}
                    >
                      {t("resend")}
                    </Button>
                    {invitation.state === "PENDIENTE" ? (
                      <ConfirmDelete
                        label={`${t("revoke")} ${invitation.email}`}
                        description={t("revokeConfirm", {
                          email: invitation.email,
                        })}
                        onConfirm={() =>
                          startTransition(async () => {
                            await revokeInvitationAction(
                              tripId,
                              invitation.id,
                            );
                          })
                        }
                      />
                    ) : null}
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * El link recién creado.
 *
 * Se muestra el link COMPLETO y visible, no escondido detrás del botón de
 * copiar: si el portapapeles falla —pasa en algunos navegadores móviles sin
 * HTTPS— el coordinador tiene que poder seleccionarlo a mano.
 */
function CreatedInvitation({
  invitation,
  onClose,
}: {
  invitation: InvitationCreated;
  onClose: () => void;
}) {
  const t = useTranslations("invitations");
  const tCommon = useTranslations("common");
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(invitation.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // Sin portapapeles el link igual está a la vista para seleccionarlo.
      setCopied(false);
    }
  }

  return (
    <div className="border-status-ok/40 bg-status-ok-surface space-y-3 rounded-xl border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-status-ok flex items-center gap-2 font-medium">
            <Check className="size-5" aria-hidden="true" />
            {t("created")}
          </p>
          <p className="text-foreground/80 text-base text-balance">
            {t("createdHelp")}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          {tCommon("close")}
        </Button>
      </div>

      <p className="bg-background rounded-lg border p-3 text-sm break-all">
        {invitation.url}
      </p>

      <Button size="lg" className="w-full" onClick={copy}>
        {copied ? (
          <>
            <Check aria-hidden="true" />
            {t("copied")}
          </>
        ) : (
          <>
            <Copy aria-hidden="true" />
            {t("copyLink")}
          </>
        )}
      </Button>

      {!invitation.emailSent ? (
        <p className="text-muted-foreground text-sm">
          {/* Si el mail no salió, el link sigue siendo válido: se avisa sin
              alarmar, porque la vía principal es el link de todos modos. */}
          {t("createdHelp")}
        </p>
      ) : null}
    </div>
  );
}

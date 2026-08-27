"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import {
  CalendarClock,
  Eye,
  Loader2,
  RefreshCw,
  Send,
  TestTube,
  Trash2,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/form/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  createCommunicationAction,
  deleteCommunicationAction,
  previewCommunicationAction,
  retryFailedAction,
  scheduleAction,
  sendNowAction,
  sendTestEmailAction,
  updateCommunicationAction,
} from "./actions";

/**
 * Editor de comunicaciones.
 *
 * ── Las dos pestañas ──────────────────────────────────────────────────────
 *
 * El español es obligatorio; el inglés, opcional. La pantalla dice en todo
 * momento si la versión en inglés cuenta o no, porque la regla —hace falta el
 * asunto Y el mensaje— es fácil de incumplir sin darse cuenta, y el resultado
 * de incumplirla (todos reciben español) es silencioso.
 *
 * ── Vista previa y prueba ────────────────────────────────────────────────
 *
 * Están antes del botón de enviar y no escondidas en un menú. Nadie aprieta
 * "enviar a catorce personas" sin haber visto qué sale, y si la pantalla no
 * ofrece cómo verlo, lo que pasa es que no se manda nunca.
 */

export interface EditorPassenger {
  id: string;
  fullName: string | null;
  cancelled: boolean;
}

export interface EditorRecipient {
  id: string;
  fullName: string | null;
  lang: "ES" | "EN";
  status: "PENDIENTE" | "ENVIADO" | "FALLIDO";
  error: string | null;
}

export interface EditorCommunication {
  id: string;
  subjectEs: string;
  bodyEs: string;
  subjectEn: string | null;
  bodyEn: string | null;
  audience: "TODOS" | "SELECCION";
  includeCancelled: boolean;
  status: string;
  passengerIds: string[];
  recipients: EditorRecipient[];
}

export function CommunicationEditor({
  tripId,
  communication,
  passengers,
}: {
  tripId: string;
  communication: EditorCommunication | null;
  passengers: EditorPassenger[];
}) {
  const t = useTranslations("communications");
  const tCommon = useTranslations("common");
  const router = useRouter();

  const [id, setId] = useState(communication?.id ?? null);
  const [subjectEs, setSubjectEs] = useState(communication?.subjectEs ?? "");
  const [bodyEs, setBodyEs] = useState(communication?.bodyEs ?? "");
  const [subjectEn, setSubjectEn] = useState(communication?.subjectEn ?? "");
  const [bodyEn, setBodyEn] = useState(communication?.bodyEn ?? "");
  const [audience, setAudience] = useState<"TODOS" | "SELECCION">(
    communication?.audience ?? "TODOS",
  );
  const [includeCancelled, setIncludeCancelled] = useState(
    communication?.includeCancelled ?? false,
  );
  const [selected, setSelected] = useState<string[]>(
    communication?.passengerIds ?? [],
  );
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("09:00");

  const [preview, setPreview] = useState<
    { lang: string; subject: string; html: string }[] | null
  >(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmSend, setConfirmSend] = useState(false);
  const [busy, startTransition] = useTransition();

  const sent = communication?.status === "ENVIADA";
  const readOnly = sent || communication?.status === "ENVIANDO";

  // La regla, evaluada en vivo: media traducción no cuenta como traducción.
  const englishComplete =
    subjectEn.trim().length > 0 && bodyEn.trim().length > 0;

  const eligible = passengers.filter((p) => includeCancelled || !p.cancelled);
  const recipientCount =
    audience === "SELECCION"
      ? selected.filter((pid) => eligible.some((p) => p.id === pid)).length
      : eligible.length;

  function draft() {
    return {
      subjectEs: subjectEs.trim(),
      bodyEs: bodyEs.trim(),
      subjectEn: subjectEn.trim() === "" ? null : subjectEn.trim(),
      bodyEn: bodyEn.trim() === "" ? null : bodyEn.trim(),
      audience,
      passengerIds: selected,
      includeCancelled,
    };
  }

  /** Guarda y devuelve el id, creando la comunicación si todavía no existe. */
  async function persist(): Promise<string | null> {
    setError(null);

    if (id === null) {
      const created = await createCommunicationAction(tripId, draft());
      if (!created.ok) {
        setError(created.error);
        return null;
      }
      setId(created.data.id);
      // Se actualiza la URL para que recargar no pierda el borrador.
      router.replace(`/viajes/${tripId}/comunicaciones/${created.data.id}`);
      return created.data.id;
    }

    const updated = await updateCommunicationAction(tripId, id, draft());
    if (!updated.ok) {
      setError(updated.error);
      return null;
    }
    return id;
  }

  function save() {
    startTransition(async () => {
      const saved = await persist();
      if (saved) setNotice(t("saved"));
    });
  }

  function showPreview() {
    startTransition(async () => {
      const saved = await persist();
      if (!saved) return;

      const result = await previewCommunicationAction(saved);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setPreview(result.data);
    });
  }

  function sendTest(lang: "ES" | "EN") {
    startTransition(async () => {
      const saved = await persist();
      if (!saved) return;

      const result = await sendTestEmailAction(saved, lang);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNotice(t("sendTestSent", { email: result.data.to }));
    });
  }

  function sendNow() {
    startTransition(async () => {
      const saved = await persist();
      if (!saved) return;

      const result = await sendNowAction(tripId, saved);
      setConfirmSend(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNotice(
        t("sendReport", {
          sent: result.data.sent,
          failed: result.data.failed,
          pending: result.data.pending,
        }),
      );
      router.refresh();
    });
  }

  function schedule() {
    startTransition(async () => {
      const saved = await persist();
      if (!saved) return;

      const result = await scheduleAction(tripId, saved, {
        date: scheduleDate,
        time: scheduleTime,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function retry() {
    if (!id) return;
    startTransition(async () => {
      const result = await retryFailedAction(tripId, id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNotice(
        t("sendReport", {
          sent: result.data.sent,
          failed: result.data.failed,
          pending: result.data.pending,
        }),
      );
      router.refresh();
    });
  }

  function remove() {
    if (!id) return;
    startTransition(async () => {
      const result = await deleteCommunicationAction(tripId, id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/viajes/${tripId}/comunicaciones`);
    });
  }

  return (
    <div className="space-y-5">
      {/* ── Contenido ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="gap-1">
          <CardTitle className="text-lg">
            {communication ? t("editorEdit") : t("editorNew")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="es">
            <TabsList>
              <TabsTrigger value="es">{t("tabEs")}</TabsTrigger>
              <TabsTrigger value="en">
                {t("tabEn")}
                {englishComplete ? (
                  <Badge variant="secondary" className="ml-2">
                    ✓
                  </Badge>
                ) : null}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="es" className="space-y-4 pt-4">
              <Field label={t("subject")} required>
                {(props) => (
                  <Input
                    {...props}
                    value={subjectEs}
                    disabled={readOnly}
                    placeholder={t("subjectPlaceholder")}
                    onChange={(event) => setSubjectEs(event.target.value)}
                  />
                )}
              </Field>
              <Field label={t("body")} required>
                {(props) => (
                  <Textarea
                    {...props}
                    rows={10}
                    value={bodyEs}
                    disabled={readOnly}
                    placeholder={t("bodyPlaceholder")}
                    onChange={(event) => setBodyEs(event.target.value)}
                  />
                )}
              </Field>
            </TabsContent>

            <TabsContent value="en" className="space-y-4 pt-4">
              <p className="text-muted-foreground text-sm">
                {t("englishHelp")}
              </p>
              <Field label={t("subject")}>
                {(props) => (
                  <Input
                    {...props}
                    value={subjectEn}
                    disabled={readOnly}
                    onChange={(event) => setSubjectEn(event.target.value)}
                  />
                )}
              </Field>
              <Field label={t("body")}>
                {(props) => (
                  <Textarea
                    {...props}
                    rows={10}
                    value={bodyEn}
                    disabled={readOnly}
                    onChange={(event) => setBodyEn(event.target.value)}
                  />
                )}
              </Field>
              <Alert>
                <AlertDescription className="text-base">
                  {englishComplete
                    ? t("englishComplete")
                    : t("englishIncomplete")}
                </AlertDescription>
              </Alert>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* ── Audiencia ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="gap-1">
          <CardTitle className="text-lg">{t("audience")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label={t("audience")}>
            {(props) => (
              <Select
                value={audience}
                disabled={readOnly}
                onValueChange={(value) =>
                  setAudience(value as "TODOS" | "SELECCION")
                }
              >
                <SelectTrigger id={props.id} className="w-full sm:w-72">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TODOS">{t("audiences.TODOS")}</SelectItem>
                  <SelectItem value="SELECCION">
                    {t("audiences.SELECCION")}
                  </SelectItem>
                </SelectContent>
              </Select>
            )}
          </Field>

          <div className="flex items-start gap-3">
            <Checkbox
              id="incluir-cancelados"
              checked={includeCancelled}
              disabled={readOnly}
              onCheckedChange={(value) => setIncludeCancelled(value === true)}
            />
            <div className="space-y-0.5">
              <Label htmlFor="incluir-cancelados" className="text-base">
                {t("includeCancelled")}
              </Label>
              <p className="text-muted-foreground text-sm">
                {t("includeCancelledHelp")}
              </p>
            </div>
          </div>

          {audience === "SELECCION" ? (
            <div className="space-y-2">
              <p className="text-base font-medium">{t("selectPassengers")}</p>
              <ul className="space-y-2">
                {eligible.map((passenger) => (
                  <li key={passenger.id} className="flex items-center gap-3">
                    <Checkbox
                      id={`dest-${passenger.id}`}
                      checked={selected.includes(passenger.id)}
                      disabled={readOnly}
                      onCheckedChange={(value) =>
                        setSelected((current) =>
                          value === true
                            ? [...current, passenger.id]
                            : current.filter((pid) => pid !== passenger.id),
                        )
                      }
                    />
                    <Label
                      htmlFor={`dest-${passenger.id}`}
                      className="text-base font-normal"
                    >
                      {passenger.fullName ?? "—"}
                      {passenger.cancelled ? " ·" : ""}
                    </Label>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="text-muted-foreground text-sm">
            {t("selectedCount", { count: recipientCount })}
          </p>
        </CardContent>
      </Card>

      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {notice ? (
        <Alert role="status">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      {/* ── Antes de enviar ───────────────────────────────────────────── */}
      {!readOnly ? (
        <Card>
          <CardContent className="space-y-4 py-5">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={busy} onClick={save}>
                {busy ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : null}
                {t("save")}
              </Button>
              <Button variant="outline" disabled={busy} onClick={showPreview}>
                <Eye aria-hidden="true" />
                {t("preview")}
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => sendTest("ES")}
              >
                <TestTube aria-hidden="true" />
                {t("sendTest")}
              </Button>
            </div>

            <div className="border-border flex flex-wrap items-end gap-3 border-t pt-4">
              <Field label={t("scheduleDate")} className="w-44">
                {(props) => (
                  <Input
                    {...props}
                    type="date"
                    value={scheduleDate}
                    onChange={(event) => setScheduleDate(event.target.value)}
                  />
                )}
              </Field>
              <Field label={t("scheduleTime")} className="w-32">
                {(props) => (
                  <Input
                    {...props}
                    type="time"
                    value={scheduleTime}
                    onChange={(event) => setScheduleTime(event.target.value)}
                  />
                )}
              </Field>
              <Button
                variant="outline"
                disabled={busy || scheduleDate === ""}
                onClick={schedule}
              >
                <CalendarClock aria-hidden="true" />
                {t("scheduleAction")}
              </Button>
            </div>

            <div className="border-border flex flex-wrap gap-2 border-t pt-4">
              <Button
                size="lg"
                disabled={busy || recipientCount === 0}
                onClick={() => setConfirmSend(true)}
              >
                {busy ? (
                  <>
                    <Loader2 className="animate-spin" aria-hidden="true" />
                    {t("sending")}
                  </>
                ) : (
                  <>
                    <Send aria-hidden="true" />
                    {t("sendNow")}
                  </>
                )}
              </Button>

              {id ? (
                <Button variant="ghost" disabled={busy} onClick={remove}>
                  <Trash2 className="text-status-danger" aria-hidden="true" />
                  {t("delete")}
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* ── Vista previa ──────────────────────────────────────────────── */}
      {preview ? (
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2">
            <CardTitle className="text-lg">{t("previewTitle")}</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setPreview(null)}>
              {t("previewClose")}
            </Button>
          </CardHeader>
          <CardContent className="space-y-6">
            {preview.map((version) => (
              <div key={version.lang} className="space-y-2">
                <p className="text-muted-foreground text-sm">
                  {t("previewLang", {
                    lang: version.lang === "en" ? t("tabEn") : t("tabEs"),
                  })}
                </p>
                <p className="text-base font-medium">{version.subject}</p>
                {/* El mail se muestra en un iframe con `sandbox` vacío: sin
                    scripts, sin formularios, sin navegación. El cuerpo ya está
                    escapado, pero una vista previa que ejecuta lo que le pasan
                    es exactamente el lugar donde no conviene confiar. */}
                <iframe
                  title={`${t("previewTitle")} ${version.lang}`}
                  srcDoc={version.html}
                  sandbox=""
                  className="border-border h-[420px] w-full rounded-lg border bg-white"
                />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {/* ── Destinatarios ─────────────────────────────────────────────── */}
      {communication && communication.recipients.length > 0 ? (
        <Card>
          <CardHeader className="gap-1">
            <CardTitle className="text-lg">{t("recipientsTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="divide-border divide-y">
              {communication.recipients.map((recipient) => (
                <li
                  key={recipient.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                >
                  <span className="text-base">
                    {recipient.fullName ?? "—"}
                    <span className="text-muted-foreground ml-2 text-sm">
                      {recipient.lang}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    {/* El error del proveedor, tal cual. Un "falló" a secas no
                        le dice al coordinador qué arreglar. */}
                    {recipient.error ? (
                      <span className="text-status-danger text-sm">
                        {recipient.error}
                      </span>
                    ) : null}
                    <Badge
                      variant={
                        recipient.status === "ENVIADO" ? "secondary" : "outline"
                      }
                    >
                      {t(`recipientStatuses.${recipient.status}`)}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>

            {communication.recipients.some((r) => r.status === "FALLIDO") ? (
              <Button variant="outline" disabled={busy} onClick={retry}>
                <RefreshCw aria-hidden="true" />
                {t("retryFailed")}
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <AlertDialog open={confirmSend} onOpenChange={setConfirmSend}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("sendNowConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription className="text-base">
              {t("sendNowConfirmBody", { count: recipientCount })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={sendNow}>
              {t("sendNowConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

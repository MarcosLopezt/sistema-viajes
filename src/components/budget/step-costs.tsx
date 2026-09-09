"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Plus, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatMoney, type CurrencyCode, type LocaleCode } from "@/lib/format";
import { isBlankCost } from "@/lib/domain/itinerary";
import { Field } from "@/components/form/field";
import { ConfirmDelete } from "./confirm-delete";
import type { StepFlushRef } from "./types";

/**
 * Pasos 3 y 4 — comidas y eventos, y costos del grupo.
 *
 * Los dos pasos son estructuralmente idénticos (concepto + importe + tipo) y
 * comparten componente. Lo que cambia es el sentido del importe, y eso se
 * explica en el texto introductorio de cada uno: en el paso 3 es POR PASAJERO
 * y en el paso 4 es el TOTAL del grupo. Confundirlos es el error más caro que
 * se puede cometer en esta pantalla, así que la etiqueta del campo lo dice
 * explícitamente en cada caso.
 */

export interface CostRow {
  id: string;
  concept: string;
  amount: string;
  type: string;
}

export function StepCosts({
  namespace,
  rows,
  types,
  currency,
  disabled,
  onSave,
  onDelete,
  flushRef,
}: {
  /** "budget.directCosts" o "budget.indirectCosts". */
  namespace: "directCosts" | "indirectCosts";
  rows: CostRow[];
  types: readonly string[];
  currency: CurrencyCode;
  disabled?: boolean;
  onSave: (row: CostRow) => Promise<{ ok: boolean; error?: string }>;
  onDelete: (id: string) => void;
  /**
   * Del wizard: guardar la fila que esté a medio cargar ANTES de cambiar de
   * paso. Vacía no hace nada, incompleta frena la salida y muestra qué
   * falta, completa se agrega solo y recién ahí se avanza.
   */
  flushRef?: StepFlushRef;
}) {
  const t = useTranslations(`budget.${namespace}`);
  const tActions = useTranslations("budget.actions");
  const locale = useLocale() as LocaleCode;

  const [editing, setEditing] = useState<CostRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const amountLabel =
    namespace === "directCosts" ? t("amountPerPassenger") : t("totalAmount");

  const blank = (): CostRow => ({
    id: "",
    concept: "",
    amount: "",
    type: types[0]!,
  });

  // `CostForm` guarda su propio borrador (lo que se está tipeando, no lo que
  // había al abrir "Editar"), así que es EL QUIEN se registra en esta ref
  // interna — acá arriba solo se reenvía al wizard.
  const costFlushRef: StepFlushRef = useRef<(() => Promise<boolean>) | null>(
    null,
  );

  useEffect(() => {
    if (!flushRef) return;
    flushRef.current = async () =>
      costFlushRef.current ? costFlushRef.current() : true;
  });
  useEffect(() => {
    return () => {
      if (flushRef) flushRef.current = null;
    };
  }, [flushRef]);

  async function submit(row: CostRow): Promise<boolean> {
    const result = await onSave(row);
    if (result.ok) {
      setEditing(null);
      setError(null);
      return true;
    }
    setError(result.error ?? tActions("saveError"));
    return false;
  }

  return (
    <div className="space-y-5">
      <p className="text-muted-foreground text-base text-balance">
        {t("intro")}
      </p>

      {rows.length === 0 && editing === null ? (
        <div className="border-border flex flex-col items-center gap-3 rounded-xl border border-dashed py-10 text-center">
          <Receipt
            className="text-muted-foreground size-8"
            aria-hidden="true"
          />
          <p className="text-muted-foreground text-base">{t("empty")}</p>
        </div>
      ) : (
        <ul className="divide-border divide-y">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex min-h-14 items-center justify-between gap-3 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-base font-medium">{row.concept}</p>
                <p className="text-muted-foreground text-sm">
                  {t(`types.${row.type}`)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <span className="text-base font-medium tabular-nums">
                  {formatMoney(row.amount, currency, locale)}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  onClick={() => setEditing(row)}
                >
                  {tActions("edit")}
                </Button>
                {!disabled ? (
                  <ConfirmDelete
                    label={`${tActions("delete")} ${row.concept}`}
                    description={tActions("deleteCostConfirm", {
                      name: row.concept,
                    })}
                    onConfirm={() => onDelete(row.id)}
                  />
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing !== null ? (
        <CostForm
          row={editing}
          types={types}
          namespace={namespace}
          amountLabel={amountLabel}
          error={error}
          flushRef={costFlushRef}
          onCancel={() => {
            setEditing(null);
            setError(null);
          }}
          onSubmit={submit}
        />
      ) : (
        <Button
          variant="outline"
          disabled={disabled}
          onClick={() => setEditing(blank())}
        >
          <Plus aria-hidden="true" />
          {t("add")}
        </Button>
      )}
    </div>
  );
}

function CostForm({
  row,
  types,
  namespace,
  amountLabel,
  error,
  flushRef,
  onCancel,
  onSubmit,
}: {
  row: CostRow;
  types: readonly string[];
  namespace: "directCosts" | "indirectCosts";
  amountLabel: string;
  error: string | null;
  flushRef?: StepFlushRef;
  onCancel: () => void;
  onSubmit: (row: CostRow) => Promise<boolean>;
}) {
  const t = useTranslations(`budget.${namespace}`);
  const tActions = useTranslations("budget.actions");
  const tCommon = useTranslations("common");
  const [draft, setDraft] = useState(row);

  /** Única puerta de guardado: la usan el botón "Agregar" y `flushRef`. */
  async function persist(): Promise<boolean> {
    if (isBlankCost(draft)) {
      onCancel();
      return true;
    }
    return onSubmit(draft);
  }

  useEffect(() => {
    if (flushRef) flushRef.current = persist;
  });
  useEffect(() => {
    return () => {
      if (flushRef) flushRef.current = null;
    };
  }, [flushRef]);

  return (
    <form
      className="border-border space-y-4 rounded-xl border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void persist();
      }}
    >
      <Field label={t("concept")} required>
        {(props) => (
          <Input
            {...props}
            value={draft.concept}
            onChange={(e) => setDraft({ ...draft, concept: e.target.value })}
            required
          />
        )}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={amountLabel} error={error ?? undefined} required>
          {(props) => (
            <Input
              {...props}
              // Teclado numérico con decimales en el celular.
              inputMode="decimal"
              value={draft.amount}
              placeholder="0.00"
              onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
              required
            />
          )}
        </Field>

        <Field label={t("type")}>
          {(props) => (
            <Select
              value={draft.type}
              onValueChange={(value) => setDraft({ ...draft, type: value })}
            >
              <SelectTrigger id={props.id} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {types.map((type) => (
                  <SelectItem key={type} value={type}>
                    {t(`types.${type}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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

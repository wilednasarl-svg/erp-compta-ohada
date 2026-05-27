"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Brain,
  Columns3,
  Lightbulb,
  Loader2,
  MessageCircle,
  Play,
  Search,
} from "lucide-react";
import { useMemo, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { ApiError, api } from "@/lib/api-client";
import { useCurrentOrg } from "@/stores/auth-store";
import type { AccountingPeriodView } from "@/types/journals";

type AnomalyType =
  | "extreme_amount"
  | "sensitive_account"
  | "potential_duplicate"
  | "suspicious_date"
  | "rare_account_journal";

const ANOMALY_TYPE_LABELS: Readonly<Record<AnomalyType, string>> = {
  extreme_amount: "Montant extrême",
  sensitive_account: "Compte sensible",
  potential_duplicate: "Doublon potentiel",
  suspicious_date: "Date suspecte",
  rare_account_journal: "Combinaison rare",
};

interface AiAnomaly {
  readonly id: string;
  readonly periodId: string | null;
  readonly entryId: string | null;
  readonly accountId: string | null;
  readonly anomalyType: AnomalyType;
  readonly riskScore: number;
  readonly reasons: ReadonlyArray<string>;
  readonly detectedBy: string;
  readonly detectedAt: string;
  readonly createdAt: string;
}

interface AnomaliesResponse {
  readonly anomalies: ReadonlyArray<AiAnomaly>;
  readonly meta: {
    readonly total: number;
    readonly page: number;
    readonly pageSize: number;
  };
}

interface ScanStats {
  readonly periodId: string;
  readonly entriesScanned: number;
  readonly linesScanned: number;
  readonly anomaliesDetected: number;
  readonly durationMs: number;
}

interface PeriodsResponse {
  readonly periods: ReadonlyArray<AccountingPeriodView>;
}

interface SuggestionResult {
  readonly suggestion: {
    readonly suggestedAccountCode: string;
    readonly confidence: number;
    readonly reasons: ReadonlyArray<string>;
    readonly alternative?: {
      readonly accountCode: string;
      readonly confidence: number;
      readonly reasons: ReadonlyArray<string>;
    };
  } | null;
}

const SELECT_CLASS =
  "rounded-sm border border-line-strong bg-paper px-3 py-1 text-sm text-ink transition-colors focus:border-accent focus:outline-none";

const PANEL_CLASS = "rounded-sm border border-line bg-paper p-5";

export default function AiPage() {
  const currentOrg = useCurrentOrg();
  const orgId = currentOrg?.id ?? "";
  const queryClient = useQueryClient();

  const [selectedPeriodId, setSelectedPeriodId] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<AnomalyType | "">("");
  const [minScore, setMinScore] = useState<number>(0);

  const periodsQuery = useQuery<ReadonlyArray<AccountingPeriodView>, ApiError>({
    queryKey: ["accounting-periods", orgId],
    queryFn: async () => {
      const data = await api.get<PeriodsResponse>(
        `/organizations/${orgId}/accounting-periods`,
      );
      return data.periods;
    },
    enabled: orgId !== "",
  });

  const anomaliesQuery = useQuery<AnomaliesResponse, ApiError>({
    queryKey: ["ai-anomalies", orgId, selectedPeriodId, typeFilter, minScore],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedPeriodId) params.set("periodId", selectedPeriodId);
      if (typeFilter) params.set("anomalyType", typeFilter);
      if (minScore > 0) params.set("minScore", String(minScore));
      params.set("pageSize", "100");
      return api.get<AnomaliesResponse>(
        `/organizations/${orgId}/ai/anomalies?${params}`,
      );
    },
    enabled: orgId !== "",
  });

  const scanMutation = useApiMutation<
    { stats: ScanStats },
    { periodId: string }
  >(
    ({ periodId }) =>
      api.post<{ stats: ScanStats }>(
        `/organizations/${orgId}/ai/anomalies/scan`,
        { periodId },
      ),
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["ai-anomalies", orgId] });
      },
    },
  );

  const annualPeriods = useMemo(() => {
    const periods = periodsQuery.data ?? [];
    return periods
      .filter((p) => p.parentId === null)
      .sort((a, b) => b.startDate.localeCompare(a.startDate));
  }, [periodsQuery.data]);

  return (
    <AppShell>
      <div className="animate-page-in space-y-8 p-6">
        <header className="flex items-center gap-3">
          <Brain className="h-7 w-7 text-ink" />
          <div>
            <p className="eyebrow mb-2">Module 11 · Intelligence</p>
            <h1 className="font-display text-4xl font-medium tracking-tight text-ink">
              IA — Anomalies &amp; suggestions
            </h1>
            <p className="mt-1 text-sm text-ink-mute">
              Wave 1 — heuristiques déterministes (sans LLM).
            </p>
          </div>
        </header>

        <ScanSection
          periods={annualPeriods}
          selectedPeriodId={selectedPeriodId}
          onPeriodChange={setSelectedPeriodId}
          onScan={() => {
            if (selectedPeriodId)
              scanMutation.mutate({ periodId: selectedPeriodId });
          }}
          loading={scanMutation.isPending}
          stats={scanMutation.data?.stats ?? null}
          error={scanMutation.error}
        />

        <AnomaliesSection
          anomalies={anomaliesQuery.data?.anomalies ?? []}
          total={anomaliesQuery.data?.meta.total ?? 0}
          loading={anomaliesQuery.isLoading}
          error={anomaliesQuery.error}
          typeFilter={typeFilter}
          onTypeFilterChange={setTypeFilter}
          minScore={minScore}
          onMinScoreChange={setMinScore}
        />

        <SuggestionSection orgId={orgId} />

        <MappingSection orgId={orgId} />

        <AssistantSection orgId={orgId} periodId={selectedPeriodId} />
      </div>
    </AppShell>
  );
}

// ─── Scan section ─────────────────────────────────────────────────────

interface ScanSectionProps {
  readonly periods: ReadonlyArray<AccountingPeriodView>;
  readonly selectedPeriodId: string;
  readonly onPeriodChange: (id: string) => void;
  readonly onScan: () => void;
  readonly loading: boolean;
  readonly stats: ScanStats | null;
  readonly error: ApiError | null;
}

function ScanSection({
  periods,
  selectedPeriodId,
  onPeriodChange,
  onScan,
  loading,
  stats,
  error,
}: ScanSectionProps) {
  return (
    <section className={PANEL_CLASS}>
      <div className="border-b border-line pb-3">
        <h2 className="font-display text-xl font-medium text-ink">
          <Play className="mr-2 inline h-4 w-4" />
          Scanner une période
        </h2>
        <p className="mt-1 text-sm text-ink-mute">
          Recalcul complet des anomalies sur la période choisie. Les anciennes
          anomalies de la période sont effacées avant ré-insertion.
        </p>
      </div>
      <div className="space-y-4 pt-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-end">
          <div className="flex-1">
            <Label htmlFor="period-select">Période fiscale</Label>
            <select
              id="period-select"
              className={`${SELECT_CLASS} mt-1 w-full`}
              value={selectedPeriodId}
              onChange={(e) => onPeriodChange(e.target.value)}
            >
              <option value="">— Toutes les anomalies déjà détectées —</option>
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} ({p.startDate} → {p.endDate}){" "}
                  {p.status === "closed" ? "— clôturée" : ""}
                </option>
              ))}
            </select>
          </div>
          <Button
            onClick={onScan}
            disabled={loading || selectedPeriodId === ""}
            className="press md:w-44"
          >
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Play className="mr-2 h-4 w-4" />
            )}
            Lancer le scan
          </Button>
        </div>
        {error && (
          <FormError error={{ code: error.code, message: error.message }} />
        )}
        {stats && (
          <div className="rounded-sm border border-accent/30 bg-accent-soft p-3 text-sm text-accent-ink">
            <div className="font-medium">
              Scan terminé en {stats.durationMs} ms.
            </div>
            <div className="mt-1 text-ink-mute">
              {stats.entriesScanned} écriture
              {stats.entriesScanned > 1 ? "s" : ""} · {stats.linesScanned} ligne
              {stats.linesScanned > 1 ? "s" : ""} · {stats.anomaliesDetected}{" "}
              anomalie{stats.anomaliesDetected > 1 ? "s" : ""} détectée
              {stats.anomaliesDetected > 1 ? "s" : ""}.
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// ─── Anomalies section ────────────────────────────────────────────────

interface AnomaliesSectionProps {
  readonly anomalies: ReadonlyArray<AiAnomaly>;
  readonly total: number;
  readonly loading: boolean;
  readonly error: ApiError | null;
  readonly typeFilter: AnomalyType | "";
  readonly onTypeFilterChange: (t: AnomalyType | "") => void;
  readonly minScore: number;
  readonly onMinScoreChange: (s: number) => void;
}

function AnomaliesSection({
  anomalies,
  total,
  loading,
  error,
  typeFilter,
  onTypeFilterChange,
  minScore,
  onMinScoreChange,
}: AnomaliesSectionProps) {
  return (
    <section className={PANEL_CLASS}>
      <div className="border-b border-line pb-3">
        <h2 className="font-display text-xl font-medium text-ink">
          <AlertTriangle className="mr-2 inline h-4 w-4 text-warn-ink" />
          Anomalies détectées ({total})
        </h2>
        <p className="mt-1 text-sm text-ink-mute">
          Triées par risque décroissant. Chaque ligne expose ses raisons en
          clair.
        </p>
      </div>
      <div className="space-y-4 pt-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="type-filter">Type</Label>
            <select
              id="type-filter"
              className={`${SELECT_CLASS} mt-1`}
              value={typeFilter}
              onChange={(e) =>
                onTypeFilterChange((e.target.value as AnomalyType) || "")
              }
            >
              <option value="">Tous</option>
              {(Object.keys(ANOMALY_TYPE_LABELS) as AnomalyType[]).map((t) => (
                <option key={t} value={t}>
                  {ANOMALY_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="min-score">Score minimum</Label>
            <Input
              id="min-score"
              type="number"
              min={0}
              max={100}
              value={minScore}
              onChange={(e) => onMinScoreChange(Number(e.target.value) || 0)}
              className="mt-1 w-24"
            />
          </div>
        </div>

        {error && (
          <FormError error={{ code: error.code, message: error.message }} />
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-ink-mute">
            <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
          </div>
        ) : anomalies.length === 0 ? (
          <div className="rounded-sm border border-dashed border-line p-6 text-center text-sm text-ink-mute">
            Aucune anomalie détectée pour les filtres actuels.
          </div>
        ) : (
          <div className="space-y-2">
            {anomalies.map((a) => (
              <AnomalyRow key={a.id} anomaly={a} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function AnomalyRow({ anomaly }: { anomaly: AiAnomaly }) {
  const badgeClass =
    anomaly.riskScore >= 70
      ? "bg-critical-soft text-critical-ink"
      : anomaly.riskScore >= 40
        ? "bg-warn-soft text-warn-ink"
        : "bg-sunk text-ink-soft";
  return (
    <div className="rounded-sm border border-line bg-paper p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide ${badgeClass}`}
          >
            Score {anomaly.riskScore}
          </span>
          <span className="text-sm font-medium text-ink">
            {ANOMALY_TYPE_LABELS[anomaly.anomalyType]}
          </span>
        </div>
        <span className="text-xs text-ink-mute">
          {new Date(anomaly.detectedAt).toLocaleString("fr-FR")}
        </span>
      </div>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-mute">
        {anomaly.reasons.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ul>
    </div>
  );
}

// ─── Suggestion sandbox ───────────────────────────────────────────────

function SuggestionSection({ orgId }: { orgId: string }) {
  const [description, setDescription] = useState("");
  const [partner, setPartner] = useState("");
  const [side, setSide] = useState<"" | "debit" | "credit">("");

  const suggestionMutation = useApiMutation<SuggestionResult, void>(() =>
    api.post<SuggestionResult>(`/organizations/${orgId}/ai/suggestions/entry`, {
      description,
      partner: partner || undefined,
      side: side || undefined,
    }),
  );

  return (
    <section className={PANEL_CLASS}>
      <div className="border-b border-line pb-3">
        <h2 className="font-display text-xl font-medium text-ink">
          <Lightbulb className="mr-2 inline h-4 w-4 text-warn-ink" />
          Suggestion de compte
        </h2>
        <p className="mt-1 text-sm text-ink-mute">
          Bac à sable : saisir un libellé d&apos;écriture pour voir le compte
          heuristique proposé.
        </p>
      </div>
      <div className="space-y-4 pt-4">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="md:col-span-2">
            <Label htmlFor="suggest-desc">Libellé</Label>
            <Input
              id="suggest-desc"
              placeholder="Ex: Loyer bureau juin 2026"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="suggest-partner">Tiers (optionnel)</Label>
            <Input
              id="suggest-partner"
              placeholder="SODECI"
              value={partner}
              onChange={(e) => setPartner(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="suggest-side">Sens</Label>
            <select
              id="suggest-side"
              className={`${SELECT_CLASS} mt-1 w-full`}
              value={side}
              onChange={(e) =>
                setSide(e.target.value as "" | "debit" | "credit")
              }
            >
              <option value="">—</option>
              <option value="debit">Débit</option>
              <option value="credit">Crédit</option>
            </select>
          </div>
        </div>
        <Button
          onClick={() => suggestionMutation.mutate()}
          disabled={
            suggestionMutation.isPending || description.trim().length === 0
          }
          className="press"
        >
          {suggestionMutation.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Search className="mr-2 h-4 w-4" />
          )}
          Suggérer
        </Button>

        {suggestionMutation.error && (
          <FormError
            error={{
              code: suggestionMutation.error.code,
              message: suggestionMutation.error.message,
            }}
          />
        )}

        {suggestionMutation.data &&
          (suggestionMutation.data.suggestion ? (
            <div className="space-y-2 rounded-sm border border-line bg-paper p-3">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent-ink">
                  Compte{" "}
                  {suggestionMutation.data.suggestion.suggestedAccountCode}
                </span>
                <span className="text-sm font-medium text-ink">
                  Confiance : {suggestionMutation.data.suggestion.confidence} /
                  100
                </span>
              </div>
              <ul className="list-disc space-y-1 pl-5 text-sm text-ink-mute">
                {suggestionMutation.data.suggestion.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
              {suggestionMutation.data.suggestion.alternative && (
                <div className="border-t border-line pt-2 text-sm text-ink-mute">
                  <span className="font-medium text-ink">Alternative :</span>{" "}
                  Compte{" "}
                  {suggestionMutation.data.suggestion.alternative.accountCode}{" "}
                  (confiance{" "}
                  {suggestionMutation.data.suggestion.alternative.confidence}) —{" "}
                  {suggestionMutation.data.suggestion.alternative.reasons.join(
                    " ",
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-sm border border-dashed border-line p-3 text-sm text-ink-mute">
              Aucune suggestion : le libellé ne matche aucun pattern ni
              historique suffisant.
            </div>
          ))}
      </div>
    </section>
  );
}

// ─── Assistant chat (wave 2) ──────────────────────────────────────────

interface AssistantResponse {
  readonly answer: {
    readonly answer: string;
    readonly confidence: number;
    readonly matchedIntent: string | null;
    readonly supportingData?: Record<string, unknown>;
  };
}

const SAMPLE_QUESTIONS: ReadonlyArray<string> = [
  "Quelles anomalies détectées ?",
  "Quelle est l’écriture la plus risquée ?",
  "Solde du compte 411",
  "Combien j’ai dépensé en 6132 ?",
  "Pourquoi le compte 6132 augmente ?",
];

function AssistantSection({
  orgId,
  periodId,
}: {
  orgId: string;
  periodId: string;
}) {
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<
    ReadonlyArray<{ q: string; a: AssistantResponse["answer"] }>
  >([]);

  const askMutation = useApiMutation<AssistantResponse, { question: string }>(
    ({ question: q }) =>
      api.post<AssistantResponse>(`/organizations/${orgId}/ai/assistant/ask`, {
        question: q,
        periodId: periodId || undefined,
      }),
    {
      onSuccess: (data, vars) => {
        setHistory((prev) => [...prev, { q: vars.question, a: data.answer }]);
        setQuestion("");
      },
    },
  );

  return (
    <section className={PANEL_CLASS}>
      <div className="border-b border-line pb-3">
        <h2 className="font-display text-xl font-medium text-ink">
          <MessageCircle className="mr-2 inline h-4 w-4 text-ink" />
          Assistant comptable
        </h2>
        <p className="mt-1 text-sm text-ink-mute">
          Provider rule-based v1 — 5 patterns reconnus. Un LLM est prévu en wave
          3.
        </p>
      </div>
      <div className="space-y-4 pt-4">
        <div className="flex flex-wrap gap-2">
          {SAMPLE_QUESTIONS.map((sample) => (
            <Button
              key={sample}
              variant="outline"
              size="sm"
              onClick={() => setQuestion(sample)}
              disabled={askMutation.isPending}
              className="press"
            >
              {sample}
            </Button>
          ))}
        </div>

        <div className="flex gap-2">
          <Input
            placeholder="Posez votre question…"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && question.trim().length > 0) {
                askMutation.mutate({ question });
              }
            }}
            className="flex-1"
          />
          <Button
            onClick={() => askMutation.mutate({ question })}
            disabled={askMutation.isPending || question.trim().length === 0}
            className="press"
          >
            {askMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <MessageCircle className="mr-2 h-4 w-4" />
            )}
            Demander
          </Button>
        </div>

        {askMutation.error && (
          <FormError
            error={{
              code: askMutation.error.code,
              message: askMutation.error.message,
            }}
          />
        )}

        {history.length > 0 && (
          <div className="space-y-3">
            {history.map((entry, i) => (
              <div
                key={i}
                className="space-y-2 rounded-sm border border-line bg-paper p-3"
              >
                <div className="text-sm font-medium text-ink">
                  Q : {entry.q}
                </div>
                <div className="text-sm text-ink-mute">{entry.a.answer}</div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-ink-mute">
                  <span className="inline-flex items-center rounded-full bg-sunk px-2.5 py-0.5 text-xs font-medium text-ink-soft">
                    Intent : {entry.a.matchedIntent ?? "non reconnu"}
                  </span>
                  <span className="inline-flex items-center rounded-full bg-sunk px-2.5 py-0.5 text-xs font-medium text-ink-soft">
                    Confiance {entry.a.confidence}/100
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// ─── AI Mapping sandbox (wave 2.5) ────────────────────────────────────

type TargetField =
  | "account_code"
  | "description"
  | "debit"
  | "credit"
  | "entry_date"
  | "journal_code"
  | "partner"
  | "reference";

const TARGET_FIELD_LABELS: Readonly<Record<TargetField, string>> = {
  account_code: "Compte",
  description: "Libellé",
  debit: "Débit",
  credit: "Crédit",
  entry_date: "Date",
  journal_code: "Journal",
  partner: "Tiers",
  reference: "Référence",
};

interface ColumnMapping {
  readonly sourceColumn: string;
  readonly sourceIndex: number;
  readonly targetField: TargetField | null;
  readonly confidence: number;
  readonly reason: string;
}

interface MappingSuggestionResult {
  readonly mappings: ReadonlyArray<ColumnMapping>;
  readonly coverage: number;
}

function MappingSection({ orgId }: { orgId: string }) {
  const [headersInput, setHeadersInput] = useState(
    "Date, Code journal, N° Compte, Libellé, Débit, Crédit, Tiers, N° Pièce",
  );
  const [sampleInput, setSampleInput] = useState(
    "15/06/2026; AC; 6132; Loyer juin; 750000; 0; SOCIDA; F-2026-001\n16/06/2026; AC; 6051; CIE juin; 120000; 0; CIE; F-2026-002",
  );

  const mappingMutation = useApiMutation<MappingSuggestionResult, void>(() => {
    const headers = headersInput
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const sampleRows = sampleInput
      .split("\n")
      .map((line) => line.split(/[;,]/).map((c) => c.trim()))
      .filter((row) => row.length > 0 && row.some((c) => c.length > 0));
    return api.post<MappingSuggestionResult>(
      `/organizations/${orgId}/ai/mapping/suggest-columns`,
      { headers, sampleRows },
    );
  });

  return (
    <section className={PANEL_CLASS}>
      <div className="border-b border-line pb-3">
        <h2 className="font-display text-xl font-medium text-ink">
          <Columns3 className="mr-2 inline h-4 w-4 text-ink" />
          Mapping IA des colonnes Sage
        </h2>
        <p className="mt-1 text-sm text-ink-mute">
          Bac à sable : coller des en-têtes Sage + quelques lignes
          d&apos;échantillon. L&apos;IA détecte chaque colonne par pattern +
          inférence de type. Coverage affichée pour mesurer combien de champs
          cibles ont été reconnus.
        </p>
      </div>
      <div className="space-y-4 pt-4">
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label htmlFor="headers-input">
              En-têtes (séparées par , ou ;)
            </Label>
            <Input
              id="headers-input"
              value={headersInput}
              onChange={(e) => setHeadersInput(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="sample-input">
              Lignes d&apos;échantillon (une par ligne, colonnes séparées par ;)
            </Label>
            <textarea
              id="sample-input"
              value={sampleInput}
              onChange={(e) => setSampleInput(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-sm border border-line-strong bg-paper px-3 py-2 text-sm text-ink transition-colors focus:border-accent focus:outline-none"
            />
          </div>
        </div>
        <Button
          onClick={() => mappingMutation.mutate()}
          disabled={
            mappingMutation.isPending || headersInput.trim().length === 0
          }
          className="press"
        >
          {mappingMutation.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Columns3 className="mr-2 h-4 w-4" />
          )}
          Analyser les colonnes
        </Button>

        {mappingMutation.error && (
          <FormError
            error={{
              code: mappingMutation.error.code,
              message: mappingMutation.error.message,
            }}
          />
        )}

        {mappingMutation.data && (
          <div className="space-y-3">
            <div className="rounded-sm border border-line bg-paper p-3 text-sm">
              <span className="font-medium text-ink">Coverage :</span>{" "}
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  mappingMutation.data.coverage >= 80
                    ? "bg-accent-soft text-accent-ink"
                    : "bg-sunk text-ink-soft"
                }`}
              >
                {mappingMutation.data.coverage} / 100
              </span>{" "}
              <span className="text-ink-mute">
                (
                {
                  mappingMutation.data.mappings.filter((m) => m.targetField)
                    .length
                }{" "}
                colonne(s) reconnue(s) sur{" "}
                {mappingMutation.data.mappings.length})
              </span>
            </div>
            <div className="overflow-x-auto rounded-sm border border-line">
              <table className="w-full text-sm">
                <thead className="bg-sunk">
                  <tr>
                    <th className="px-2 py-1.5 text-left">
                      <span className="eyebrow">Colonne source</span>
                    </th>
                    <th className="px-2 py-1.5 text-left">
                      <span className="eyebrow">Champ cible</span>
                    </th>
                    <th className="px-2 py-1.5 text-left">
                      <span className="eyebrow">Confiance</span>
                    </th>
                    <th className="px-2 py-1.5 text-left">
                      <span className="eyebrow">Raison</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {mappingMutation.data.mappings.map((m, idx) => (
                    <tr
                      key={m.sourceIndex}
                      className={`border-t border-line ${idx % 2 === 1 ? "bg-sunk/30" : ""}`}
                    >
                      <td className="px-2 py-1.5 font-medium text-ink">
                        {m.sourceColumn}
                      </td>
                      <td className="px-2 py-1.5">
                        {m.targetField ? (
                          <span className="inline-flex items-center rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent-ink">
                            {TARGET_FIELD_LABELS[m.targetField]}
                          </span>
                        ) : (
                          <span className="text-ink-mute">non mappé</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-ink">{m.confidence}</td>
                      <td className="px-2 py-1.5 text-xs text-ink-mute">
                        {m.reason}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

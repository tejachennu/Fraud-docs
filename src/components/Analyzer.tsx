"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type SVGProps } from "react";
import type { AiDetection, AiIndicator, AnalysisResult, Finding, FindingCategory, Severity, Verdict } from "@/lib/types";
import {
  AlertOctagonIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
  DatabaseIcon,
  DownloadIcon,
  FileIcon,
  HelpIcon,
  ImageIcon,
  InfoIcon,
  LockIcon,
  RefreshIcon,
  ScissorsIcon,
  SparklesIcon,
  StethoscopeIcon,
  UploadIcon,
  XIcon,
} from "./icons";

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

const ACCEPT = "application/pdf,image/png,image/jpeg,image/webp,image/heic,image/heif";
const MAX_BYTES = 14 * 1024 * 1024;

// Status colors carry state only and always travel with an icon + text label.
type Status = "good" | "warning" | "critical" | "neutral";

const STATUS: Record<Status, { fill: string; track: string; tint: string; icon: string }> = {
  good: { fill: "bg-good", track: "bg-good/20", tint: "bg-good/10 border-good/40", icon: "text-good" },
  warning: { fill: "bg-warning", track: "bg-warning/25", tint: "bg-warning/10 border-warning/50", icon: "text-warning" },
  critical: { fill: "bg-critical", track: "bg-critical/20", tint: "bg-critical/10 border-critical/40", icon: "text-critical" },
  neutral: { fill: "bg-muted", track: "bg-muted/20", tint: "bg-muted/10 border-line", icon: "text-muted" },
};

const VERDICT: Record<Verdict, { label: string; status: Status; Icon: IconType }> = {
  likely_authentic: { label: "Likely authentic", status: "good", Icon: CheckCircleIcon },
  suspicious: { label: "Suspicious", status: "warning", Icon: AlertTriangleIcon },
  likely_fraudulent: { label: "Likely fraudulent", status: "critical", Icon: AlertOctagonIcon },
  inconclusive: { label: "Inconclusive", status: "neutral", Icon: HelpIcon },
};

const SEVERITY: Record<Severity, { label: string; Icon: IconType; iconClass: string; border: string; rank: number }> = {
  high: { label: "High", Icon: AlertOctagonIcon, iconClass: "text-critical", border: "border-l-critical", rank: 0 },
  medium: { label: "Medium", Icon: AlertTriangleIcon, iconClass: "text-serious", border: "border-l-serious", rank: 1 },
  low: { label: "Low", Icon: InfoIcon, iconClass: "text-muted", border: "border-l-line", rank: 2 },
};

const CATEGORY: Record<FindingCategory, { label: string; Icon: IconType }> = {
  ai_generation: { label: "AI generation", Icon: SparklesIcon },
  visual_tampering: { label: "Tampering", Icon: ScissorsIcon },
  content_inconsistency: { label: "Inconsistency", Icon: AlertTriangleIcon },
  medical_implausibility: { label: "Medical plausibility", Icon: StethoscopeIcon },
  formatting: { label: "Formatting", Icon: FileIcon },
  metadata: { label: "Metadata", Icon: DatabaseIcon },
  provider_verification: { label: "Provider", Icon: CheckCircleIcon },
  other: { label: "Other", Icon: InfoIcon },
};

const STEPS = [
  "Uploading document",
  "Inspecting metadata & content credentials",
  "Reviewing content for forgery & tampering",
  "Running AI-generation detector",
  "Compiling report",
];

function scoreStatus(score: number): Status {
  if (score >= 70) return "critical";
  if (score >= 30) return "warning";
  return "good";
}

const SCORE_LABEL: Record<Status, string> = {
  good: "Low",
  warning: "Elevated",
  critical: "High",
  neutral: "Unknown",
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function Analyzer() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);

  // Advance the progress steps while waiting; the last step holds until the response arrives.
  useEffect(() => {
    if (!loading) return;
    const timers = [900, 2200, 6000, 14000].map((ms, i) => setTimeout(() => setStep(i + 1), ms));
    return () => timers.forEach(clearTimeout);
  }, [loading]);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const selectFile = useCallback((f: File | undefined) => {
    if (!f) return;
    setResult(null);
    if (f.size > MAX_BYTES) {
      setError(`"${f.name}" is ${formatBytes(f.size)}. The maximum size is 14 MB.`);
      return;
    }
    setError(null);
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
  }, []);

  function reset() {
    setFile(null);
    setPreviewUrl(null);
    setResult(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function analyze() {
    if (!file) return;
    setLoading(true);
    setStep(0);
    setError(null);
    setResult(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/analyze", { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setResult(data as AnalysisResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed.");
    } finally {
      setLoading(false);
    }
  }

  const isPdf = file?.type === "application/pdf";
  const FileTypeIcon = isPdf ? FileIcon : ImageIcon;

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      {/* Left: upload + preview */}
      <section className="flex flex-col gap-4 lg:sticky lg:top-20">
        <div className="rounded-2xl border border-line bg-card p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-ink">1. Upload document</h2>
          <p className="mt-1 text-sm text-muted">Prescriptions, lab reports, discharge summaries, certificates, bills or claim forms.</p>

          {!file ? (
            <div
              role="button"
              tabIndex={0}
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                selectFile(e.dataTransfer.files[0]);
              }}
              className={`mt-4 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 text-center transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                dragging ? "scale-[1.01] border-accent bg-accent-soft" : "border-line hover:border-accent/60 hover:bg-accent-soft/50"
              }`}
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-2xl text-accent">
                <UploadIcon />
              </span>
              <p className="mt-4 font-medium text-ink">
                Drop a file here or <span className="text-accent underline underline-offset-2">browse</span>
              </p>
              <p className="mt-1 text-xs text-muted">PDF, PNG, JPEG, WEBP or HEIC · up to 14 MB</p>
            </div>
          ) : (
            <div className="mt-4 flex items-center gap-3 rounded-xl border border-line p-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-xl text-accent">
                <FileTypeIcon />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{file.name}</p>
                <p className="text-xs text-muted">
                  {isPdf ? "PDF document" : "Image"} · {formatBytes(file.size)}
                </p>
              </div>
              <button
                onClick={reset}
                disabled={loading}
                aria-label="Remove file"
                className="rounded-lg p-2 text-lg text-muted hover:bg-bg hover:text-ink disabled:opacity-40"
              >
                <XIcon />
              </button>
            </div>
          )}
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => selectFile(e.target.files?.[0])}
          />

          <button
            onClick={analyze}
            disabled={!file || loading}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 dark:text-[#0c0e13]"
          >
            {loading ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                Analyzing…
              </>
            ) : (
              <>
                <SparklesIcon className="text-base" />
                {result ? "Re-run analysis" : "Analyze document"}
              </>
            )}
          </button>

          <p className="mt-3 flex items-center gap-1.5 text-xs text-muted">
            <LockIcon /> Processed in memory, never stored.
          </p>
        </div>

        {previewUrl && file && (
          <div className="overflow-hidden rounded-2xl border border-line bg-card shadow-sm">
            <p className="border-b border-line px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-muted">Preview</p>
            {isPdf ? (
              <iframe src={previewUrl} title="Document preview" className="h-[280px] w-full bg-white lg:h-[480px]" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- local blob preview
              <img src={previewUrl} alt="Document preview" className="max-h-[280px] w-full bg-bg object-contain lg:max-h-[480px]" />
            )}
          </div>
        )}
      </section>

      {/* Right: status + results */}
      <section className="flex flex-col gap-4">
        {error && (
          <div role="alert" className="animate-fade-up flex gap-3 rounded-2xl border border-critical/40 bg-critical/10 p-4 text-sm text-ink">
            <AlertOctagonIcon className="mt-0.5 shrink-0 text-lg text-critical" />
            <div>
              <p className="font-semibold">Analysis failed</p>
              <p className="mt-0.5 text-ink-2">{error}</p>
            </div>
          </div>
        )}

        {loading && <Progress step={step} />}

        {!result && !loading && <EmptyState />}

        {result && !loading && <Report result={result} onReset={reset} />}
      </section>
    </div>
  );
}

function Progress({ step }: { step: number }) {
  return (
    <div className="animate-fade-up rounded-2xl border border-line bg-card p-6 shadow-sm">
      <h2 className="text-sm font-semibold text-ink">2. Analyzing</h2>
      <ol className="mt-5 space-y-4">
        {STEPS.map((label, i) => {
          const done = i < step;
          const active = i === step;
          return (
            <li key={label} className="flex items-center gap-3 text-sm">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs ${
                  done ? "border-accent bg-accent text-white dark:text-[#0c0e13]" : active ? "border-accent text-accent" : "border-line text-muted"
                }`}
              >
                {done ? "✓" : active ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" /> : i + 1}
              </span>
              <span className={done || active ? "text-ink" : "text-muted"}>{label}</span>
            </li>
          );
        })}
      </ol>
      <div className="mt-6 space-y-2">
        {[80, 60, 70].map((w, i) => (
          <div key={i} className="h-3 animate-pulse rounded bg-bg" style={{ width: `${w}%` }} />
        ))}
      </div>
    </div>
  );
}

function EmptyState() {
  const checks: { Icon: IconType; title: string; text: string }[] = [
    { Icon: SparklesIcon, title: "AI generation", text: "Synthetic stamps, logos, signatures and garbled fine print" },
    { Icon: ScissorsIcon, title: "Tampering", text: "Edited names, dates or amounts, pasted regions, font mismatches" },
    { Icon: StethoscopeIcon, title: "Medical plausibility", text: "Impossible lab values, unsafe doses, invalid codes" },
    { Icon: DatabaseIcon, title: "File forensics", text: "Editing software, re-saved PDFs, stripped or conflicting metadata" },
  ];
  return (
    <div className="rounded-2xl border border-line bg-card p-6 shadow-sm">
      <h2 className="text-sm font-semibold text-ink">2. Review the report</h2>
      <p className="mt-1 text-sm text-muted">Upload a document to see its verdict, risk score and evidence. Each document is checked for:</p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {checks.map(({ Icon, title, text }) => (
          <div key={title} className="rounded-xl border border-line p-4">
            <Icon className="text-xl text-accent" />
            <p className="mt-3 text-sm font-medium text-ink">{title}</p>
            <p className="mt-1 text-xs leading-5 text-muted">{text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Meter({ value, label, hero = false }: { value: number; label: string; hero?: boolean }) {
  const status = scoreStatus(value);
  const s = STATUS[status];
  return (
    <div className="rounded-xl border border-line p-4">
      <p className="text-sm text-muted">{label}</p>
      <div className="mt-1 flex items-baseline gap-2">
        <span className={`font-semibold text-ink ${hero ? "text-5xl" : "text-3xl"}`}>{value}</span>
        <span className="text-sm text-muted">/ 100</span>
        <span className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium text-ink-2">
          <span className={`h-2 w-2 rounded-full ${s.fill}`} />
          {SCORE_LABEL[status]}
        </span>
      </div>
      <div
        className={`mt-3 h-2 overflow-hidden rounded-full ${s.track}`}
        role="meter"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div className={`h-full rounded-full ${s.fill} transition-[width] duration-700`} style={{ width: `${Math.max(value, 2)}%` }} />
      </div>
    </div>
  );
}

type SourcedFinding = { finding: Finding; source: "AI review" | "File metadata" };

function Report({ result, onReset }: { result: AnalysisResult; onReset: () => void }) {
  const { report, metadata } = result;
  const verdict = VERDICT[report.verdict] ?? VERDICT.inconclusive;
  const vs = STATUS[verdict.status];
  const [filter, setFilter] = useState<FindingCategory | "all">("all");

  const findings = useMemo<SourcedFinding[]>(
    () =>
      [
        ...report.findings.map((f) => ({ finding: f, source: "AI review" as const })),
        ...metadata.findings.map((f) => ({ finding: f, source: "File metadata" as const })),
      ].sort((a, b) => (SEVERITY[a.finding.severity]?.rank ?? 3) - (SEVERITY[b.finding.severity]?.rank ?? 3)),
    [report.findings, metadata.findings],
  );

  const counts = useMemo(() => {
    const bySeverity: Record<Severity, number> = { high: 0, medium: 0, low: 0 };
    const byCategory = new Map<FindingCategory, number>();
    for (const { finding } of findings) {
      if (finding.severity in bySeverity) bySeverity[finding.severity]++;
      byCategory.set(finding.category, (byCategory.get(finding.category) ?? 0) + 1);
    }
    return { bySeverity, byCategory };
  }, [findings]);

  const visible = filter === "all" ? findings : findings.filter((f) => f.finding.category === filter);

  function download() {
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${metadata.fileName.replace(/\.[^.]+$/, "")}-fraud-report.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="animate-fade-up flex flex-col gap-4">
      {/* Verdict */}
      <div className={`rounded-2xl border bg-card p-6 shadow-sm ${vs.tint}`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <verdict.Icon className={`text-4xl ${vs.icon}`} />
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted">{report.documentType || "Document"}</p>
              <p className="text-2xl font-semibold text-ink">{verdict.label}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={download}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-card px-3 py-2 text-xs font-medium text-ink-2 hover:text-ink"
            >
              <DownloadIcon /> Report
            </button>
            <button
              onClick={onReset}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-card px-3 py-2 text-xs font-medium text-ink-2 hover:text-ink"
            >
              <RefreshIcon /> New
            </button>
          </div>
        </div>
        <p className="mt-4 text-sm leading-6 text-ink-2">{report.summary}</p>
        <p className="mt-3 text-xs text-muted">Analyzed {new Date(result.analyzedAt).toLocaleString()}</p>
      </div>

      {/* Scores */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Meter label="Fraud / tampering risk" value={report.riskScore} hero />
        <Meter label="AI-generated likelihood" value={report.aiGeneratedLikelihood} />
      </div>

      {result.aiDetection && <AiDetectionCard detection={result.aiDetection} />}

      {/* Severity tiles */}
      <div className="grid grid-cols-3 gap-3">
        {(Object.keys(SEVERITY) as Severity[]).map((sev) => {
          const { label, Icon, iconClass } = SEVERITY[sev];
          return (
            <div key={sev} className="rounded-xl border border-line bg-card p-4 shadow-sm">
              <p className="flex items-center gap-1.5 text-xs text-muted">
                <Icon className={iconClass} /> {label} severity
              </p>
              <p className="mt-1 text-2xl font-semibold text-ink">{counts.bySeverity[sev]}</p>
            </div>
          );
        })}
      </div>

      {/* Findings */}
      <div className="rounded-2xl border border-line bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-ink">Findings</h2>
          <span className="text-xs text-muted">{findings.length} total</span>
        </div>

        {findings.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            <FilterChip active={filter === "all"} onClick={() => setFilter("all")} label="All" count={findings.length} />
            {[...counts.byCategory.entries()].map(([cat, n]) => (
              <FilterChip
                key={cat}
                active={filter === cat}
                onClick={() => setFilter(cat)}
                label={CATEGORY[cat]?.label ?? cat}
                count={n}
              />
            ))}
          </div>
        )}

        {findings.length === 0 ? (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-line p-4 text-sm text-ink-2">
            <CheckCircleIcon className="text-lg text-good" /> No suspicious indicators were found.
          </div>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {visible.map(({ finding, source }, i) => (
              <FindingCard key={`${filter}-${i}`} finding={finding} source={source} />
            ))}
          </ul>
        )}
      </div>

      {/* Recommendations */}
      {report.recommendations.length > 0 && (
        <div className="rounded-2xl border border-line bg-card p-5 shadow-sm">
          <h2 className="font-semibold text-ink">Recommended verification steps</h2>
          <ol className="mt-3 space-y-2.5">
            {report.recommendations.map((r, i) => (
              <li key={i} className="flex gap-3 text-sm text-ink-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent">
                  {i + 1}
                </span>
                {r}
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {report.extractedDetails.length > 0 && (
          <KeyValueCard title="Extracted details" rows={report.extractedDetails.map((d) => [d.field, d.value])} />
        )}
        {Object.keys(metadata.properties).length > 0 && (
          <KeyValueCard title="File metadata" rows={Object.entries(metadata.properties)} mono />
        )}
      </div>
    </div>
  );
}

const CONFIDENCE_LABEL: Record<AiIndicator["confidence"], string> = { low: "Low", medium: "Medium", high: "High" };

function AiDetectionCard({ detection }: { detection: AiDetection }) {
  const flagged = detection.indicators.filter((i) => i.present);
  const clear = detection.indicators.filter((i) => !i.present);
  const parts: { label: string; value: number; hint: string }[] = [
    { label: "Provenance & metadata", value: detection.provenanceFloor, hint: "C2PA, IPTC labels, generator data, image size" },
    { label: "Visual indicators", value: detection.indicatorScore, hint: `${flagged.length} of ${detection.indicators.length} indicators found` },
    { label: "Detector estimate", value: detection.modelEstimate, hint: "Holistic judgement of the detector" },
  ];
  return (
    <div className="rounded-2xl border border-line bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold text-ink">
          <SparklesIcon className="text-accent" /> AI-generation analysis
        </h2>
        <span className="text-xs text-muted">Final score uses the strongest signal</span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {parts.map((p) => {
          const st = STATUS[scoreStatus(p.value)];
          return (
            <div key={p.label} className="rounded-xl border border-line p-3">
              <p className="text-xs text-muted">{p.label}</p>
              <p className="mt-1 flex items-center gap-2 text-xl font-semibold text-ink">
                {p.value}
                <span className={`h-2 w-2 rounded-full ${st.fill}`} aria-hidden="true" />
                <span className="text-xs font-medium text-ink-2">{SCORE_LABEL[scoreStatus(p.value)]}</span>
              </p>
              <p className="mt-1 text-xs text-muted">{p.hint}</p>
            </div>
          );
        })}
      </div>

      {detection.error && (
        <p className="mt-4 flex items-start gap-2 rounded-xl border border-warning/50 bg-warning/10 p-3 text-sm text-ink-2">
          <AlertTriangleIcon className="mt-0.5 shrink-0 text-warning" /> {detection.error}
        </p>
      )}

      {detection.rationale && <p className="mt-4 text-sm leading-6 text-ink-2">{detection.rationale}</p>}

      {flagged.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2">
          {flagged.map((ind) => (
            <li key={ind.id} className="rounded-xl border border-line p-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium text-ink">{ind.label}</span>
                <span className="rounded-full bg-bg px-2 py-0.5 text-ink-2">{CONFIDENCE_LABEL[ind.confidence]} confidence</span>
              </div>
              <p className="mt-1 text-sm text-ink-2">{ind.evidence}</p>
              {ind.location && <p className="mt-1 text-xs text-muted">📍 {ind.location}</p>}
            </li>
          ))}
        </ul>
      )}

      {clear.length > 0 && (
        <div className="mt-4">
          <p className="text-xs text-muted">Checked, not found</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {clear.map((ind) => (
              <span key={ind.id} className="inline-flex items-center gap-1 rounded-full bg-bg px-2 py-0.5 text-xs text-ink-2">
                <CheckCircleIcon className="text-good" /> {ind.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {detection.authenticitySignals.length > 0 && (
        <div className="mt-4">
          <p className="text-xs text-muted">Signs of a genuine document</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-ink-2">
            {detection.authenticitySignals.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function FilterChip({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
        active ? "border-accent bg-accent-soft text-ink" : "border-line text-ink-2 hover:border-accent/50"
      }`}
    >
      {label}
      <span className="text-muted">{count}</span>
    </button>
  );
}

function FindingCard({ finding, source }: SourcedFinding) {
  const sev = SEVERITY[finding.severity] ?? SEVERITY.low;
  const cat = CATEGORY[finding.category] ?? CATEGORY.other;
  return (
    <li className={`animate-fade-up rounded-xl border border-l-4 border-line ${sev.border} bg-card p-4`}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1 rounded-full bg-bg px-2 py-0.5 font-medium text-ink">
          <sev.Icon className={sev.iconClass} /> {sev.label}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-bg px-2 py-0.5 text-ink-2">
          <cat.Icon className="text-muted" /> {cat.label}
        </span>
        <span className="ml-auto text-muted">{source}</span>
      </div>
      <p className="mt-2 font-medium text-ink">{finding.title}</p>
      <p className="mt-1 text-sm leading-6 text-ink-2">{finding.description}</p>
      {finding.location && <p className="mt-2 text-xs text-muted">📍 {finding.location}</p>}
    </li>
  );
}

function KeyValueCard({ title, rows, mono = false }: { title: string; rows: [string, string][]; mono?: boolean }) {
  return (
    <div className="rounded-2xl border border-line bg-card p-5 shadow-sm">
      <h2 className="font-semibold text-ink">{title}</h2>
      <dl className="mt-3 divide-y divide-line text-sm">
        {rows.map(([k, v], i) => (
          <div key={i} className="grid grid-cols-[40%_60%] gap-3 py-2">
            <dt className="text-muted">{k}</dt>
            <dd className={`break-words text-ink ${mono ? "font-mono text-xs leading-5" : ""}`}>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

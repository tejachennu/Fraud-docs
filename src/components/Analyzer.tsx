"use client";

import { useCallback, useRef, useState } from "react";
import type { AnalysisResult, Finding, Severity, Verdict } from "@/lib/types";

const ACCEPT = "application/pdf,image/png,image/jpeg,image/webp,image/heic,image/heif";

const VERDICT_STYLE: Record<Verdict, { label: string; className: string }> = {
  likely_authentic: { label: "Likely authentic", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" },
  suspicious: { label: "Suspicious", className: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
  likely_fraudulent: { label: "Likely fraudulent", className: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300" },
  inconclusive: { label: "Inconclusive", className: "bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300" },
};

const SEVERITY_STYLE: Record<Severity, string> = {
  high: "border-red-500 bg-red-50 dark:bg-red-950/30",
  medium: "border-amber-500 bg-amber-50 dark:bg-amber-950/30",
  low: "border-sky-500 bg-sky-50 dark:bg-sky-950/30",
};

const CATEGORY_LABEL: Record<Finding["category"], string> = {
  ai_generation: "AI generation",
  visual_tampering: "Visual tampering",
  content_inconsistency: "Content inconsistency",
  medical_implausibility: "Medical implausibility",
  formatting: "Formatting",
  metadata: "Metadata",
  provider_verification: "Provider verification",
  other: "Other",
};

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

function scoreColor(score: number): string {
  if (score >= 70) return "bg-red-500";
  if (score >= 30) return "bg-amber-500";
  return "bg-emerald-500";
}

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
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);

  const selectFile = useCallback((f: File | undefined) => {
    if (!f) return;
    setFile(f);
    setResult(null);
    setError(null);
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(f);
    });
  }, []);

  async function analyze() {
    if (!file) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/analyze", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setResult(data as AnalysisResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <section className="flex flex-col gap-4">
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
          className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
            dragging
              ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30"
              : "border-zinc-300 hover:border-indigo-400 dark:border-zinc-700"
          }`}
        >
          <p className="font-medium">Drop a medical document here, or click to browse</p>
          <p className="mt-1 text-sm text-zinc-500">PDF, PNG, JPEG, WEBP or HEIC · up to 14MB</p>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => selectFile(e.target.files?.[0])}
          />
        </div>

        {file && (
          <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{file.name}</p>
                <p className="text-sm text-zinc-500">
                  {file.type || "unknown type"} · {formatBytes(file.size)}
                </p>
              </div>
              <button
                onClick={analyze}
                disabled={loading}
                className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? "Analyzing…" : "Analyze"}
              </button>
            </div>
            {previewUrl && (
              <div className="mt-4 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                {file.type === "application/pdf" ? (
                  <iframe src={previewUrl} title="Document preview" className="h-[520px] w-full" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element -- local blob preview
                  <img src={previewUrl} alt="Document preview" className="max-h-[520px] w-full object-contain" />
                )}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-4">
        {error && (
          <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}
        {loading && (
          <div className="flex items-center gap-3 rounded-xl border border-zinc-200 p-6 dark:border-zinc-800">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
            <span className="text-sm text-zinc-600 dark:text-zinc-400">
              Running metadata checks and Gemini forensic review…
            </span>
          </div>
        )}
        {!result && !loading && !error && (
          <div className="rounded-xl border border-zinc-200 p-6 text-sm text-zinc-500 dark:border-zinc-800">
            Upload a prescription, lab report, discharge summary, medical certificate or bill. The
            document is checked for AI generation, edits/tampering, inconsistent dates and amounts,
            medically implausible values and metadata red flags.
          </div>
        )}
        {result && <Report result={result} />}
      </section>
    </div>
  );
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span className="text-zinc-600 dark:text-zinc-400">{label}</span>
        <span className="font-semibold tabular-nums">{value}/100</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
        <div className={`h-full ${scoreColor(value)}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function FindingCard({ finding, source }: { finding: Finding; source: string }) {
  return (
    <li className={`rounded-lg border-l-4 p-3 ${SEVERITY_STYLE[finding.severity]}`}>
      <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-wide text-zinc-500">
        <span className="font-semibold">{finding.severity}</span>
        <span>·</span>
        <span>{CATEGORY_LABEL[finding.category] ?? finding.category}</span>
        <span>·</span>
        <span>{source}</span>
      </div>
      <p className="mt-1 font-medium">{finding.title}</p>
      <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">{finding.description}</p>
      {finding.location && <p className="mt-1 text-xs text-zinc-500">Location: {finding.location}</p>}
    </li>
  );
}

function Report({ result }: { result: AnalysisResult }) {
  const { report, metadata } = result;
  const verdict = VERDICT_STYLE[report.verdict] ?? VERDICT_STYLE.inconclusive;
  const findings = [
    ...report.findings.map((f) => ({ finding: f, source: "Gemini" })),
    ...metadata.findings.map((f) => ({ finding: f, source: "Metadata check" })),
  ].sort((a, b) => SEVERITY_ORDER[a.finding.severity] - SEVERITY_ORDER[b.finding.severity]);

  return (
    <>
      <div className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-zinc-500">{report.documentType || "Document"}</p>
            <span className={`mt-1 inline-block rounded-full px-3 py-1 text-sm font-semibold ${verdict.className}`}>
              {verdict.label}
            </span>
          </div>
          <p className="text-xs text-zinc-500">
            {result.model} · {new Date(result.analyzedAt).toLocaleString()}
          </p>
        </div>
        <p className="mt-4 text-sm leading-6">{report.summary}</p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <ScoreBar label="Fraud / tampering risk" value={report.riskScore} />
          <ScoreBar label="AI-generated likelihood" value={report.aiGeneratedLikelihood} />
        </div>
      </div>

      <div className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
        <h2 className="font-semibold">Findings ({findings.length})</h2>
        {findings.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500">No suspicious indicators were found.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {findings.map(({ finding, source }, i) => (
              <FindingCard key={i} finding={finding} source={source} />
            ))}
          </ul>
        )}
      </div>

      {report.recommendations.length > 0 && (
        <div className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
          <h2 className="font-semibold">Recommended verification steps</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {report.recommendations.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {report.extractedDetails.length > 0 && (
          <KeyValueTable title="Extracted details" rows={report.extractedDetails.map((d) => [d.field, d.value])} />
        )}
        {Object.keys(metadata.properties).length > 0 && (
          <KeyValueTable title="File metadata" rows={Object.entries(metadata.properties)} />
        )}
      </div>
    </>
  );
}

function KeyValueTable({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
      <h2 className="font-semibold">{title}</h2>
      <dl className="mt-2 divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
        {rows.map(([k, v], i) => (
          <div key={i} className="grid grid-cols-[40%_60%] gap-2 py-1.5">
            <dt className="text-zinc-500">{k}</dt>
            <dd className="break-words">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

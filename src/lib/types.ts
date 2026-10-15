export type Severity = "low" | "medium" | "high";

export type FindingCategory =
  | "ai_generation"
  | "visual_tampering"
  | "content_inconsistency"
  | "medical_implausibility"
  | "formatting"
  | "metadata"
  | "provider_verification"
  | "other";

export type Verdict =
  | "likely_authentic"
  | "suspicious"
  | "likely_fraudulent"
  | "inconclusive";

export interface Finding {
  category: FindingCategory;
  severity: Severity;
  title: string;
  description: string;
  location?: string;
}

/** Signals derived locally from the file bytes, before any LLM call. */
export interface MetadataReport {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  properties: Record<string, string>;
  findings: Finding[];
}

export interface GeminiReport {
  verdict: Verdict;
  riskScore: number;
  aiGeneratedLikelihood: number;
  documentType: string;
  summary: string;
  extractedDetails: { field: string; value: string }[];
  findings: Finding[];
  recommendations: string[];
}

export interface AnalysisResult {
  analyzedAt: string;
  metadata: MetadataReport;
  report: GeminiReport;
}

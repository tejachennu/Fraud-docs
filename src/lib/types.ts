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
  /** Minimum AI-generated likelihood implied by provenance/metadata evidence (0 = no evidence). */
  aiSignalFloor: number;
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

export type Confidence = "low" | "medium" | "high";

export interface AiIndicator {
  id: string;
  label: string;
  present: boolean;
  confidence: Confidence;
  evidence: string;
  location?: string;
}

/** Output of the dedicated AI-generation detector pass. */
export interface AiDetection {
  /** Final AI-generated likelihood after combining every signal. */
  score: number;
  /** Score computed from the visual/text indicators the detector found. */
  indicatorScore: number;
  /** The detector model's own holistic estimate. */
  modelEstimate: number;
  /** Floor implied by provenance metadata (C2PA, IPTC, generator parameters, dimensions). */
  provenanceFloor: number;
  indicators: AiIndicator[];
  authenticitySignals: string[];
  rationale: string;
  /** Set when the detector call failed and only the other signals were used. */
  error?: string;
}

export interface AnalysisResult {
  analyzedAt: string;
  metadata: MetadataReport;
  report: GeminiReport;
  aiDetection: AiDetection;
}

import { detectAiGeneration } from "@/lib/aiDetector";
import { analyzeWithGemini } from "@/lib/gemini";
import { extractMetadata } from "@/lib/metadata";
import type { AiDetection, AnalysisResult, GeminiReport, Verdict } from "@/lib/types";

// The detector uses a slower reasoning model; both calls run in parallel.
export const maxDuration = 120;

// Gemini accepts inline requests up to ~20MB including the base64 overhead.
const MAX_BYTES = 14 * 1024 * 1024;

const SUPPORTED_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "image/heif",
]);

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Expected multipart/form-data with a 'file' field." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "No file uploaded." }, { status: 400 });
  }
  if (!SUPPORTED_TYPES.has(file.type)) {
    return Response.json(
      { error: `Unsupported file type "${file.type || "unknown"}". Upload a PDF, PNG, JPEG, WEBP or HEIC file.` },
      { status: 415 },
    );
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: "File is larger than 14MB." }, { status: 413 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  try {
    const metadata = await extractMetadata(bytes, file.name, file.type);
    const [report, aiDetection] = await Promise.all([
      analyzeWithGemini(bytes, file.type, metadata),
      detectAiGeneration(bytes, file.type, metadata),
    ]);
    const result: AnalysisResult = {
      analyzedAt: new Date().toISOString(),
      metadata,
      report: mergeAiDetection(report, aiDetection),
      aiDetection,
    };
    return Response.json(result);
  } catch (err) {
    console.error("Document analysis failed:", err);
    return Response.json({ error: describeError(err) }, { status: 502 });
  }
}

function verdictFor(risk: number): Verdict {
  if (risk >= 70) return "likely_fraudulent";
  if (risk >= 30) return "suspicious";
  return "likely_authentic";
}

/** An AI-generated medical document is fraudulent, so the AI score lifts the overall risk. */
function mergeAiDetection(report: GeminiReport, ai: AiDetection): GeminiReport {
  const aiScore = Math.max(ai.score, report.aiGeneratedLikelihood);
  const riskScore = Math.max(report.riskScore, aiScore);
  const raised = aiScore > report.aiGeneratedLikelihood + 15 || riskScore > report.riskScore + 15;
  const verdict =
    report.verdict === "inconclusive" && aiScore < 70 ? "inconclusive" : verdictFor(riskScore);
  return {
    ...report,
    aiGeneratedLikelihood: aiScore,
    riskScore,
    verdict,
    summary:
      raised && ai.rationale
        ? `${report.summary} AI-generation check: ${ai.rationale}`
        : report.summary,
  };
}

/** SDK errors carry the raw JSON response body as their message. */
function describeError(err: unknown): string {
  if (!(err instanceof Error)) return "Analysis failed.";
  try {
    const parsed = JSON.parse(err.message);
    return `Analysis service error: ${parsed?.error?.message ?? err.message}`;
  } catch {
    return err.message;
  }
}


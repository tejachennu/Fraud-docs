import { analyzeWithGemini } from "@/lib/gemini";
import { extractMetadata } from "@/lib/metadata";
import type { AnalysisResult } from "@/lib/types";

export const maxDuration = 60;

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
    const report = await analyzeWithGemini(bytes, file.type, metadata);
    const result: AnalysisResult = {
      analyzedAt: new Date().toISOString(),
      metadata,
      report,
    };
    return Response.json(result);
  } catch (err) {
    console.error("Document analysis failed:", err);
    return Response.json({ error: describeError(err) }, { status: 502 });
  }
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


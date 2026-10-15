import "server-only";
import { GoogleGenAI, Type, type Schema } from "@google/genai";
import type { GeminiReport, MetadataReport } from "./types";

export const DEFAULT_MODEL = "gemini-2.5-flash";

export function getModelName(): string {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
}

const SYSTEM_INSTRUCTION = `You are a forensic document examiner specialising in healthcare and insurance fraud.
You review medical documents (prescriptions, lab reports, discharge summaries, medical certificates,
sick notes, invoices/bills, imaging reports, insurance claim forms) and decide whether they are
genuine, AI-generated, forged or tampered with.

Examine the document for:
1. AI generation: synthetic-looking logos/stamps/signatures, garbled or nonsensical text in small print,
   warped letters, inconsistent fonts within a line, overly generic or templated language, perfect symmetry,
   smooth "rendered" textures, physician names or addresses that look invented, LLM-style phrasing.
2. Visual tampering: misaligned text baselines, mismatched fonts/sizes/colours/kerning in edited fields
   (names, dates, amounts, diagnoses), copy-pasted or cloned regions, inconsistent compression or background
   noise around specific fields, white-out boxes, stamps or signatures that look pasted on.
3. Content inconsistencies: dates that conflict (e.g. report before admission, future dates, weekend/holiday
   clinics), totals that do not add up, mismatched patient age vs. DOB, gender-inconsistent diagnoses,
   contradictory identifiers across pages.
4. Medical implausibility: impossible or highly unusual lab values, wrong reference ranges or units, drug
   dosages outside safe limits, drug-diagnosis mismatches, invalid ICD/CPT codes, procedures that do not
   match the diagnosis, improbable treatment durations.
5. Formatting/provider red flags: missing registration/licence numbers, invalid-looking licence formats,
   missing letterhead details (address, phone), spelling mistakes in medical terms or the facility name,
   unusual layouts for the stated document type.

Be calibrated. Real medical documents are often messy, scanned, handwritten or low-quality; do not treat
poor scan quality alone as fraud. Only report findings you can point to in the document, and say where
(page, section or field). If nothing is suspicious, say so and return few or no findings.

Scoring:
- riskScore 0-100: overall likelihood the document is fraudulent, forged, tampered or AI-generated.
- aiGeneratedLikelihood 0-100: likelihood the document (or parts of it) were produced by generative AI.
- verdict: "likely_authentic" (risk < 30), "suspicious" (30-69), "likely_fraudulent" (>= 70),
  or "inconclusive" when the file is unreadable or not a medical document.

In extractedDetails, list key fields you can read (patient name, provider, facility, dates, amounts,
diagnoses, registration numbers). Mask all but the last 4 characters of any national ID, insurance or
account number.`;

const findingSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    category: {
      type: Type.STRING,
      enum: [
        "ai_generation",
        "visual_tampering",
        "content_inconsistency",
        "medical_implausibility",
        "formatting",
        "metadata",
        "provider_verification",
        "other",
      ],
    },
    severity: { type: Type.STRING, enum: ["low", "medium", "high"] },
    title: { type: Type.STRING, description: "Short headline for the finding" },
    description: { type: Type.STRING, description: "What was observed and why it is suspicious" },
    location: { type: Type.STRING, description: "Page / section / field where it was observed" },
  },
  required: ["category", "severity", "title", "description"],
  propertyOrdering: ["category", "severity", "title", "description", "location"],
};

const responseSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    documentType: { type: Type.STRING },
    summary: { type: Type.STRING, description: "2-4 sentence overall assessment" },
    findings: { type: Type.ARRAY, items: findingSchema },
    extractedDetails: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { field: { type: Type.STRING }, value: { type: Type.STRING } },
        required: ["field", "value"],
      },
    },
    recommendations: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Concrete verification steps for a claims reviewer",
    },
    riskScore: { type: Type.INTEGER, minimum: 0, maximum: 100 },
    aiGeneratedLikelihood: { type: Type.INTEGER, minimum: 0, maximum: 100 },
    verdict: {
      type: Type.STRING,
      enum: ["likely_authentic", "suspicious", "likely_fraudulent", "inconclusive"],
    },
  },
  required: [
    "documentType",
    "summary",
    "findings",
    "extractedDetails",
    "recommendations",
    "riskScore",
    "aiGeneratedLikelihood",
    "verdict",
  ],
  // Reason over evidence first, then score.
  propertyOrdering: [
    "documentType",
    "summary",
    "findings",
    "extractedDetails",
    "recommendations",
    "riskScore",
    "aiGeneratedLikelihood",
    "verdict",
  ],
};

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set. Add it to .env.local (see .env.example).");
  }
  client ??= new GoogleGenAI({ apiKey });
  return client;
}

export async function analyzeWithGemini(
  bytes: Buffer,
  mimeType: string,
  metadata: MetadataReport,
): Promise<GeminiReport> {
  const metadataContext = JSON.stringify(
    { properties: metadata.properties, automatedFindings: metadata.findings },
    null,
    2,
  );

  const response = await getClient().models.generateContent({
    model: getModelName(),
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType, data: bytes.toString("base64") } },
          {
            text: `Analyse the attached medical document (file name: "${metadata.fileName}").

Automated file-metadata checks produced the following. Treat them as supporting evidence, weigh them
together with what you see in the document, and do not repeat them verbatim as findings:
${metadataContext}

Return your assessment as JSON matching the schema.`,
          },
        ],
      },
    ],
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      temperature: 0.1,
      responseMimeType: "application/json",
      responseSchema,
    },
  });

  const text = response.text;
  if (!text) {
    const reason = response.promptFeedback?.blockReason ?? response.candidates?.[0]?.finishReason;
    throw new Error(`The analysis service returned no content${reason ? ` (${reason})` : ""}.`);
  }

  const report = JSON.parse(text) as GeminiReport;
  report.riskScore = clampScore(report.riskScore);
  report.aiGeneratedLikelihood = clampScore(report.aiGeneratedLikelihood);
  report.findings ??= [];
  report.extractedDetails ??= [];
  report.recommendations ??= [];
  return report;
}

function clampScore(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return Math.min(100, Math.max(0, Math.round(v)));
}

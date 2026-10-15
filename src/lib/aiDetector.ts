import "server-only";
import { Type, type Schema } from "@google/genai";
import { getClient, getModelName } from "./gemini";
import type { AiDetection, AiIndicator, Confidence, MetadataReport } from "./types";

export const DEFAULT_DETECTOR_MODEL = "gemini-2.5-pro";

export function getDetectorModelName(): string {
  return process.env.GEMINI_DETECTOR_MODEL?.trim() || DEFAULT_DETECTOR_MODEL;
}

/**
 * Each indicator carries a weight: the probability it alone implies AI generation when
 * observed with high confidence. Weights are combined with a noisy-OR, so several
 * moderate indicators add up while one weak one stays weak.
 */
const INDICATORS: { id: string; label: string; weight: number; prompt: string }[] = [
  {
    id: "garbled_text",
    label: "Garbled or malformed text",
    weight: 0.6,
    prompt:
      "Misspelled, nonsensical or invented words; letters that morph into other letters; pseudo-text in small print, footers, stamps, table headers or reference ranges; characters that are not real glyphs.",
  },
  {
    id: "inconsistent_glyphs",
    label: "Inconsistent letterforms",
    weight: 0.4,
    prompt:
      "The same character drawn differently within one word or line, uneven stroke weight, wobbly baselines, or digits whose shapes change across the document in a way no font or printer would produce.",
  },
  {
    id: "malformed_logo_stamp",
    label: "Malformed logo, seal or stamp",
    weight: 0.5,
    prompt:
      "Logos, hospital emblems, circular seals or rubber stamps whose text is illegible or nonsensical, whose circular text is unevenly spaced, or whose geometry is melted or asymmetric.",
  },
  {
    id: "synthetic_signature",
    label: "Synthetic signature",
    weight: 0.3,
    prompt:
      "Signatures with unnaturally smooth, uniform strokes, no pen pressure variation, or that look painted rather than written.",
  },
  {
    id: "broken_geometry",
    label: "Broken table or layout geometry",
    weight: 0.4,
    prompt:
      "Table rules that bend, fade, merge or stop mid-cell; columns that drift; boxes that do not close; checkbox grids with irregular spacing.",
  },
  {
    id: "physical_inconsistency",
    label: "Physically implausible photo",
    weight: 0.45,
    prompt:
      "For photos of paper: impossible lighting or shadows, perspective of the text not matching the paper's tilt, folds or creases that do not affect the printed content, missing paper texture, edges that blend into the background, warped surrounding objects, or malformed hands or fingers.",
  },
  {
    id: "synthetic_texture",
    label: "Rendered, too-clean texture",
    weight: 0.35,
    prompt:
      "Plastic or airbrushed smoothness, painterly gradients, no sensor noise, scanner dust or print halftone, or a uniform 'render' look across the whole image.",
  },
  {
    id: "hallucinated_content",
    label: "Hallucinated details",
    weight: 0.35,
    prompt:
      "Invented-looking facility or doctor names, placeholder-style data (e.g. 'Dr. John Smith', '123 Main Street'), phone numbers or registration numbers with impossible formats, addresses that cannot exist, lab test names that are not real.",
  },
  {
    id: "repetition_artifacts",
    label: "Repetition artifacts",
    weight: 0.25,
    prompt: "Duplicated rows, repeated texture tiles, or the same phrase or value repeated in a pattern that a real record would not have.",
  },
  {
    id: "llm_writing_style",
    label: "LLM writing style",
    weight: 0.3,
    prompt:
      "Clinical notes or letters written in the polished, generic, evenly structured voice of a chatbot (e.g. 'It is important to note', perfectly balanced bullet lists), unlike real clinician shorthand.",
  },
];

const CONFIDENCE_FACTOR: Record<Confidence, number> = { low: 0.35, medium: 0.7, high: 1 };

const SYSTEM_INSTRUCTION = `You are a specialist in detecting AI-generated images and documents. You are screening
medical documents submitted for insurance or reimbursement claims, where missing an AI-generated document is costly.

Modern generators (GPT-4o / gpt-image, Gemini / Imagen, Midjourney v6+, FLUX, Ideogram) render clean, mostly-correct
text, so a document that looks tidy at a glance is NOT evidence of authenticity. Inspect it closely:
zoom into fine print, stamps, seals, logos, signatures, table borders, numbers, reference ranges and edges.
Read text word by word and check that every word is real and every number is well-formed.

Evaluate EVERY indicator in the list. For each one, state whether it is present, your confidence, and the specific
evidence (quote the text or describe the region). Mark an indicator present only if you can point to it.
Also list any concrete authenticity signals you see (e.g. genuine sensor noise, real paper fibres, ink bleed,
consistent printer artefacts, natural handwriting variation).

Then give modelEstimate: your overall probability (0-100) that the document, or a substantial part of it, was
produced by generative AI.`;

const responseSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    indicators: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING, enum: INDICATORS.map((i) => i.id) },
          present: { type: Type.BOOLEAN },
          confidence: { type: Type.STRING, enum: ["low", "medium", "high"] },
          evidence: { type: Type.STRING },
          location: { type: Type.STRING },
        },
        required: ["id", "present", "confidence", "evidence"],
        propertyOrdering: ["id", "evidence", "location", "present", "confidence"],
      },
    },
    authenticitySignals: { type: Type.ARRAY, items: { type: Type.STRING } },
    rationale: { type: Type.STRING, description: "1-3 sentence conclusion" },
    modelEstimate: { type: Type.INTEGER, minimum: 0, maximum: 100 },
  },
  required: ["indicators", "authenticitySignals", "rationale", "modelEstimate"],
  propertyOrdering: ["indicators", "authenticitySignals", "rationale", "modelEstimate"],
};

interface DetectorResponse {
  indicators: { id: string; present: boolean; confidence: Confidence; evidence: string; location?: string }[];
  authenticitySignals: string[];
  rationale: string;
  modelEstimate: number;
}

async function callDetector(model: string, bytes: Buffer, mimeType: string, metadata: MetadataReport) {
  const checklist = INDICATORS.map((i) => `- ${i.id} (${i.label}): ${i.prompt}`).join("\n");
  const provenance = metadata.findings.filter((f) => f.category === "ai_generation").map((f) => `- ${f.title}: ${f.description}`);

  const response = await getClient().models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType, data: bytes.toString("base64") } },
          {
            text: `Indicators to evaluate:
${checklist}

File-level provenance checks found:
${provenance.length ? provenance.join("\n") : "- nothing (absence proves nothing: screenshots and re-saves strip metadata)"}

Return JSON matching the schema.`,
          },
        ],
      },
    ],
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      temperature: 0.2,
      responseMimeType: "application/json",
      responseSchema,
    },
  });
  if (!response.text) throw new Error("The AI-generation detector returned no content.");
  return JSON.parse(response.text) as DetectorResponse;
}

function clamp(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return Math.min(100, Math.max(0, Math.round(v)));
}

export async function detectAiGeneration(
  bytes: Buffer,
  mimeType: string,
  metadata: MetadataReport,
): Promise<AiDetection> {
  const provenanceFloor = metadata.aiSignalFloor;
  let data: DetectorResponse;
  try {
    data = await callDetector(getDetectorModelName(), bytes, mimeType, metadata);
  } catch (primaryErr) {
    // The stronger model may be unavailable on this key (quota, region); fall back to the main model.
    try {
      if (getDetectorModelName() === getModelName()) throw primaryErr;
      data = await callDetector(getModelName(), bytes, mimeType, metadata);
    } catch (err) {
      console.error("AI-generation detector failed:", err);
      return {
        score: provenanceFloor,
        indicatorScore: 0,
        modelEstimate: 0,
        provenanceFloor,
        indicators: [],
        authenticitySignals: [],
        rationale: "",
        error: "The visual AI-generation check could not run; only file-level signals were used.",
      };
    }
  }

  const byId = new Map(data.indicators?.map((i) => [i.id, i]) ?? []);
  const indicators: AiIndicator[] = INDICATORS.map((def) => {
    const r = byId.get(def.id);
    return {
      id: def.id,
      label: def.label,
      present: Boolean(r?.present),
      confidence: r?.confidence ?? "low",
      evidence: r?.evidence ?? "",
      location: r?.location || undefined,
    };
  });

  // Noisy-OR over observed indicators.
  let notAi = 1;
  for (const ind of indicators) {
    if (!ind.present) continue;
    const weight = INDICATORS.find((d) => d.id === ind.id)!.weight;
    notAi *= 1 - weight * CONFIDENCE_FACTOR[ind.confidence];
  }
  const indicatorScore = clamp((1 - notAi) * 100);
  const modelEstimate = clamp(data.modelEstimate);

  // Any strong signal should win; do not let one optimistic signal average the others away.
  const score = Math.max(indicatorScore, modelEstimate, provenanceFloor);

  return {
    score,
    indicatorScore,
    modelEstimate,
    provenanceFloor,
    indicators,
    authenticitySignals: data.authenticitySignals ?? [],
    rationale: data.rationale ?? "",
  };
}

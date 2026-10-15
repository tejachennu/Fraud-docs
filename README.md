# Medical Document Fraud Check

A Next.js app that uses Google Gemini to flag medical documents that are **AI-generated, forged or
tampered with**. Upload a prescription, lab report, discharge summary, medical certificate, sick note,
hospital bill or claim form (PDF or image) and get a risk verdict, scores and evidence-backed findings.

## How it works

Each upload goes through two layers:

1. **File-metadata checks** (`src/lib/metadata.ts`, run locally with no AI involved)
   - PDF: Producer/Creator/XMP tool names (AI tools such as ChatGPT/Midjourney, or editors such as
     Photoshop, Canva, iLovePDF), creation vs. modification dates, stripped metadata, and incremental
     updates (`%%EOF` revisions) that indicate in-place edits.
   - Images: EXIF/XMP/IPTC; editing software, missing capture device, re-saves after capture, and the
     IPTC `DigitalSourceType = trainedAlgorithmicMedia` AI-generation marker.
2. **Gemini forensic review** (`src/lib/gemini.ts`). The document is sent to Gemini together with the
   metadata findings and a forensic-examiner prompt. It returns structured JSON (schema enforced) covering:
   - AI-generation artifacts: garbled small print, synthetic stamps, logos or signatures, templated phrasing
   - Visual tampering: mismatched fonts, alignment or compression around edited fields, pasted signatures
   - Content inconsistencies: conflicting dates, totals that don't add up, age vs. DOB mismatches
   - Medical implausibility: impossible lab values, wrong units or ranges, unsafe doses, invalid codes
   - Provider red flags: missing or invalid registration numbers, misspelled facility names

3. **AI-generation detector** (`src/lib/aiDetector.ts` + `src/lib/provenance.ts`)
   - Provenance: C2PA content credentials (ChatGPT/OpenAI, Adobe Firefly, Google and Microsoft embed them),
     IPTC `trainedAlgorithmicMedia` labels, Stable Diffusion/ComfyUI prompt parameters in PNG text chunks,
     and image sizes that match generator output (e.g. 1024×1536) when no camera data is present.
   - A second, dedicated model pass (`gemini-2.5-pro` by default) checks a fixed list of 10 indicators:
     garbled text, inconsistent letterforms, malformed seals and stamps, synthetic signatures, broken
     table geometry, physically implausible photos, rendered textures, hallucinated details, repetition
     artifacts and LLM writing style. The indicators it finds are scored in code with a noisy-OR, rather
     than relying on the model's own number.
   - The final AI score is the strongest of: the provenance floor, the indicator score and the detector's
     own estimate. Because an AI-generated medical document is fraudulent, it also raises the overall risk.

The UI shows a verdict (`likely_authentic` / `suspicious` / `likely_fraudulent` / `inconclusive`), a
fraud-risk score, an AI-generated likelihood, all findings sorted by severity, the extracted key fields
(IDs are masked) and suggested verification steps.

## Getting started

```bash
npm install
cp .env.example .env.local   # then set GEMINI_API_KEY
npm run dev
```

Open http://localhost:3000.

| Variable         | Required | Description                                              |
| ---------------- | -------- | -------------------------------------------------------- |
| `GEMINI_API_KEY` | yes      | Key from https://aistudio.google.com/apikey              |
| `GEMINI_MODEL`   | no       | Model for the main forensic review. The default is `gemini-2.5-flash`. |
| `GEMINI_DETECTOR_MODEL` | no | Model for the AI-generation detector. The default is `gemini-2.5-pro`; it falls back to `GEMINI_MODEL`. |

## API

`POST /api/analyze` takes `multipart/form-data` with a `file` field (PDF, PNG, JPEG, WEBP or HEIC, up to 14MB).

```bash
curl -F "file=@prescription.pdf" http://localhost:3000/api/analyze
```

It returns `{ model, analyzedAt, metadata: { properties, findings }, report: { verdict, riskScore,
aiGeneratedLikelihood, documentType, summary, findings, extractedDetails, recommendations } }`.

## Important notes

- **Privacy:** medical documents contain PHI. Uploaded files are processed in memory and are not stored
  by this app, but they are sent to the Gemini API. Check that your Google Cloud / AI Studio terms and data
  handling meet your HIPAA, GDPR or local requirements before you use real patient data. For regulated
  workloads, consider Vertex AI.
- **Detection limits:** no AI-image detector is fully reliable. Screenshots, re-saves and messaging
  apps strip provenance metadata, and the newest generators render text well. Treat low scores as
  "no evidence found", not as proof that a document is authentic.
- **Not proof:** the results are AI-assisted indicators that help prioritise manual review. Always confirm
  with the issuing provider before you reject a claim or take action.

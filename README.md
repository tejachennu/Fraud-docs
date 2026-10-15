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
| `GEMINI_MODEL`   | no       | Gemini model id. The default is `gemini-2.5-flash`; use a Pro model for harder cases. |

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
- **Not proof:** the results are AI-assisted indicators that help prioritise manual review. Always confirm
  with the issuing provider before you reject a claim or take action.

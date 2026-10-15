import exifr from "exifr";
import type { Finding, MetadataReport } from "./types";

// Tools whose presence in the producer/creator/software fields indicates the
// file was generated or edited rather than exported by a clinical system.
const AI_TOOL_PATTERN =
  /chatgpt|openai|dall[-·\s]?e|midjourney|stable[\s-]?diffusion|gemini|imagen|firefly|claude|copilot|leonardo|ideogram|flux|novelai|runway/i;
const EDITOR_PATTERN =
  /photoshop|gimp|illustrator|canva|ilovepdf|smallpdf|sejda|pdfescape|pdf[\s-]?element|foxit\s*phantom|nitro|inkscape|affinity|pixelmator|paint\.net|picsart|snapseed|acrobat\s*pro|pdf\s*editor/i;
const SCAN_PATTERN = /scan|epson|canon|xerox|ricoh|brother|kyocera|hp\s|konica|sharp/i;

function decodePdfString(raw: string): string {
  return raw
    .replace(/\\([nrtbf()\\])/g, (_, c: string) =>
      ({ n: "\n", r: "\r", t: "\t", b: "", f: "", "(": "(", ")": ")", "\\": "\\" })[c] ?? c,
    )
    .replace(/\\(\d{1,3})/g, (_, oct: string) => String.fromCharCode(parseInt(oct, 8)))
    .trim();
}

/** Parses "D:YYYYMMDDHHmmSS..." PDF dates. */
function parsePdfDate(value: string): Date | null {
  const m = value.match(/D?:?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/);
  if (!m) return null;
  const [, y, mo = "01", d = "01", h = "00", mi = "00", s = "00"] = m;
  const date = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
  return Number.isNaN(date.getTime()) ? null : date;
}

function inspectToolNames(
  tools: string[],
  findings: Finding[],
  isPdf: boolean,
): void {
  const matching = (pattern: RegExp) => tools.filter((t) => pattern.test(t)).join(" | ");
  const aiTools = matching(AI_TOOL_PATTERN);
  const editors = matching(EDITOR_PATTERN);
  const scanners = matching(SCAN_PATTERN);
  if (aiTools) {
    findings.push({
      category: "ai_generation",
      severity: "high",
      title: "Generative-AI tool in file metadata",
      description: `The file metadata references an AI generation tool: "${aiTools}".`,
      location: "File metadata",
    });
  }
  if (editors) {
    findings.push({
      category: "metadata",
      severity: "medium",
      title: "Editing software in file metadata",
      description: `The file was produced or modified with editing software ("${editors}"), which is unusual for documents exported directly from a hospital, lab or pharmacy system.`,
      location: "File metadata",
    });
  }
  if (isPdf && scanners) {
    // Informational: a scan is normal, but it removes the original digital trail.
    findings.push({
      category: "metadata",
      severity: "low",
      title: "Document appears to be a scan",
      description: `Producer suggests a scanned document ("${scanners}"); digital provenance cannot be verified from metadata alone.`,
      location: "File metadata",
    });
  }
}

function analyzePdf(bytes: Buffer, report: MetadataReport): void {
  // latin1 keeps a 1:1 byte→char mapping so regexes work on raw PDF syntax.
  const text = bytes.toString("latin1");
  const { properties, findings } = report;

  for (const key of ["Title", "Author", "Creator", "Producer", "CreationDate", "ModDate"]) {
    const m = text.match(new RegExp(`/${key}\\s*\\(((?:\\\\.|[^\\\\)])*)\\)`));
    if (m) properties[key] = decodePdfString(m[1]);
  }
  const xmpTool = text.match(/<xmp:CreatorTool>([^<]*)<\/xmp:CreatorTool>/);
  if (xmpTool) properties.XmpCreatorTool = xmpTool[1].trim();
  const xmpProducer = text.match(/<pdf:Producer>([^<]*)<\/pdf:Producer>/);
  if (xmpProducer) properties.XmpProducer = xmpProducer[1].trim();

  inspectToolNames(
    [properties.Creator, properties.Producer, properties.XmpCreatorTool, properties.XmpProducer].filter(
      (v): v is string => Boolean(v),
    ),
    findings,
    true,
  );

  const created = properties.CreationDate ? parsePdfDate(properties.CreationDate) : null;
  const modified = properties.ModDate ? parsePdfDate(properties.ModDate) : null;
  if (created) properties.CreationDate = created.toISOString();
  if (modified) properties.ModDate = modified.toISOString();
  if (created && modified) {
    const diffHours = (modified.getTime() - created.getTime()) / 36e5;
    if (diffHours < 0) {
      findings.push({
        category: "metadata",
        severity: "medium",
        title: "Modification date precedes creation date",
        description: "The PDF claims it was modified before it was created, which indicates manipulated or re-written metadata.",
        location: "PDF Info dictionary",
      });
    } else if (diffHours > 1) {
      findings.push({
        category: "metadata",
        severity: "low",
        title: "PDF modified after creation",
        description: `The PDF was modified about ${Math.round(diffHours)} hour(s) after it was created.`,
        location: "PDF Info dictionary",
      });
    }
  }
  if (!properties.Producer && !properties.Creator && !properties.XmpProducer) {
    findings.push({
      category: "metadata",
      severity: "low",
      title: "Producer metadata missing",
      description: "The PDF carries no Producer/Creator information; metadata may have been stripped.",
      location: "PDF Info dictionary",
    });
  }

  // Each incremental save appends a new trailer ending in %%EOF.
  const revisions = (text.match(/%%EOF/g) ?? []).length;
  properties.Revisions = String(revisions);
  if (revisions > 1) {
    findings.push({
      category: "visual_tampering",
      severity: revisions > 2 ? "medium" : "low",
      title: "PDF has incremental updates",
      description: `The file contains ${revisions} revisions. Content was appended after the original was saved, which is how many PDF editors alter text or images in place.`,
      location: "PDF structure",
    });
  }
}

async function analyzeImage(bytes: Buffer, report: MetadataReport): Promise<void> {
  const { properties, findings } = report;
  let exif: Record<string, unknown> | undefined;
  try {
    exif = await exifr.parse(bytes, { xmp: true, iptc: true, icc: false });
  } catch {
    exif = undefined;
  }

  if (!exif || Object.keys(exif).length === 0) {
    findings.push({
      category: "metadata",
      severity: "low",
      title: "No EXIF metadata",
      description: "The image has no camera/scanner metadata. Screenshots, AI-generated images and re-saved edits often lack EXIF data.",
      location: "Image metadata",
    });
    return;
  }

  const pick = [
    "Make", "Model", "Software", "CreatorTool", "DateTimeOriginal", "ModifyDate",
    "CreateDate", "Artist", "HostComputer", "DigitalSourceType", "Credit",
  ];
  for (const key of pick) {
    const value = exif[key];
    if (value === undefined || value === null) continue;
    properties[key] = value instanceof Date ? value.toISOString() : String(value);
  }

  inspectToolNames(
    [properties.Software, properties.CreatorTool, properties.Credit, properties.HostComputer].filter(
      (v): v is string => Boolean(v),
    ),
    findings,
    false,
  );

  // IPTC/C2PA "trainedAlgorithmicMedia" marks AI-generated content.
  if (/trainedAlgorithmicMedia|compositeWithTrainedAlgorithmicMedia/i.test(properties.DigitalSourceType ?? "")) {
    findings.push({
      category: "ai_generation",
      severity: "high",
      title: "Image declared as AI-generated",
      description: `IPTC DigitalSourceType is "${properties.DigitalSourceType}", a standard marker for AI-generated media.`,
      location: "Image metadata",
    });
  }

  if (!properties.Make && !properties.Model) {
    findings.push({
      category: "metadata",
      severity: "low",
      title: "No capture device recorded",
      description: "The image metadata does not name a camera or scanner.",
      location: "Image metadata",
    });
  }

  const original = exif.DateTimeOriginal instanceof Date ? exif.DateTimeOriginal : null;
  const modified = exif.ModifyDate instanceof Date ? exif.ModifyDate : null;
  if (original && modified && modified.getTime() - original.getTime() > 36e5) {
    findings.push({
      category: "metadata",
      severity: "low",
      title: "Image modified after capture",
      description: "The image was saved again after it was originally captured.",
      location: "Image metadata",
    });
  }
}

export async function extractMetadata(
  bytes: Buffer,
  fileName: string,
  mimeType: string,
): Promise<MetadataReport> {
  const report: MetadataReport = {
    fileName,
    mimeType,
    sizeBytes: bytes.length,
    properties: {},
    findings: [],
  };
  if (mimeType === "application/pdf") {
    analyzePdf(bytes, report);
  } else {
    await analyzeImage(bytes, report);
  }
  return report;
}

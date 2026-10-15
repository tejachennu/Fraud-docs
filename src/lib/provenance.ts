import { inflateSync } from "node:zlib";
import type { Finding, MetadataReport } from "./types";

/**
 * Byte-level provenance checks for AI-generated media. These survive cases exifr misses:
 * C2PA content credentials (OpenAI, Adobe, Google, Microsoft embed them), IPTC
 * DigitalSourceType values inside XMP/C2PA, and generation parameters that Stable
 * Diffusion UIs (A1111, ComfyUI, InvokeAI, NovelAI) write into PNG text chunks.
 * Absence of these markers proves nothing: screenshots and re-saves strip them.
 */

// Long, specific names only: short tokens would match random bytes in compressed pixel data.
const GENERATOR_PATTERN =
  /OpenAI|DALL[·\-\s]?E\s?[23]?|ChatGPT|GPT-4o|gpt-image|Adobe Firefly|Imagen\s?[234]|Made with Google AI|Google AI|Gemini|Midjourney|Stable Diffusion|StableDiffusion|NovelAI|Microsoft Designer|Bing Image Creator|Image Creator from Microsoft|Meta AI|Ideogram|Leonardo\.Ai|Black Forest Labs|FLUX\.1|Recraft|Krea\.ai|Playground AI/gi;

const SD_PARAMETER_PATTERN = /Steps:\s*\d+[\s\S]*?Sampler:|Negative prompt:|CFG scale:\s*\d|"sampler_name"|"cfg_scale"|"KSampler"/;

const PNG_AI_KEYS = new Set([
  "parameters",
  "prompt",
  "workflow",
  "dream",
  "sd-metadata",
  "invokeai_metadata",
  "generation_data",
  "ai_metadata",
]);

// Output sizes of popular image generators (width x height).
const GENERATOR_SIZES = new Set([
  "512x512", "768x768", "1024x1024", "2048x2048",
  "1024x1536", "1536x1024", "1024x1792", "1792x1024",
  "896x1152", "1152x896", "832x1216", "1216x832", "768x1344", "1344x768", "640x1536", "1536x640",
  "832x1248", "1248x832", "864x1184", "1184x864", "1536x672", "672x1536",
  "1856x2464", "2464x1856", "1792x2400", "2400x1792", "2048x1536", "1536x2048",
]);

function readPngTextChunks(bytes: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  if (bytes.length < 8 || bytes.readUInt32BE(0) !== 0x89504e47) return out;
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("latin1", offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IEND") break;
    try {
      if (type === "tEXt") {
        const sep = data.indexOf(0);
        if (sep > 0) out[data.toString("latin1", 0, sep)] = data.toString("latin1", sep + 1);
      } else if (type === "zTXt") {
        const sep = data.indexOf(0);
        if (sep > 0) out[data.toString("latin1", 0, sep)] = inflateSync(data.subarray(sep + 2)).toString("latin1");
      } else if (type === "iTXt") {
        const sep = data.indexOf(0);
        if (sep <= 0) continue;
        const compressed = data[sep + 1] === 1;
        let p = data.indexOf(0, sep + 3); // end of language tag
        p = data.indexOf(0, p + 1); // end of translated keyword
        const text = data.subarray(p + 1);
        out[data.toString("latin1", 0, sep)] = (compressed ? inflateSync(text) : text).toString("utf8");
      }
    } catch {
      // Corrupt chunk: ignore and keep scanning.
    }
  }
  return out;
}

function readDimensions(bytes: Buffer): { width: number; height: number } | null {
  // PNG: IHDR is always the first chunk.
  if (bytes.length > 24 && bytes.readUInt32BE(0) === 0x89504e47) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  // JPEG: walk segments to the first SOFn marker.
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = bytes[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7) };
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      i += 2 + bytes.readUInt16BE(i + 2);
    }
    return null;
  }
  // WEBP: RIFF....WEBP then VP8 / VP8L / VP8X.
  if (bytes.length > 30 && bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP") {
    const chunk = bytes.toString("latin1", 12, 16);
    if (chunk === "VP8 ") return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
    if (chunk === "VP8L") {
      const b = bytes.readUInt32LE(21);
      return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X") return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
  }
  return null;
}

function addFinding(report: MetadataReport, finding: Finding): void {
  if (!report.findings.some((f) => f.title === finding.title)) report.findings.push(finding);
}

export function scanProvenance(bytes: Buffer, report: MetadataReport): void {
  const { properties } = report;
  const isImage = report.mimeType.startsWith("image/");
  const raw = bytes.toString("latin1");
  let floor = 0;

  // C2PA manifests live in JUMBF boxes labelled "c2pa".
  const hasC2pa = /c2pa/.test(raw) && /jumb|jumd/.test(raw);
  if (hasC2pa) properties.ContentCredentials = "C2PA manifest present";

  const generators = [...new Set((raw.match(GENERATOR_PATTERN) ?? []).map((g) => g.trim()))];
  // In PDFs, only trust generator names that sit inside a provenance manifest; page text may mention them.
  const trustedGenerators = isImage || hasC2pa ? generators : [];

  if (/compositeWithTrainedAlgorithmicMedia/i.test(raw)) {
    properties.DigitalSourceType ??= "compositeWithTrainedAlgorithmicMedia";
    addFinding(report, {
      category: "ai_generation",
      severity: "high",
      title: "Embedded label: edited with generative AI",
      description:
        "The file's provenance data declares it as a composite that includes AI-generated content (IPTC 'compositeWithTrainedAlgorithmicMedia').",
      location: hasC2pa ? "C2PA content credentials" : "XMP/IPTC metadata",
    });
    floor = Math.max(floor, 90);
  } else if (/trainedAlgorithmicMedia/i.test(raw)) {
    properties.DigitalSourceType ??= "trainedAlgorithmicMedia";
    if (!report.findings.some((f) => f.title === "Image declared as AI-generated")) {
      addFinding(report, {
        category: "ai_generation",
        severity: "high",
        title: "Embedded label: AI-generated media",
        description:
          "The file's provenance data declares it as created by a generative AI model (IPTC 'trainedAlgorithmicMedia').",
        location: hasC2pa ? "C2PA content credentials" : "XMP/IPTC metadata",
      });
    }
    floor = Math.max(floor, 97);
  }

  if (trustedGenerators.length > 0) {
    properties.GeneratorMarkers = trustedGenerators.join(", ");
    addFinding(report, {
      category: "ai_generation",
      severity: "high",
      title: hasC2pa ? "Content credentials name an AI generator" : "AI generator named inside the file",
      description: `The file embeds references to ${trustedGenerators.join(", ")}, which identifies the tool that produced it.`,
      location: hasC2pa ? "C2PA content credentials" : "Embedded metadata",
    });
    floor = Math.max(floor, hasC2pa ? 97 : 90);
  } else if (hasC2pa && floor === 0) {
    addFinding(report, {
      category: "metadata",
      severity: "low",
      title: "Content credentials present",
      description:
        "The file carries a C2PA manifest but no AI generator was identified in it. Verify it with a C2PA viewer such as contentcredentials.org/verify.",
      location: "C2PA content credentials",
    });
  }

  if (report.mimeType === "image/png") {
    const chunks = readPngTextChunks(bytes);
    const aiKeys = Object.keys(chunks).filter(
      (k) => PNG_AI_KEYS.has(k.toLowerCase()) || SD_PARAMETER_PATTERN.test(chunks[k]),
    );
    if (aiKeys.length > 0) {
      properties.PngTextChunks = aiKeys.join(", ");
      const sample = chunks[aiKeys[0]].replace(/\s+/g, " ").slice(0, 160);
      addFinding(report, {
        category: "ai_generation",
        severity: "high",
        title: "Image-generator parameters embedded in PNG",
        description: `The PNG contains text chunks (${aiKeys.join(", ")}) of the kind Stable Diffusion tools write, holding the prompt and sampler settings: "${sample}${sample.length === 160 ? "…" : ""}"`,
        location: "PNG text chunks",
      });
      floor = Math.max(floor, 97);
    }
  } else if (isImage && SD_PARAMETER_PATTERN.test(raw)) {
    addFinding(report, {
      category: "ai_generation",
      severity: "high",
      title: "Image-generator parameters embedded in image",
      description: "The image metadata contains prompt and sampler settings written by a Stable Diffusion tool.",
      location: "Image metadata",
    });
    floor = Math.max(floor, 97);
  }

  if (isImage) {
    const dims = readDimensions(bytes);
    if (dims) {
      properties.Dimensions = `${dims.width} × ${dims.height}`;
      const hasCamera = Boolean(properties.Make || properties.Model);
      if (GENERATOR_SIZES.has(`${dims.width}x${dims.height}`) && !hasCamera) {
        addFinding(report, {
          category: "ai_generation",
          severity: "medium",
          title: "Image size matches AI generator output",
          description: `${dims.width} × ${dims.height} is a standard output size of popular image generators (ChatGPT, Gemini, Midjourney, Stable Diffusion), and the image has no camera or scanner information. Phone photos and scans rarely have these exact dimensions.`,
          location: "Image dimensions",
        });
        floor = Math.max(floor, 50);
      }
    }
  }

  report.aiSignalFloor = Math.max(report.aiSignalFloor, floor);
}

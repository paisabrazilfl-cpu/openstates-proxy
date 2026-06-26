#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const DEFAULT_INPUT_DIR = path.join(ROOT_DIR, "transcripts_raw");
const DEFAULT_OUTPUT_FILE = path.join(ROOT_DIR, "data_processed", "debate_transcripts.jsonl");
const TRANSCRIPT_EXTENSIONS = new Set([".srt", ".txt", ".vtt"]);
const TIMESTAMP_LINE = /(?:(?:\d{2}:)?\d{2}:\d{2}[.,]\d{3})\s+-->\s+(?:(?:\d{2}:)?\d{2}:\d{2}[.,]\d{3})/;

function printHelp() {
  console.log(`
Build JSONL transcript chunks from downloaded subtitle files.

Usage:
  node scripts/build-transcript-jsonl.js

Options:
  --input-dir <path>      Directory with .vtt, .srt, or .txt files. Default: transcripts_raw.
  --output <path>         JSONL output path. Default: data_processed/debate_transcripts.jsonl.
  --chunk-size <words>    Words per chunk. Default: 700.
  --chunk-overlap <words> Overlap between chunks. Default: 80.
  --min-words <words>     Skip transcripts shorter than this. Default: 25.
  --help                  Show this help.
`);
}

function readValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function parseNonNegativeInteger(value, flag) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`${flag} must be a non-negative integer.`);
  }
  return number;
}

function parseArgs(argv) {
  const options = {
    inputDir: DEFAULT_INPUT_DIR,
    outputFile: DEFAULT_OUTPUT_FILE,
    chunkSize: 700,
    chunkOverlap: 80,
    minWords: 25,
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--input-dir") {
      options.inputDir = path.resolve(readValue(argv, i, arg));
      i += 1;
    } else if (arg === "--output") {
      options.outputFile = path.resolve(readValue(argv, i, arg));
      i += 1;
    } else if (arg === "--chunk-size") {
      options.chunkSize = parseNonNegativeInteger(readValue(argv, i, arg), arg);
      i += 1;
    } else if (arg === "--chunk-overlap") {
      options.chunkOverlap = parseNonNegativeInteger(readValue(argv, i, arg), arg);
      i += 1;
    } else if (arg === "--min-words") {
      options.minWords = parseNonNegativeInteger(readValue(argv, i, arg), arg);
      i += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (options.chunkSize < 1) {
    throw new Error("--chunk-size must be at least 1.");
  }
  if (options.chunkOverlap >= options.chunkSize) {
    throw new Error("--chunk-overlap must be smaller than --chunk-size.");
  }

  return options;
}

async function walkFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(fullPath));
    } else if (TRANSCRIPT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

function decodeEntities(text) {
  const named = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: "\""
  };

  return text.replace(/&(#x?[0-9a-f]+|\w+);/gi, (match, entity) => {
    const lower = entity.toLowerCase();
    if (Object.hasOwn(named, lower)) return named[lower];

    if (lower.startsWith("#x")) {
      const codePoint = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }

    if (lower.startsWith("#")) {
      const codePoint = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }

    return match;
  });
}

function cleanCaptionLine(line) {
  return decodeEntities(line)
    .replace(/<[^>]+>/g, " ")
    .replace(/\{\\an\d+\}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTranscriptText(raw) {
  const lines = raw.replace(/^\uFEFF/, "").replace(/\r/g, "").split("\n");
  const kept = [];
  let skippingMetadataBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      skippingMetadataBlock = false;
      continue;
    }

    if (/^WEBVTT\b/i.test(trimmed) || /^Kind:/i.test(trimmed) || /^Language:/i.test(trimmed)) {
      continue;
    }

    if (/^(NOTE|STYLE|REGION)\b/i.test(trimmed)) {
      skippingMetadataBlock = true;
      continue;
    }

    if (skippingMetadataBlock || TIMESTAMP_LINE.test(trimmed) || /^\d+$/.test(trimmed)) {
      continue;
    }

    const cleaned = cleanCaptionLine(trimmed);
    if (cleaned && cleaned !== kept.at(-1)) {
      kept.push(cleaned);
    }
  }

  return kept.join(" ").replace(/\s+/g, " ").trim();
}

function chunkWords(text, chunkSize, chunkOverlap) {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks = [];
  const step = chunkSize - chunkOverlap;

  for (let start = 0; start < words.length; start += step) {
    const end = Math.min(start + chunkSize, words.length);
    chunks.push(words.slice(start, end).join(" "));
    if (end === words.length) break;
  }

  return chunks;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findVideoId(filePath) {
  const fileName = path.basename(filePath);
  const match = fileName.match(/(?:^|[_. -])([a-zA-Z0-9_-]{11})(?:\.[a-zA-Z-]+)?\.(?:srt|txt|vtt)$/);
  return match?.[1] || null;
}

function readableTitle(filePath, videoId) {
  let title = path.parse(filePath).name;
  title = title.replace(/\.[a-z]{2}(?:-[a-z]{2})?$/i, "");
  if (videoId) {
    title = title.replace(new RegExp(`[_. -]*${escapeRegExp(videoId)}$`), "");
  }
  return title.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim() || path.basename(path.dirname(filePath));
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || "transcript";
}

function transcriptSignature(text) {
  return crypto
    .createHash("sha256")
    .update(text.toLowerCase().replace(/\s+/g, " ").trim())
    .digest("hex");
}

function isBetterTranscriptCandidate(candidate, existing) {
  if (candidate.wordCount !== existing.wordCount) {
    return candidate.wordCount > existing.wordCount;
  }
  return candidate.file.localeCompare(existing.file) < 0;
}

function selectUniqueTranscriptCandidates(candidates) {
  const selectedByKey = new Map();

  for (const candidate of candidates) {
    const key = candidate.videoId ? `video:${candidate.videoId}` : `text:${candidate.signature}`;
    const existing = selectedByKey.get(key);

    if (!existing || isBetterTranscriptCandidate(candidate, existing)) {
      selectedByKey.set(key, candidate);
    }
  }

  return [...selectedByKey.values()].sort((a, b) => a.file.localeCompare(b.file));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const files = await walkFiles(options.inputDir).catch((error) => {
    if (error.code === "ENOENT") {
      throw new Error(`Transcript input directory does not exist: ${options.inputDir}`);
    }
    throw error;
  });

  if (!files.length) {
    throw new Error(`No transcript files found in ${options.inputDir}`);
  }

  const candidates = [];
  let skippedShort = 0;

  for (const file of files) {
    const raw = await fs.readFile(file, "utf8");
    const text = extractTranscriptText(raw);
    const words = text.split(/\s+/).filter(Boolean);

    if (words.length < options.minWords) {
      skippedShort += 1;
      continue;
    }

    const videoId = findVideoId(file);
    candidates.push({
      file,
      text,
      wordCount: words.length,
      videoId,
      title: readableTitle(file, videoId),
      relativeSource: path.relative(ROOT_DIR, file).replace(/\\/g, "/"),
      signature: transcriptSignature(text)
    });
  }

  const selected = selectUniqueTranscriptCandidates(candidates);
  const skippedDuplicateFiles = candidates.length - selected.length;
  const records = [];

  for (const candidate of selected) {
    const chunks = chunkWords(candidate.text, options.chunkSize, options.chunkOverlap);
    const sourceKey = candidate.videoId || slugify(candidate.relativeSource);

    chunks.forEach((content, index) => {
      records.push({
        id: `${sourceKey}#${index + 1}`,
        type: "youtube_transcript",
        source: candidate.relativeSource,
        title: candidate.title,
        videoId: candidate.videoId,
        sourceUrl: candidate.videoId ? `https://www.youtube.com/watch?v=${candidate.videoId}` : null,
        chunkIndex: index,
        chunkCount: chunks.length,
        wordCount: content.split(/\s+/).filter(Boolean).length,
        content
      });
    });
  }

  await fs.mkdir(path.dirname(options.outputFile), { recursive: true });
  await fs.writeFile(
    options.outputFile,
    records.map((record) => JSON.stringify(record)).join("\n") + "\n",
    "utf8"
  );

  console.log(`Wrote ${records.length} chunks from ${selected.length} transcript files to ${options.outputFile}`);
  if (skippedShort) console.log(`Skipped ${skippedShort} short transcript files.`);
  if (skippedDuplicateFiles) console.log(`Skipped ${skippedDuplicateFiles} duplicate transcript files.`);
}

main().catch((error) => {
  console.error(`[build-transcript-jsonl] ${error.message}`);
  process.exit(1);
});

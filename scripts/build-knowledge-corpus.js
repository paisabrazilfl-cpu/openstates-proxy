#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const DEFAULT_SOURCE_DIR = path.join(ROOT_DIR, "data");
const DEFAULT_TRANSCRIPTS_FILE = path.join(ROOT_DIR, "data_processed", "debate_transcripts.jsonl");
const DEFAULT_OUTPUT_FILE = path.join(ROOT_DIR, "data_processed", "knowledge_corpus.jsonl");

function printHelp() {
  console.log(`
Build the unified chatbot knowledge corpus.

Usage:
  node scripts/build-knowledge-corpus.js

Options:
  --sources-dir <path>   Directory with source .jsonl files. Default: data.
  --transcripts <path>   Debate transcript JSONL file. Default: data_processed/debate_transcripts.jsonl.
  --output <path>        Unified output path. Default: data_processed/knowledge_corpus.jsonl.
  --help                 Show this help.
`);
}

function readValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function parseArgs(argv) {
  const options = {
    sourcesDir: DEFAULT_SOURCE_DIR,
    transcriptsFile: DEFAULT_TRANSCRIPTS_FILE,
    outputFile: DEFAULT_OUTPUT_FILE,
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--sources-dir") {
      options.sourcesDir = path.resolve(readValue(argv, i, arg));
      i += 1;
    } else if (arg === "--transcripts") {
      options.transcriptsFile = path.resolve(readValue(argv, i, arg));
      i += 1;
    } else if (arg === "--output") {
      options.outputFile = path.resolve(readValue(argv, i, arg));
      i += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function listSourceFiles(sourceDir) {
  let entries;
  try {
    entries = await fs.readdir(sourceDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => path.join(sourceDir, entry.name))
    .sort();
}

async function readJsonl(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  const records = [];

  raw.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    try {
      records.push({
        record: JSON.parse(trimmed),
        lineNumber: index + 1
      });
    } catch (error) {
      throw new Error(`${filePath}:${index + 1} is not valid JSON: ${error.message}`);
    }
  });

  return records;
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 90) || "record";
}

function asStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeSourceType(value, fallback) {
  return String(value || fallback || "knowledge")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "knowledge";
}

function relativePath(filePath) {
  return path.relative(ROOT_DIR, filePath).replace(/\\/g, "/");
}

function getText(record) {
  return String(record.text || record.content || record.body || "").replace(/\s+/g, " ").trim();
}

function inferSourceTypeFromFile(filePath) {
  return normalizeSourceType(path.basename(filePath, ".jsonl"), "knowledge");
}

function normalizeKnowledgeRecord(record, filePath, lineNumber) {
  const text = getText(record);
  if (!text) return null;

  const sourceType = normalizeSourceType(record.source_type || record.type, inferSourceTypeFromFile(filePath));
  const title = String(record.title || record.name || sourceType).trim();
  const id = String(record.id || `${sourceType}_${slugify(title)}_${lineNumber}`).trim();

  return {
    id,
    source_type: sourceType,
    title,
    text,
    topic_tags: asStringArray(record.topic_tags || record.tags),
    references: asArray(record.references),
    media: record.media || null,
    source: record.source || relativePath(filePath),
    metadata: {
      ...(record.metadata && typeof record.metadata === "object" ? record.metadata : {}),
      source_file: relativePath(filePath),
      source_line: lineNumber
    }
  };
}

function extractChannelFromSource(source) {
  if (!source) return null;
  const parts = String(source).split(/[\\/]+/).filter(Boolean);
  const channel = parts[0] === "transcripts_raw" ? parts[1] : parts[0];
  return channel ? channel.replace(/#+$/g, "").trim() : null;
}

function normalizeTranscriptRecord(record, filePath, lineNumber) {
  const text = getText(record);
  if (!text) return null;

  const rawId = String(record.id || lineNumber).trim();
  const media = {
    ...(record.media && typeof record.media === "object" ? record.media : {}),
    video_url: record.media?.video_url || record.sourceUrl || record.video_url || null,
    video_id: record.media?.video_id || record.videoId || record.video_id || null,
    channel: record.media?.channel || record.channel || extractChannelFromSource(record.source),
    start_seconds: record.media?.start_seconds ?? record.start_seconds ?? record.startSeconds ?? null
  };

  return {
    id: `debate_transcript_${rawId}_${lineNumber}`,
    source_type: "debate_transcript",
    title: String(record.title || "Debate transcript").trim(),
    text,
    topic_tags: asStringArray(record.topic_tags || record.tags),
    references: asArray(record.references),
    media: media.video_url || media.video_id || media.channel ? media : null,
    source: record.source || relativePath(filePath),
    metadata: {
      source_file: relativePath(filePath),
      source_line: lineNumber,
      chunk_index: record.chunkIndex ?? record.chunk_index ?? null,
      chunk_count: record.chunkCount ?? record.chunk_count ?? null,
      word_count: record.wordCount ?? record.word_count ?? null
    }
  };
}

function assertUniqueIds(records) {
  const seen = new Map();
  for (const record of records) {
    if (seen.has(record.id)) {
      throw new Error(`Duplicate knowledge record id '${record.id}' from ${record.source}; first seen in ${seen.get(record.id)}.`);
    }
    seen.set(record.id, record.source);
  }
}

async function writeCorpusFiles(outputFile, records) {
  const content = records.map((record) => JSON.stringify(record)).join("\n") + "\n";
  const gzipFile = outputFile.endsWith(".gz") ? outputFile : `${outputFile}.gz`;

  await fs.mkdir(path.dirname(outputFile), { recursive: true });
  await fs.writeFile(outputFile, content, "utf8");
  await fs.writeFile(gzipFile, zlib.gzipSync(content, { level: 9 }));

  return { outputFile, gzipFile };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const records = [];
  const sourceFiles = await listSourceFiles(options.sourcesDir);

  for (const file of sourceFiles) {
    const parsed = await readJsonl(file);
    for (const { record, lineNumber } of parsed) {
      const normalized = normalizeKnowledgeRecord(record, file, lineNumber);
      if (normalized) records.push(normalized);
    }
  }

  if (await fileExists(options.transcriptsFile)) {
    const parsed = await readJsonl(options.transcriptsFile);
    for (const { record, lineNumber } of parsed) {
      const normalized = normalizeTranscriptRecord(record, options.transcriptsFile, lineNumber);
      if (normalized) records.push(normalized);
    }
  }

  if (!records.length) {
    throw new Error("No knowledge records found. Add JSONL files under data/ or build transcript JSONL first.");
  }

  assertUniqueIds(records);

  const { outputFile, gzipFile } = await writeCorpusFiles(options.outputFile, records);

  console.log(`Wrote ${records.length} knowledge records to ${outputFile}`);
  console.log(`Wrote compressed corpus to ${gzipFile}`);
  console.log(`Included ${sourceFiles.length} source JSONL file(s).`);
  if (!(await fileExists(options.transcriptsFile))) {
    console.log(`Transcript file not found, so transcripts were skipped: ${options.transcriptsFile}`);
  }
}

main().catch((error) => {
  console.error(`[build-knowledge-corpus] ${error.message}`);
  process.exit(1);
});

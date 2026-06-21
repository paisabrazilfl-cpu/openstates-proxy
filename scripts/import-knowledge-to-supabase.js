#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fetch from "node-fetch";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const DEFAULT_INPUT_FILE = path.join(ROOT_DIR, "data_processed", "knowledge_corpus.jsonl");
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_KEY = process.env.SUPABASE_KEY || SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_TABLE = process.env.SUPABASE_TABLE || "knowledge_documents";

function printHelp() {
  console.log(`
Import the local knowledge corpus into Supabase.

Usage:
  node scripts/import-knowledge-to-supabase.js

Options:
  --input <path>       JSONL corpus file. Default: data_processed/knowledge_corpus.jsonl.
  --batch-size <n>     Records per Supabase upsert. Default: 500.
  --help               Show this help.

Environment:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  SUPABASE_TABLE        Optional. Default: knowledge_documents.
`);
}

function readValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function parsePositiveInteger(value, flag) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return number;
}

function parseArgs(argv) {
  const options = {
    inputFile: DEFAULT_INPUT_FILE,
    batchSize: 500,
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--input") {
      options.inputFile = path.resolve(readValue(argv, i, arg));
      i += 1;
    } else if (arg === "--batch-size") {
      options.batchSize = parsePositiveInteger(readValue(argv, i, arg), arg);
      i += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

async function readJsonl(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
    .filter(({ line }) => line)
    .map(({ line, lineNumber }) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${filePath}:${lineNumber} is not valid JSON: ${error.message}`);
      }
    });
}

function normalizeForSupabase(record) {
  const content = String(record.text || record.content || "").trim();
  if (!content) return null;

  return {
    id: String(record.id),
    source_type: String(record.source_type || record.type || "knowledge"),
    title: String(record.title || record.source_type || "Knowledge"),
    content,
    topic_tags: Array.isArray(record.topic_tags) ? record.topic_tags.map(String) : [],
    references: Array.isArray(record.references) ? record.references : [],
    media: record.media || null,
    source: record.source || null,
    metadata: record.metadata && typeof record.metadata === "object" ? record.metadata : {}
  };
}

async function upsertBatch(records) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${encodeURIComponent(SUPABASE_TABLE)}?on_conflict=id`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates"
    },
    body: JSON.stringify(records)
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase upsert failed (${response.status}): ${body}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }

  const records = (await readJsonl(options.inputFile))
    .map(normalizeForSupabase)
    .filter(Boolean);

  if (!records.length) {
    throw new Error(`No importable records found in ${options.inputFile}`);
  }

  for (let index = 0; index < records.length; index += options.batchSize) {
    const batch = records.slice(index, index + options.batchSize);
    await upsertBatch(batch);
    console.log(`Imported ${Math.min(index + batch.length, records.length)} / ${records.length}`);
  }

  console.log(`Imported ${records.length} records into Supabase table '${SUPABASE_TABLE}'.`);
}

main().catch((error) => {
  console.error(`[import-knowledge-to-supabase] ${error.message}`);
  process.exit(1);
});

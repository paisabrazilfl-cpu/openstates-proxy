#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import readline from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const DEFAULT_INPUT_FILE = path.join(ROOT_DIR, "data_processed", "knowledge_corpus.jsonl");
const HOSTINGER_DB_HOST = process.env.HOSTINGER_DB_HOST || process.env.MYSQL_HOST || "";
const HOSTINGER_DB_PORT = Number(process.env.HOSTINGER_DB_PORT || process.env.MYSQL_PORT || 3306);
const HOSTINGER_DB_USER = process.env.HOSTINGER_DB_USER || process.env.MYSQL_USER || "";
const HOSTINGER_DB_PASSWORD = process.env.HOSTINGER_DB_PASSWORD || process.env.MYSQL_PASSWORD || "";
const HOSTINGER_DB_NAME = process.env.HOSTINGER_DB_NAME || process.env.MYSQL_DATABASE || "";
const HOSTINGER_TABLE = process.env.HOSTINGER_TABLE || process.env.MYSQL_TABLE || "knowledge_documents";
const HOSTINGER_DB_SSL = String(process.env.HOSTINGER_DB_SSL || process.env.MYSQL_SSL || "").toLowerCase() === "true";

function printHelp() {
  console.log(`
Import the local knowledge corpus into a Hostinger MySQL/MariaDB database.

Usage:
  node scripts/import-knowledge-to-hostinger.js

Options:
  --input <path>                 JSONL corpus file. Default: data_processed/knowledge_corpus.jsonl.
  --batch-size <n>               Records per database upsert. Default: 100.
  --replace                      Clear the target table before importing. Use only for generated knowledge data.
  --allow-duplicate-content      Import exact duplicate records instead of skipping them.
  --help                         Show this help.

Environment:
  HOSTINGER_DB_HOST
  HOSTINGER_DB_PORT       Optional. Default: 3306.
  HOSTINGER_DB_USER
  HOSTINGER_DB_PASSWORD
  HOSTINGER_DB_NAME
  HOSTINGER_TABLE         Optional. Default: knowledge_documents.
  HOSTINGER_DB_SSL        Optional. Set true if your database requires SSL.
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
    batchSize: 100,
    replace: false,
    allowDuplicateContent: false,
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
    } else if (arg === "--replace") {
      options.replace = true;
    } else if (arg === "--allow-duplicate-content") {
      options.allowDuplicateContent = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function quoteMysqlIdentifier(value, label) {
  if (!/^[a-zA-Z0-9_]+$/.test(value)) {
    throw new Error(`${label} may only contain letters, numbers, and underscores.`);
  }
  return `\`${value}\``;
}

function assertConfig() {
  const missing = [];
  if (!HOSTINGER_DB_HOST) missing.push("HOSTINGER_DB_HOST");
  if (!HOSTINGER_DB_USER) missing.push("HOSTINGER_DB_USER");
  if (!HOSTINGER_DB_NAME) missing.push("HOSTINGER_DB_NAME");

  if (missing.length) {
    throw new Error(`${missing.join(", ")} are required.`);
  }
}

function normalizeContentForFingerprint(content) {
  return content.toLowerCase().replace(/\s+/g, " ").trim();
}

function contentFingerprint(record) {
  return crypto
    .createHash("sha256")
    .update([
      record.source_type,
      record.title,
      record.media_json || "",
      normalizeContentForFingerprint(record.content)
    ].join("\n"))
    .digest("hex");
}

function normalizeForHostinger(record) {
  const content = String(record.text || record.content || "").trim();
  if (!content) return null;

  return {
    id: String(record.id).slice(0, 255),
    source_type: String(record.source_type || record.type || "knowledge").slice(0, 100),
    title: String(record.title || record.source_type || "Knowledge").slice(0, 500),
    content,
    topic_tags: JSON.stringify(Array.isArray(record.topic_tags) ? record.topic_tags.map(String) : []),
    references_json: JSON.stringify(Array.isArray(record.references) ? record.references : []),
    media_json: record.media ? JSON.stringify(record.media) : null,
    source: record.source ? String(record.source).slice(0, 1000) : null,
    metadata_json: JSON.stringify(record.metadata && typeof record.metadata === "object" ? record.metadata : {})
  };
}

async function createPool() {
  assertConfig();

  return mysql.createPool({
    host: HOSTINGER_DB_HOST,
    port: HOSTINGER_DB_PORT,
    user: HOSTINGER_DB_USER,
    password: HOSTINGER_DB_PASSWORD,
    database: HOSTINGER_DB_NAME,
    charset: "utf8mb4",
    waitForConnections: true,
    connectionLimit: 4,
    queueLimit: 0,
    ssl: HOSTINGER_DB_SSL ? { rejectUnauthorized: false } : undefined
  });
}

async function upsertBatch(pool, table, records) {
  if (!records.length) return;

  const columns = [
    "id",
    "source_type",
    "title",
    "content",
    "topic_tags",
    "references_json",
    "media_json",
    "source",
    "metadata_json"
  ];
  const placeholders = records.map(() => `(${columns.map(() => "?").join(", ")})`).join(", ");
  const values = records.flatMap((record) => columns.map((column) => record[column]));

  const sql = `
    insert into ${table} (${columns.map((column) => quoteMysqlIdentifier(column, column)).join(", ")})
    values ${placeholders}
    on duplicate key update
      source_type = values(source_type),
      title = values(title),
      content = values(content),
      topic_tags = values(topic_tags),
      references_json = values(references_json),
      media_json = values(media_json),
      source = values(source),
      metadata_json = values(metadata_json),
      updated_at = current_timestamp
  `;

  await pool.execute(sql, values);
}

async function importJsonl(pool, options) {
  const table = quoteMysqlIdentifier(HOSTINGER_TABLE, "HOSTINGER_TABLE");
  const stream = fs.createReadStream(options.inputFile, { encoding: "utf8" });
  const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });

  if (options.replace) {
    await pool.execute(`truncate table ${table}`);
    console.log(`Cleared Hostinger table '${HOSTINGER_TABLE}' before import.`);
  }

  const seenContent = new Set();
  let batch = [];
  let lineNumber = 0;
  let imported = 0;
  let skippedEmpty = 0;
  let skippedDuplicates = 0;

  for await (const line of reader) {
    lineNumber += 1;
    const trimmed = line.trim();
    if (!trimmed) continue;

    let record;
    try {
      record = JSON.parse(trimmed);
    } catch (error) {
      throw new Error(`${options.inputFile}:${lineNumber} is not valid JSON: ${error.message}`);
    }

    const normalized = normalizeForHostinger(record);
    if (!normalized) {
      skippedEmpty += 1;
      continue;
    }

    if (!options.allowDuplicateContent) {
      const fingerprint = contentFingerprint(normalized);
      if (seenContent.has(fingerprint)) {
        skippedDuplicates += 1;
        continue;
      }
      seenContent.add(fingerprint);
    }

    batch.push(normalized);
    if (batch.length >= options.batchSize) {
      await upsertBatch(pool, table, batch);
      imported += batch.length;
      console.log(`Imported ${imported} records...`);
      batch = [];
    }
  }

  if (batch.length) {
    await upsertBatch(pool, table, batch);
    imported += batch.length;
  }

  console.log(`Imported ${imported} records into Hostinger table '${HOSTINGER_TABLE}'.`);
  if (skippedEmpty) console.log(`Skipped ${skippedEmpty} empty records.`);
  if (skippedDuplicates) console.log(`Skipped ${skippedDuplicates} duplicate records.`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const pool = await createPool();
  try {
    await importJsonl(pool, options);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`[import-knowledge-to-hostinger] ${error.message}`);
  process.exit(1);
});

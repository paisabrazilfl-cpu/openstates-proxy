import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import mysql from "mysql2/promise";
import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const app = express();
const PORT = process.env.PORT || 3000;
const MODEL_PROVIDER = process.env.MODEL_PROVIDER || (process.env.GROQ_API_KEY ? "groq" : (process.env.OPENAI_COMPATIBLE_BASE_URL ? "openai-compatible" : "ollama"));
const OLLAMA_BASE_URL = (process.env.OLLAMA_BASE_URL || "http://localhost:11434").replace(/\/$/, "");
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen3:4b";
const GROQ_BASE_URL = (process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, "");
const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.1-8b-instant";
const OPENAI_COMPATIBLE_BASE_URL = (process.env.OPENAI_COMPATIBLE_BASE_URL || "").replace(/\/$/, "");
const OPENAI_COMPATIBLE_API_KEY = process.env.OPENAI_COMPATIBLE_API_KEY || "";
const OPENAI_COMPATIBLE_MODEL = process.env.OPENAI_COMPATIBLE_MODEL || "";
const MAX_CONTEXT_CHUNKS = Number(process.env.MAX_CONTEXT_CHUNKS || 8);
const MAX_CONTEXT_CHUNK_CHARS = Number(process.env.MAX_CONTEXT_CHUNK_CHARS || 850);
const MAX_CHUNKS_PER_VIDEO = Number(process.env.MAX_CHUNKS_PER_VIDEO || 2);
const MAX_RETRIEVAL_CANDIDATES = Number(process.env.MAX_RETRIEVAL_CANDIDATES || 80);
const MAX_MODEL_TOKENS = Number(process.env.MAX_MODEL_TOKENS || 650);
const MAX_QUESTION_CHARS = Number(process.env.MAX_QUESTION_CHARS || 1200);
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const SUPABASE_KEY = process.env.SUPABASE_KEY || SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
const SUPABASE_TABLE = process.env.SUPABASE_TABLE || "knowledge_documents";
const SUPABASE_MATCH_FUNCTION = process.env.SUPABASE_MATCH_FUNCTION || "match_knowledge_documents";
const HOSTINGER_DB_HOST = process.env.HOSTINGER_DB_HOST || process.env.MYSQL_HOST || "";
const HOSTINGER_DB_PORT = Number(process.env.HOSTINGER_DB_PORT || process.env.MYSQL_PORT || 3306);
const HOSTINGER_DB_USER = process.env.HOSTINGER_DB_USER || process.env.MYSQL_USER || "";
const HOSTINGER_DB_PASSWORD = process.env.HOSTINGER_DB_PASSWORD || process.env.MYSQL_PASSWORD || "";
const HOSTINGER_DB_NAME = process.env.HOSTINGER_DB_NAME || process.env.MYSQL_DATABASE || "";
const HOSTINGER_TABLE = process.env.HOSTINGER_TABLE || process.env.MYSQL_TABLE || "knowledge_documents";
const HOSTINGER_DB_SSL = String(process.env.HOSTINGER_DB_SSL || process.env.MYSQL_SSL || "").toLowerCase() === "true";
const HAS_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_KEY);
const HAS_HOSTINGER_DB = Boolean(HOSTINGER_DB_HOST && HOSTINGER_DB_USER && HOSTINGER_DB_NAME);
const KNOWLEDGE_SOURCE = process.env.KNOWLEDGE_SOURCE || (HAS_SUPABASE ? "supabase" : (HAS_HOSTINGER_DB ? "hostinger" : "file"));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const gunzip = promisify(zlib.gunzip);
const KNOWLEDGE_CORPUS_FILE = process.env.KNOWLEDGE_CORPUS_FILE
  ? path.resolve(process.env.KNOWLEDGE_CORPUS_FILE)
  : path.join(__dirname, "data_processed", "knowledge_corpus.jsonl");
let loadedKnowledgeCorpusFile = KNOWLEDGE_CORPUS_FILE;

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const STOP_WORDS = new Set([
  "about", "after", "again", "against", "also", "and", "are", "because", "been", "before", "being", "between",
  "but", "can", "could", "did", "does", "doing", "for", "from", "had", "has", "have", "how", "into", "is", "it",
  "its", "more", "most", "not", "of", "on", "only", "or", "our", "out", "over", "should", "such", "than", "that",
  "the", "their", "them", "then", "there", "these", "they", "this", "those", "through", "to", "under", "until", "use",
  "was", "were", "what", "when", "where", "which", "while", "who", "why", "will", "with", "would", "you", "your"
]);

const SOURCE_TYPE_PRIORITY = new Map([
  ["debate_card", 1000],
  ["topic_note", 800],
  ["quran", 700],
  ["hadith", 700],
  ["lecture", 500],
  ["debate_transcript", 250]
]);

let fileChunksPromise;
let hostingerPool;

function tokenize(text) {
  return (text.toLowerCase().match(/[a-z0-9:'-]{3,}/g) || []).filter((token) => !STOP_WORDS.has(token));
}

function mentionsAishaAgeTopic(normalized) {
  return /\b(ai?sha|ayesha)\b/.test(normalized) &&
    /(age|marry|married|marriage|nine|\b9\b|six|\b6\b|young|child|consummat|betro)/.test(normalized);
}

function expandSearchQuery(question) {
  const normalized = String(question || "").toLowerCase();
  const additions = [];

  if (/\bdilema\b/.test(normalized)) {
    additions.push("dilemma");
  }

  if (normalized.includes("islamic dilemma") || normalized.includes("islamic dilema")) {
    additions.push(
      "islamic dilemma",
      "quran bible previous scriptures",
      "torah injeel gospel",
      "corruption preservation tahrif",
      "christian apologetics contradiction"
    );
  }

  if (mentionsAishaAgeTopic(normalized)) {
    additions.push(
      "age of aisha",
      "aisha six nine woman",
      "aisha married consummated",
      "betrothal consummation",
      "mental physical maturity",
      "marriage criteria standard not age",
      "not based off six and nine"
    );
  }

  if (normalized.includes("trinity")) {
    additions.push("tawheed shirk monotheism father son holy spirit");
  }

  if (normalized.includes("crucifixion") || normalized.includes("crucified")) {
    additions.push("isa jesus cross substitution raised allah");
  }

  return [question, ...additions].filter(Boolean).join(" ");
}

function getPrioritySearchPhrases(question) {
  const normalized = String(question || "").toLowerCase();
  const phrases = [];

  if (normalized.includes("islamic dilemma") || normalized.includes("islamic dilema")) {
    phrases.push("islamic dilemma", "islamic dilema");
  }

  if (mentionsAishaAgeTopic(normalized)) {
    phrases.push(
      "age of aisha",
      "aisha ra",
      "she was six and nine",
      "not based off of six and nine",
      "mentally and physically mature",
      "mental and physical maturity",
      "standard is not age",
      "marriage criteria"
    );
  }

  return [...new Set(phrases)];
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

function displayPath(filePath) {
  return path.relative(__dirname, filePath).replace(/\\/g, "/") || filePath;
}

function isHostingerSource() {
  return KNOWLEDGE_SOURCE === "hostinger" || KNOWLEDGE_SOURCE === "mysql";
}

function quoteMysqlIdentifier(value, label) {
  if (!/^[a-zA-Z0-9_]+$/.test(value)) {
    throw new Error(`${label} may only contain letters, numbers, and underscores.`);
  }
  return `\`${value}\``;
}

function getHostingerTableSql() {
  return quoteMysqlIdentifier(HOSTINGER_TABLE, "HOSTINGER_TABLE");
}

function getHostingerPool() {
  const missing = [];
  if (!HOSTINGER_DB_HOST) missing.push("HOSTINGER_DB_HOST");
  if (!HOSTINGER_DB_USER) missing.push("HOSTINGER_DB_USER");
  if (!HOSTINGER_DB_NAME) missing.push("HOSTINGER_DB_NAME");

  if (missing.length) {
    throw new Error(`${missing.join(", ")} are required when KNOWLEDGE_SOURCE=hostinger.`);
  }

  if (!hostingerPool) {
    hostingerPool = mysql.createPool({
      host: HOSTINGER_DB_HOST,
      port: HOSTINGER_DB_PORT,
      user: HOSTINGER_DB_USER,
      password: HOSTINGER_DB_PASSWORD,
      database: HOSTINGER_DB_NAME,
      charset: "utf8mb4",
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0,
      ssl: HOSTINGER_DB_SSL ? { rejectUnauthorized: false } : undefined
    });
  }

  return hostingerPool;
}

function parseJsonValue(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return value;
}

function normalizeHostingerRecord(record, location) {
  return normalizeKnowledgeRecord({
    id: record.id,
    source_type: record.source_type,
    title: record.title,
    content: record.content,
    topic_tags: parseJsonValue(record.topic_tags, []),
    references: parseJsonValue(record.references_json ?? record.references, []),
    media: parseJsonValue(record.media_json ?? record.media, null),
    source: record.source,
    metadata: parseJsonValue(record.metadata_json ?? record.metadata, {}),
    score: record.score
  }, location);
}

function getSupabaseHeaders(extra = {}) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required when KNOWLEDGE_SOURCE=supabase.");
  }

  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    ...extra
  };
}

async function readKnowledgeCorpusFile() {
  const candidates = process.env.KNOWLEDGE_CORPUS_FILE
    ? [KNOWLEDGE_CORPUS_FILE]
    : [`${KNOWLEDGE_CORPUS_FILE}.gz`, KNOWLEDGE_CORPUS_FILE];
  const readErrors = [];

  for (const candidate of candidates) {
    if (!(await fileExists(candidate))) continue;

    try {
      const buffer = await fs.readFile(candidate);
      const content = candidate.endsWith(".gz")
        ? (await gunzip(buffer)).toString("utf8")
        : buffer.toString("utf8");

      if (!content.trim()) {
        throw new Error("file is empty");
      }

      loadedKnowledgeCorpusFile = candidate;
      return { content, filePath: candidate };
    } catch (error) {
      readErrors.push(`${displayPath(candidate)}: ${error.message}`);
    }
  }

  const details = readErrors.length ? ` Problems: ${readErrors.join("; ")}.` : "";
  throw new Error(
    `Knowledge corpus not found or unreadable. Looked for: ${candidates.map(displayPath).join(", ")}.` +
    `${details} Run 'npm run knowledge:build' before starting the chatbot.`
  );
}

function normalizeKnowledgeRecord(record, location) {
  const text = String(record.text || record.content || "").trim();
  if (!text) {
    throw new Error(`${location} is missing text/content.`);
  }

  const sourceType = String(record.source_type || record.type || "knowledge");
  const title = String(record.title || sourceType);

  return {
    id: String(record.id || location),
    source: String(record.source || sourceType),
    sourceType,
    title,
    content: text,
    topicTags: Array.isArray(record.topic_tags) ? record.topic_tags : [],
    references: Array.isArray(record.references) ? record.references : [],
    media: record.media || null,
    metadata: record.metadata || {},
    score: Number(record.score || 0),
    tokens: tokenize(`${title} ${text}`)
  };
}

function getSourceTypePriority(sourceType) {
  return SOURCE_TYPE_PRIORITY.get(String(sourceType || "").toLowerCase()) || 0;
}

function duplicateChunkKey(chunk) {
  const mediaKey = chunk.media?.video_id || chunk.media?.video_url || chunk.source || chunk.title;
  const textKey = chunk.content.toLowerCase().replace(/\s+/g, " ").trim();
  return `${chunk.sourceType}:${mediaKey}:${textKey}`;
}

function getChunkVideoKey(chunk) {
  if (chunk.media?.video_id) return `video:${chunk.media.video_id}`;
  if (chunk.media?.video_url) return `video_url:${chunk.media.video_url}`;

  const source = String(chunk.source || "");
  const videoId = source.match(/[a-zA-Z0-9_-]{11}/)?.[0];
  if (videoId) return `video:${videoId}`;

  return `record:${chunk.source || chunk.title || chunk.id}`;
}

function getChunkChannelKey(chunk) {
  if (chunk.media?.channel) return `channel:${String(chunk.media.channel).toLowerCase()}`;

  const parts = String(chunk.source || "").split(/[\\/]+/).filter(Boolean);
  if (parts[0] === "transcripts_raw" && parts[1]) return `channel:${parts[1].toLowerCase()}`;
  if (parts[0]) return `source:${parts[0].toLowerCase()}`;

  return getChunkVideoKey(chunk);
}

function boostChunkScore(chunk, boost = 0) {
  return {
    ...chunk,
    score: Number(chunk.score || 0) + boost + getSourceTypePriority(chunk.sourceType)
  };
}

function addDiverseChunk({ chunk, selected, selectedIds, seenContent, videoCounts, channelCounts }) {
  if (selectedIds.has(chunk.id)) return false;

  const contentKey = duplicateChunkKey(chunk);
  if (seenContent.has(contentKey)) return false;

  const videoKey = getChunkVideoKey(chunk);
  const currentVideoCount = videoCounts.get(videoKey) || 0;
  if (currentVideoCount >= MAX_CHUNKS_PER_VIDEO) return false;

  selected.push(chunk);
  selectedIds.add(chunk.id);
  seenContent.add(contentKey);
  videoCounts.set(videoKey, currentVideoCount + 1);

  const channelKey = getChunkChannelKey(chunk);
  channelCounts.set(channelKey, (channelCounts.get(channelKey) || 0) + 1);
  return true;
}

function selectDiverseChunks(ranked, limit) {
  const selected = [];
  const selectedIds = new Set();
  const seenContent = new Set();
  const videoCounts = new Map();
  const channelCounts = new Map();
  const add = (chunk) => addDiverseChunk({ chunk, selected, selectedIds, seenContent, videoCounts, channelCounts });

  for (const chunk of ranked) {
    if (selected.length >= limit) break;
    if (channelCounts.has(getChunkChannelKey(chunk))) continue;
    add(chunk);
  }

  for (const chunk of ranked) {
    if (selected.length >= limit) break;
    if (videoCounts.has(getChunkVideoKey(chunk))) continue;
    add(chunk);
  }

  for (const chunk of ranked) {
    if (selected.length >= limit) break;
    add(chunk);
  }

  return selected;
}

function mergeRankedChunks(chunks, limit = MAX_CONTEXT_CHUNKS) {
  const bestById = new Map();

  for (const chunk of chunks) {
    const existing = bestById.get(chunk.id);
    if (!existing || chunk.score > existing.score) {
      bestById.set(chunk.id, chunk);
    }
  }

  const ranked = [...bestById.values()].sort((a, b) => b.score - a.score);
  return selectDiverseChunks(ranked, limit);
}

function compactWhitespace(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function trimSnippet(text, start, maxChars) {
  const compact = compactWhitespace(text);
  if (compact.length <= maxChars) return compact;

  const safeStart = Math.max(0, Math.min(start, compact.length - maxChars));
  const snippet = compact.slice(safeStart, safeStart + maxChars).trim();
  return `${safeStart > 0 ? "... " : ""}${snippet}${safeStart + maxChars < compact.length ? " ..." : ""}`;
}

function buildFocusedSnippet(text, question) {
  const compact = compactWhitespace(text);
  if (compact.length <= MAX_CONTEXT_CHUNK_CHARS) return compact;

  const lowered = compact.toLowerCase();
  const phrases = getPrioritySearchPhrases(question).map((phrase) => phrase.toLowerCase());
  const tokens = tokenize(expandSearchQuery(question));
  const searchTerms = [...phrases, ...tokens].filter((term) => term.length >= 4);

  let bestIndex = -1;
  for (const term of searchTerms) {
    const found = lowered.indexOf(term);
    if (found !== -1 && (bestIndex === -1 || found < bestIndex)) {
      bestIndex = found;
    }
  }

  const start = bestIndex === -1 ? 0 : bestIndex - Math.floor(MAX_CONTEXT_CHUNK_CHARS / 3);
  return trimSnippet(compact, start, MAX_CONTEXT_CHUNK_CHARS);
}

async function loadKnowledgeBaseFromFile() {
  const { content, filePath } = await readKnowledgeCorpusFile();

  return content
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
    .filter(({ line }) => line)
    .map(({ line, lineNumber }) => {
      let record;
      try {
        record = JSON.parse(line);
      } catch (error) {
        throw new Error(`${displayPath(filePath)}:${lineNumber} is not valid JSON: ${error.message}`);
      }

      return normalizeKnowledgeRecord(record, `${displayPath(filePath)}:${lineNumber}`);
    });
}

async function getFileChunks() {
  if (!fileChunksPromise) fileChunksPromise = loadKnowledgeBaseFromFile();

  try {
    return await fileChunksPromise;
  } catch (error) {
    fileChunksPromise = null;
    throw error;
  }
}

function retrieveRelevantFileChunks(question, chunks) {
  const searchText = expandSearchQuery(question);
  const questionTokens = tokenize(searchText);
  const questionSet = new Set(questionTokens);

  return mergeRankedChunks(chunks
    .map((chunk) => {
      const overlap = chunk.tokens.filter((token) => questionSet.has(token)).length;
      const phraseBoost = questionTokens.some((token) => chunk.content.toLowerCase().includes(token)) ? 1 : 0;
      return boostChunkScore(chunk, overlap + phraseBoost);
    })
    .filter((chunk) => chunk.score > getSourceTypePriority(chunk.sourceType)));
}

async function retrieveRelevantSupabaseChunks(question) {
  const searchText = expandSearchQuery(question);
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${encodeURIComponent(SUPABASE_MATCH_FUNCTION)}`, {
    method: "POST",
    headers: getSupabaseHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      query_text: searchText,
      match_count: Math.max(1, Math.min(MAX_RETRIEVAL_CANDIDATES, 100))
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Supabase knowledge search failed (${response.status}): ${body}. ` +
      `Run SUPABASE_SETUP.sql in Supabase and confirm the '${SUPABASE_MATCH_FUNCTION}' function exists.`
    );
  }

  const records = await response.json();
  return mergeRankedChunks(records.map((record, index) => (
    boostChunkScore(normalizeKnowledgeRecord(record, `${SUPABASE_MATCH_FUNCTION}:${index + 1}`))
  )));
}

async function retrieveRelevantHostingerChunks(question) {
  const limit = Math.max(1, Math.min(MAX_CONTEXT_CHUNKS, 20));
  const searchLimit = Math.max(limit * 8, MAX_RETRIEVAL_CANDIDATES);
  const pool = getHostingerPool();
  const table = getHostingerTableSql();
  const searchText = expandSearchQuery(question);
  const selectColumns = "id, source_type, title, content, topic_tags, references_json, media_json, source, metadata_json";
  const candidates = [];

  for (const phrase of getPrioritySearchPhrases(question)) {
    const likeValue = `%${phrase}%`;
    const [phraseRows] = await pool.execute(
      `select ${selectColumns}, 100 as score from ${table}
       where title like ? or content like ?
       limit ${searchLimit}`,
      [likeValue, likeValue]
    );

    candidates.push(...phraseRows.map((record, index) => (
      boostChunkScore(normalizeHostingerRecord(record, `hostinger:${HOSTINGER_TABLE}:phrase:${index + 1}`), 100)
    )));
  }

  const [rows] = await pool.execute(
    `select ${selectColumns}, match(title, content) against (? in natural language mode) as score
     from ${table}
     where match(title, content) against (? in natural language mode)
     order by score desc
     limit ${searchLimit}`,
    [searchText, searchText]
  );

  candidates.push(...rows.map((record, index) => (
    boostChunkScore(normalizeHostingerRecord(record, `hostinger:${HOSTINGER_TABLE}:${index + 1}`))
  )));

  const fallbackTokens = tokenize(searchText).slice(0, 12);
  if (fallbackTokens.length) {
    const conditions = fallbackTokens.map(() => "(lower(title) like ? or lower(content) like ?)").join(" or ");
    const params = fallbackTokens.flatMap((token) => [`%${token.toLowerCase()}%`, `%${token.toLowerCase()}%`]);
    const [fallbackRows] = await pool.execute(
      `select ${selectColumns}, 1 as score from ${table} where ${conditions} limit ${searchLimit}`,
      params
    );

    candidates.push(...fallbackRows.map((record, index) => (
      boostChunkScore(normalizeHostingerRecord(record, `hostinger:${HOSTINGER_TABLE}:fallback:${index + 1}`), 1)
    )));
  }

  return mergeRankedChunks(candidates, limit);
}

async function retrieveContextChunks(question) {
  if (KNOWLEDGE_SOURCE === "supabase") return retrieveRelevantSupabaseChunks(question);
  if (isHostingerSource()) return retrieveRelevantHostingerChunks(question);
  if (KNOWLEDGE_SOURCE === "file") {
    const chunks = await getFileChunks();
    return retrieveRelevantFileChunks(question, chunks);
  }
  throw new Error(`Unsupported KNOWLEDGE_SOURCE '${KNOWLEDGE_SOURCE}'. Use 'file', 'supabase', or 'hostinger'.`);
}

async function checkKnowledgeStatus() {
  if (KNOWLEDGE_SOURCE === "supabase") {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${encodeURIComponent(SUPABASE_TABLE)}?select=id&limit=1`, {
      headers: getSupabaseHeaders()
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Supabase health check failed (${response.status}): ${body}`);
    }

    const rows = await response.json();
    return {
      corpus: `supabase:${SUPABASE_TABLE}`,
      searchMode: SUPABASE_MATCH_FUNCTION,
      recordsAvailable: rows.length > 0,
      chunks: null
    };
  }

  if (isHostingerSource()) {
    const [rows] = await getHostingerPool().execute(`select id from ${getHostingerTableSql()} limit 1`);
    return {
      corpus: `hostinger:${HOSTINGER_DB_NAME}.${HOSTINGER_TABLE}`,
      searchMode: "mysql_fulltext",
      recordsAvailable: rows.length > 0,
      chunks: null
    };
  }

  if (KNOWLEDGE_SOURCE === "file") {
    const chunks = await getFileChunks();
    return {
      corpus: displayPath(loadedKnowledgeCorpusFile),
      searchMode: "local_memory",
      recordsAvailable: chunks.length > 0,
      chunks: chunks.length
    };
  }

  throw new Error(`Unsupported KNOWLEDGE_SOURCE '${KNOWLEDGE_SOURCE}'. Use 'file', 'supabase', or 'hostinger'.`);
}

function currentCorpusDescription() {
  if (KNOWLEDGE_SOURCE === "supabase") return `supabase:${SUPABASE_TABLE}`;
  if (isHostingerSource()) return `hostinger:${HOSTINGER_DB_NAME || "database"}.${HOSTINGER_TABLE}`;
  return displayPath(loadedKnowledgeCorpusFile);
}

function formatContextChunk(chunk, index, question) {
  const referenceText = chunk.references.length
    ? `\nReference details for accuracy: ${JSON.stringify(chunk.references)}`
    : "";
  const snippet = buildFocusedSnippet(chunk.content, question);

  return `Argument note ${index + 1}:\n${snippet}${referenceText}`;
}

function buildPrompt(question, contextChunks) {
  const context = contextChunks
    .map((chunk, index) => formatContextChunk(chunk, index, question))
    .join("\n\n---\n\n");

  return `You are a Muslim dawah debate assistant. Respond directly to the user's question or objection as if you are in a respectful live conversation.

Rules:
- Answer with adab, humility, confidence, and honesty.
- Speak to the user directly. Do not sound like you are summarizing documents.
- Use the argument notes silently. Never mention "context", "provided context", "retrieved material", "knowledge base", "transcript", "chunk", "source", or "Muslim debater".
- Only answer questions about Islam, Christianity, religion, dawah, comparative religion, or related religious history/philosophy.
- If the user asks about unrelated topics, politely say this chatbot is focused on Islam, Christianity, religion, and dawah, and invite them to ask a relevant question.
- Use ONLY the argument notes for religious factual claims.
- If the notes are not enough, say the answer needs more precise evidence and invite the user to ask a more specific follow-up.
- Do not invent Quran verses, hadith, Bible references, scholars, or citations.
- Do not insult Christians, Jews, atheists, Hindus, Muslims, or any person/group.
- If the user raises an objection, state the concern fairly in one sentence, then respond clearly.
- For named polemical arguments like "Islamic dilemma", explain the strongest common version of the claim before answering it.
- For fatwa, marriage/divorce, abuse, mental health, violence, or sectarian takfir topics, avoid issuing rulings and recommend qualified help.
- Use Quran and hadith references only when they appear in the argument notes.
- If the argument notes conflict, prefer the earlier/higher ranked notes.
- When several notes give different useful arguments on the same topic, combine the distinct arguments into one organized answer instead of relying on only the first note.
- Do not show a retrieved sources section.
- End with a short invitation for a follow-up question.

Argument notes for you only:
${context || "No relevant argument notes were found."}

User question:
${question}

Direct debate-style answer:`;
}

function cleanGeneratedAnswer(answer) {
  return answer
    .replace(/^\s*based on (the )?(provided )?(context|material|information|notes|transcripts)[,\s:-]*/i, "")
    .replace(/^\s*from (the )?(provided )?(context|material|information|notes|transcripts)[,\s:-]*/i, "")
    .replace(/\bthe provided context\b/gi, "the argument")
    .replace(/\bthe retrieved (context|material|sources?)\b/gi, "the argument")
    .replace(/\b(in|from) (one of )?(the )?transcripts?,?\s*/gi, "")
    .replace(/\bMuslim debaters?\s+(state|states|said|say|argue|argues|mention|mentions)\b/gi, "I would answer")
    .trim();
}

function buildFallbackAnswer(contextChunks) {
  if (!contextChunks.length) {
    return "I need better matching material in the knowledge base before I answer that confidently. Try asking with a few more keywords, or add a debate card for this topic.";
  }

  return "I found relevant material, but the model did not return an answer. Please try again or rephrase the question.";
}

function buildRelatedVideos(contextChunks) {
  const seen = new Set();
  const videos = [];

  for (const chunk of contextChunks) {
    const url = chunk.media?.video_url;
    if (!url || seen.has(url)) continue;

    seen.add(url);
    videos.push({
      title: chunk.title,
      url,
      channel: chunk.media?.channel || null,
      start_seconds: chunk.media?.start_seconds ?? null
    });
  }

  return videos.slice(0, 5);
}

function buildDebugChunks(contextChunks) {
  return contextChunks.map((chunk, index) => ({
    rank: index + 1,
    id: chunk.id,
    title: chunk.title,
    sourceType: chunk.sourceType,
    score: Number.isFinite(chunk.score) ? chunk.score : 0,
    content: chunk.content.slice(0, 1400),
    references: chunk.references,
    videoUrl: chunk.media?.video_url || null,
    channel: chunk.media?.channel || null,
    startSeconds: chunk.media?.start_seconds ?? null
  }));
}

function extractOllamaText(data) {
  return (data.message?.content || data.response || "").trim();
}

function getModelName() {
  if (MODEL_PROVIDER === "groq") return GROQ_MODEL;
  return MODEL_PROVIDER === "openai-compatible" ? OPENAI_COMPATIBLE_MODEL : OLLAMA_MODEL;
}

function getProviderHint() {
  if (isHostingerSource()) {
    return "Check Hostinger database credentials, remote MySQL access, and whether Render is allowed to connect to the database host.";
  }

  if (MODEL_PROVIDER === "groq") {
    return "Check GROQ_API_KEY, GROQ_MODEL, and your Groq account limits.";
  }

  if (MODEL_PROVIDER === "openai-compatible") {
    return "Check OPENAI_COMPATIBLE_BASE_URL, OPENAI_COMPATIBLE_MODEL, and OPENAI_COMPATIBLE_API_KEY for your cloud model provider.";
  }

  return `Make sure Ollama is reachable at ${OLLAMA_BASE_URL} and the model '${OLLAMA_MODEL}' is pulled. If this app is on Render, set OLLAMA_BASE_URL to a public Ollama-compatible server URL or run Ollama inside the deployed service.`;
}

async function postToOllama(pathname, body) {
  let response;

  try {
    response = await fetch(`${OLLAMA_BASE_URL}${pathname}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch (error) {
    throw new Error(
      `Could not reach Ollama at ${OLLAMA_BASE_URL}${pathname}. ` +
      `If this is deployed on Render, localhost means the Render server, not your computer. ` +
      `Set OLLAMA_BASE_URL to a public Ollama-compatible server URL or run Ollama inside the deployed service. ` +
      `Original error: ${error.message}`
    );
  }

  if (!response.ok) {
    const responseBody = await response.text();
    if (response.status === 404 && responseBody.toLowerCase().includes("model")) {
      throw new Error(
        `Ollama model '${OLLAMA_MODEL}' was not found. ` +
        `Run 'ollama pull ${OLLAMA_MODEL}' on the same machine/server that is running Ollama. ` +
        `Original response: ${responseBody}`
      );
    }
    throw new Error(`Ollama request failed (${response.status}): ${responseBody}`);
  }

  return response.json();
}

async function callChatCompletions({ baseUrl, apiKey, model, prompt, providerName }) {
  if (!baseUrl || !model) {
    throw new Error(`${providerName} requires a base URL and model name.`);
  }

  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  let response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: MAX_MODEL_TOKENS
      })
    });
  } catch (error) {
    throw new Error(
      `Could not reach ${providerName} model API at ${baseUrl}/chat/completions. ` +
      `Check the provider base URL and API key. Original error: ${error.message}`
    );
  }

  if (!response.ok) {
    const responseBody = await response.text();
    throw new Error(`${providerName} model request failed (${response.status}): ${responseBody}`);
  }

  const data = await response.json();
  return (data.choices?.[0]?.message?.content || data.choices?.[0]?.text || "").trim();
}

async function callGroq(prompt) {
  if (!GROQ_API_KEY) throw new Error("GROQ_API_KEY is required when MODEL_PROVIDER=groq.");
  return callChatCompletions({
    baseUrl: GROQ_BASE_URL,
    apiKey: GROQ_API_KEY,
    model: GROQ_MODEL,
    prompt,
    providerName: "Groq"
  });
}

async function callOpenAICompatible(prompt) {
  if (!OPENAI_COMPATIBLE_BASE_URL || !OPENAI_COMPATIBLE_MODEL) {
    throw new Error(
      "OPENAI_COMPATIBLE_BASE_URL and OPENAI_COMPATIBLE_MODEL are required when MODEL_PROVIDER=openai-compatible."
    );
  }

  return callChatCompletions({
    baseUrl: OPENAI_COMPATIBLE_BASE_URL,
    apiKey: OPENAI_COMPATIBLE_API_KEY,
    model: OPENAI_COMPATIBLE_MODEL,
    prompt,
    providerName: "OpenAI-compatible"
  });
}

async function callOllama(prompt) {
  const chatData = await postToOllama("/api/chat", {
    model: OLLAMA_MODEL,
    messages: [{
      role: "user", content: `${prompt}

/no_think

Write the final answer now. Do not return an empty response.` }],
    stream: false,
    options: {
      temperature: 0.2,
      num_predict: MAX_MODEL_TOKENS
    }
  });

  const chatText = extractOllamaText(chatData);
  if (chatText) return chatText;

  const generateData = await postToOllama("/api/generate", {
    model: OLLAMA_MODEL,
    prompt: `${prompt}

/no_think

Write the final answer now. Do not return an empty response.`,
    stream: false,
    options: {
      temperature: 0.2,
      num_predict: MAX_MODEL_TOKENS
    }
  });

  return extractOllamaText(generateData);
}

async function callModel(prompt) {
  if (MODEL_PROVIDER === "groq") return callGroq(prompt);
  if (MODEL_PROVIDER === "openai-compatible") return callOpenAICompatible(prompt);
  if (MODEL_PROVIDER === "ollama") return callOllama(prompt);
  throw new Error(`Unsupported MODEL_PROVIDER '${MODEL_PROVIDER}'. Use 'ollama', 'groq', or 'openai-compatible'.`);
}

app.get("/health", async (req, res) => {
  try {
    const knowledge = await checkKnowledgeStatus();
    res.json({
      status: "ok",
      service: "ai-dawah-chatbot",
      provider: MODEL_PROVIDER,
      model: getModelName(),
      knowledgeSource: KNOWLEDGE_SOURCE,
      ...knowledge
    });
  } catch (error) {
    res.status(503).json({
      status: "error",
      service: "ai-dawah-chatbot",
      provider: MODEL_PROVIDER,
      model: getModelName(),
      knowledgeSource: KNOWLEDGE_SOURCE,
      corpus: currentCorpusDescription(),
      error: error.message
    });
  }
});

app.post("/chat", async (req, res) => {
  try {
    const question = String(req.body?.question || "").trim();
    if (!question) return res.status(400).json({ error: "Question is required." });
    if (question.length > MAX_QUESTION_CHARS) {
      return res.status(400).json({ error: `Question is too long. Limit is ${MAX_QUESTION_CHARS} characters.` });
    }

    const contextChunks = await retrieveContextChunks(question);
    if (!contextChunks.length) {
      return res.json({
        answer: buildFallbackAnswer(contextChunks),
        model: getModelName(),
        relatedVideos: [],
        debugChunks: []
      });
    }

    const prompt = buildPrompt(question, contextChunks);
    const generatedAnswer = cleanGeneratedAnswer(await callModel(prompt));
    const answer = generatedAnswer || buildFallbackAnswer(contextChunks);

    res.json({
      answer,
      model: getModelName(),
      relatedVideos: buildRelatedVideos(contextChunks),
      debugChunks: buildDebugChunks(contextChunks)
    });
  } catch (error) {
    res.status(503).json({
      error: error.message,
      hint: getProviderHint()
    });
  }
});

app.listen(PORT, () => {
  console.log(`AI dawah chatbot listening on port ${PORT}`);
  if (MODEL_PROVIDER === "groq") {
    console.log(`Using Groq model ${GROQ_MODEL} at ${GROQ_BASE_URL}`);
  } else if (MODEL_PROVIDER === "openai-compatible") {
    console.log(`Using OpenAI-compatible model ${OPENAI_COMPATIBLE_MODEL} at ${OPENAI_COMPATIBLE_BASE_URL}`);
  } else {
    console.log(`Using Ollama model ${OLLAMA_MODEL} at ${OLLAMA_BASE_URL}`);
  }
});

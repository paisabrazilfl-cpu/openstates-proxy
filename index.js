import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const PORT = process.env.PORT || 3000;
const OLLAMA_BASE_URL = (process.env.OLLAMA_BASE_URL || "http://localhost:11434").replace(/\/$/, "");
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen3:4b";
const MAX_CONTEXT_CHUNKS = Number(process.env.MAX_CONTEXT_CHUNKS || 5);
const MAX_QUESTION_CHARS = Number(process.env.MAX_QUESTION_CHARS || 1200);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");

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

let chunksPromise;

function tokenize(text) {
  return (text.toLowerCase().match(/[a-z0-9:'-]{3,}/g) || []).filter((token) => !STOP_WORDS.has(token));
}

function splitMarkdownIntoChunks(source, text) {
  const sections = text
    .split(/\n(?=#{1,3}\s+)/g)
    .map((section) => section.trim())
    .filter(Boolean);

  return sections.map((content, index) => {
    const titleMatch = content.match(/^#{1,3}\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : `${source} section ${index + 1}`;
    return {
      id: `${source}#${index + 1}`,
      source,
      title,
      content,
      tokens: tokenize(content)
    };
  });
}

async function loadKnowledgeBase() {
  const files = await fs.readdir(DATA_DIR);
  const markdownFiles = files.filter((file) => file.endsWith(".md")).sort();
  const allChunks = [];

  for (const file of markdownFiles) {
    const content = await fs.readFile(path.join(DATA_DIR, file), "utf8");
    allChunks.push(...splitMarkdownIntoChunks(file, content));
  }

  return allChunks;
}

async function getChunks() {
  if (!chunksPromise) chunksPromise = loadKnowledgeBase();
  return chunksPromise;
}

function retrieveRelevantChunks(question, chunks) {
  const questionTokens = tokenize(question);
  const questionSet = new Set(questionTokens);

  return chunks
    .map((chunk) => {
      const overlap = chunk.tokens.filter((token) => questionSet.has(token)).length;
      const phraseBoost = questionTokens.some((token) => chunk.content.toLowerCase().includes(token)) ? 1 : 0;
      return { ...chunk, score: overlap + phraseBoost };
    })
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CONTEXT_CHUNKS);
}

function buildPrompt(question, contextChunks) {
  const context = contextChunks
    .map((chunk, index) => `[${index + 1}] Source: ${chunk.source} | ${chunk.title}\n${chunk.content}`)
    .join("\n\n---\n\n");

  return `You are a respectful Islamic educational assistant for dawah conversations.

Rules:
- Answer with adab, humility, and honesty.
- Use ONLY the provided context for religious factual claims.
- If the context is not enough, say what is missing and suggest asking a qualified scholar or adding better sources.
- Do not invent Quran verses, hadith, Bible references, scholars, or citations.
- Do not insult Christians, Jews, atheists, Hindus, Muslims, or any person/group.
- If debating, summarize the concern fairly before responding.
- For fatwa, marriage/divorce, abuse, mental health, violence, or sectarian takfir topics, avoid issuing rulings and recommend qualified help.
- End with a short invitation for a follow-up question.

Context:
${context || "No relevant local context was found."}

User question:
${question}

Answer with brief citations like [1], [2] that refer to the context above.`;
}

function buildFallbackAnswer(contextChunks) {
  if (!contextChunks.length) {
    return "I could not get a model answer, and I did not find relevant local sources. Please add more knowledge-base documents or rephrase the question.";
  }

  const sourceList = contextChunks
    .map((chunk, index) => `[${index + 1}] ${chunk.title} (${chunk.source})\n${chunk.content}`)
    .join("\n\n");

  return `I could not get a generated model answer, but I found relevant local source material. Please review these sources:\n\n${sourceList}`;
}

function extractOllamaText(data) {
  return (data.message?.content || data.response || "").trim();
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
      num_predict: 700
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
      num_predict: 700
    }
  });

  return extractOllamaText(generateData);
}

app.get("/health", async (req, res) => {
  const chunks = await getChunks();
  res.json({ status: "ok", service: "ai-dawah-chatbot", model: OLLAMA_MODEL, chunks: chunks.length });
});

app.post("/chat", async (req, res) => {
  try {
    const question = String(req.body?.question || "").trim();
    if (!question) return res.status(400).json({ error: "Question is required." });
    if (question.length > MAX_QUESTION_CHARS) {
      return res.status(400).json({ error: `Question is too long. Limit is ${MAX_QUESTION_CHARS} characters.` });
    }

    const chunks = await getChunks();
    const sources = retrieveRelevantChunks(question, chunks);
    const prompt = buildPrompt(question, sources);
    const generatedAnswer = (await callOllama(prompt)).trim();
    const answer = generatedAnswer || buildFallbackAnswer(sources);

    res.json({
      answer,
      model: OLLAMA_MODEL,
      sources: sources.map(({ id, source, title, score, content }) => ({
        id,
        source,
        title,
        score,
        excerpt: content.length > 700 ? `${content.slice(0, 700)}...` : content
      }))
    });
  } catch (error) {
    res.status(503).json({
      error: error.message,
      hint: `Make sure Ollama is reachable at ${OLLAMA_BASE_URL} and the model '${OLLAMA_MODEL}' is pulled. If this app is on Render, set OLLAMA_BASE_URL to an external HTTPS model endpoint or deploy Ollama with the app.`
    });
  }
});

app.listen(PORT, () => {
  console.log(`AI dawah chatbot listening on port ${PORT}`);
  console.log(`Using Ollama model ${OLLAMA_MODEL} at ${OLLAMA_BASE_URL}`);
});
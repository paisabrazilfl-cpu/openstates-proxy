import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 3000;
const OPENSTATES_API_KEY = process.env.OPENSTATES_API_KEY;

app.use(cors());

app.get("/", (req, res) => {
  res.json({ status: "ok", service: "openstates-proxy" });
});

app.get("/bills", async (req, res) => {
  try {
    if (!OPENSTATES_API_KEY) {
      return res.status(500).json({ error: "OPENSTATES_API_KEY not configured" });
    }

    const params = new URLSearchParams();
    if (req.query.q) params.set("q", req.query.q);
    if (req.query.jurisdiction) params.set("jurisdiction", req.query.jurisdiction);
    if (req.query.sort) params.set("sort", req.query.sort);
    else params.set("sort", "-updated_at");
    if (req.query.per_page) params.set("per_page", req.query.per_page);
    else params.set("per_page", "25");

    const url = "https://v3.openstates.org/bills?" + params.toString();

    const resp = await fetch(url, {
      headers: {
        "X-API-KEY": OPENSTATES_API_KEY,
        "Accept": "application/json"
      }
    });

    const text = await resp.text();
    let json;
    try { json = JSON.parse(text); } catch (e) {
      return res.status(resp.status).send(text);
    }

    res.status(resp.status).json(json);
  } catch (err) {
    res.status(500).json({ error: err.message || "Unknown error" });
  }
});

app.listen(PORT, () => {
  console.log("OpenStates proxy listening on port", PORT);
});

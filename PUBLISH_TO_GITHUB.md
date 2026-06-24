# Publish the chatbot files to GitHub

The chatbot files may exist in this coding workspace before they appear on GitHub. If the GitHub repository still shows only `index.js` and `package.json`, the changes have not been pushed to GitHub yet.

## What should be in the repository

The chatbot version should contain these paths:

```text
.gitignore
README.md
index.js
package.json
data/notes.jsonl
public/index.html
HOSTINGER_SETUP.sql
SUPABASE_SETUP.sql
scripts/build-knowledge-corpus.js
scripts/build-transcript-jsonl.js
scripts/download-transcripts.js
scripts/import-knowledge-to-hostinger.js
scripts/import-knowledge-to-supabase.js
```

Generated files under `data_processed/` should stay local. For large data, import the corpus into Hostinger instead of committing it to GitHub.

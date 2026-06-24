# Transcript Ingestion

This repo can pull YouTube subtitles with `yt-dlp`, convert them into transcript JSONL chunks, and then merge them into the chatbot knowledge corpus.

Only use videos and transcripts that you have permission to download and use.

## Install yt-dlp

Install one of these on Windows:

```powershell
winget install yt-dlp.yt-dlp
```

or:

```powershell
pip install -U yt-dlp
```

## Download From a Channel

Use the channel videos URL, not just the channel name:

```powershell
npm run transcripts:download -- --channel-url "https://www.youtube.com/@CHANNEL_HANDLE/videos"
```

For a large channel, test the first 10 videos before running the whole channel:

```powershell
npm run transcripts:download -- --channel-url "https://www.youtube.com/@CHANNEL_HANDLE/videos" --playlist-end 10
```

Then run the full channel when the output looks right:

```powershell
npm run transcripts:download -- --channel-url "https://www.youtube.com/@CHANNEL_HANDLE/videos"
```

## Download From a Playlist

```powershell
npm run transcripts:download -- --channel-url "https://www.youtube.com/playlist?list=PLAYLIST_ID" --playlist-end 10
```

`--playlist-url` also works as an alias for `--channel-url`.

## Download From videos.txt

You can still keep a manual list of videos:

```text
https://www.youtube.com/watch?v=VIDEO_ID_1
https://www.youtube.com/watch?v=VIDEO_ID_2
```

Then run:

```powershell
npm run transcripts:download
```

## Build The Corpus

After subtitles are downloaded, build transcript chunks and the unified chatbot corpus:

```powershell
npm run knowledge:refresh
```

That creates:

```text
data_processed/debate_transcripts.jsonl
data_processed/knowledge_corpus.jsonl
data_processed/knowledge_corpus.jsonl.gz
```

For a large corpus, do not commit these generated files. Import the corpus into Hostinger instead.

## Hostinger DB + Render

Use Hostinger MySQL/MariaDB when the chatbot data is too large to keep in GitHub or Render memory.

1. Create a MySQL database in Hostinger.
2. Open phpMyAdmin or Hostinger's SQL tool.
3. Run all SQL from:

```text
HOSTINGER_SETUP.sql
```

4. Build the local corpus:

```powershell
npm run knowledge:refresh
```

5. Set your local Hostinger database env vars:

```powershell
$env:HOSTINGER_DB_HOST="YOUR_HOSTINGER_DB_HOST"
$env:HOSTINGER_DB_PORT="3306"
$env:HOSTINGER_DB_USER="YOUR_DB_USER"
$env:HOSTINGER_DB_PASSWORD="YOUR_DB_PASSWORD"
$env:HOSTINGER_DB_NAME="YOUR_DB_NAME"
```

6. Import the corpus into Hostinger:

```powershell
npm run knowledge:import:hostinger
```

7. In Render, set these environment variables:

```text
KNOWLEDGE_SOURCE=hostinger
HOSTINGER_DB_HOST=YOUR_HOSTINGER_DB_HOST
HOSTINGER_DB_PORT=3306
HOSTINGER_DB_USER=YOUR_DB_USER
HOSTINGER_DB_PASSWORD=YOUR_DB_PASSWORD
HOSTINGER_DB_NAME=YOUR_DB_NAME
```

The app asks Hostinger for only the top matching records per question. Render does not load the whole corpus into memory when `KNOWLEDGE_SOURCE=hostinger`.

Keep the database password server-side only. Do not put it in browser JavaScript or commit it to GitHub.

Important: Render must be allowed to connect to the Hostinger database remotely. If Hostinger blocks remote MySQL connections on your plan, either enable remote MySQL access in Hostinger, whitelist the needed host/IP if your plan supports it, or run the app on a Hostinger VPS instead.

## Updating The Knowledge Base Later

After downloading more transcripts or editing any `data/*.jsonl` file:

```powershell
npm run knowledge:refresh
npm run knowledge:import:hostinger
```

Then Render will use the updated Hostinger data without needing to push the large corpus file to GitHub.

## Adding Quran, Hadith, Lectures, or Notes

Add source JSONL files under:

```text
data/
```

For example:

```text
data/quran.jsonl
data/hadith.jsonl
data/lectures.jsonl
data/notes.jsonl
```

Each line should be one searchable record:

```json
{"id":"note_example","source_type":"topic_note","title":"Example title","text":"The searchable text goes here.","topic_tags":["example"],"references":[],"media":null}
```

For video or lecture records, include media metadata so the app can show related videos later:

```json
{"id":"lecture_example_1","source_type":"lecture","title":"Lecture title","text":"Transcript or notes chunk.","topic_tags":["tawheed"],"references":[],"media":{"video_url":"https://www.youtube.com/watch?v=VIDEO_ID","channel":"Channel name","start_seconds":120}}
```

## Direct Node Commands

If you do not want to use npm, run the scripts directly:

```powershell
node scripts/download-transcripts.js --channel-url "https://www.youtube.com/@CHANNEL_HANDLE/videos" --playlist-end 10
node scripts/build-transcript-jsonl.js
node scripts/build-knowledge-corpus.js
node scripts/import-knowledge-to-hostinger.js
```

## Supabase Alternative

Supabase is still supported as an alternative with:

```text
SUPABASE_SETUP.sql
scripts/import-knowledge-to-supabase.js
KNOWLEDGE_SOURCE=supabase
```

But for your current setup, Hostinger is the main database target.

## Useful Options

```text
--output-dir <path>       Change where raw subtitles are saved.
--videos-file <path>      Use a video URL list other than videos.txt.
--languages <value>       Change yt-dlp subtitle language selection.
--manual-only             Skip auto-generated subtitles.
--auto-only               Skip manually provided subtitles.
--chunk-size <words>      Change JSONL chunk size.
--chunk-overlap <words>   Change JSONL chunk overlap.
```

## Troubleshooting

If `yt-dlp` is not found, install it or pass the full path:

```powershell
node scripts/download-transcripts.js --yt-dlp "C:\path\to\yt-dlp.exe" --channel-url "https://www.youtube.com/@CHANNEL_HANDLE/videos"
```

If a channel gives no subtitles, try `--auto-only`. Some videos do not have usable captions.

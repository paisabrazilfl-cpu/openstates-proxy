# Transcript Ingestion

This repo can pull YouTube subtitles with `yt-dlp`, convert them into transcript JSONL chunks, and then merge them into the single chatbot knowledge corpus.

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

For a small Render-only test, the app can read `data_processed/knowledge_corpus.jsonl.gz`.

For a large corpus, use Supabase instead. Do not commit `transcripts_raw/`, `data_processed/debate_transcripts.jsonl`, or the large plain `data_processed/knowledge_corpus.jsonl` file.

## Supabase + Render

Use Supabase when the chatbot data is too large or changes too often to keep pushing generated files to GitHub.

1. Create a Supabase project.
2. Open the Supabase SQL editor.
3. Run all SQL from:

```text
SUPABASE_SETUP.sql
```

4. Build the local corpus:

```powershell
npm run knowledge:refresh
```

5. Set your local Supabase env vars:

```powershell
$env:SUPABASE_URL="https://YOUR_PROJECT.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY"
```

6. Import the corpus into Supabase:

```powershell
npm run knowledge:import
```

7. In Render, set these environment variables:

```text
KNOWLEDGE_SOURCE=supabase
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
```

The app asks Supabase for only the top matching records per question. Render does not load the whole corpus into memory when `KNOWLEDGE_SOURCE=supabase`.

The service role key must stay server-side in Render. Do not put it in browser JavaScript.

## Updating The Knowledge Base Later

After downloading more transcripts or editing any `data/*.jsonl` file:

```powershell
npm run knowledge:refresh
npm run knowledge:import
```

Then Render will use the updated Supabase data without needing to push the large corpus file to GitHub.

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
node scripts/import-knowledge-to-supabase.js
```

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

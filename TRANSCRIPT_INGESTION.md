# Transcript Ingestion

This repo can pull YouTube subtitles with `yt-dlp` and convert them into JSONL chunks for retrieval or later import work.

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

## Build JSONL

After subtitles are downloaded, build the transcript chunks:

```powershell
npm run transcripts:build
```

The generated file is:

```text
data_processed/debate_transcripts.jsonl
```

Raw subtitles are saved under:

```text
transcripts_raw/
```

Both generated folders are ignored by Git so you do not accidentally commit large transcript dumps.

## Direct Node Commands

If you do not want to use npm, run the scripts directly:

```powershell
node scripts/download-transcripts.js --channel-url "https://www.youtube.com/@CHANNEL_HANDLE/videos" --playlist-end 10
node scripts/build-transcript-jsonl.js
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

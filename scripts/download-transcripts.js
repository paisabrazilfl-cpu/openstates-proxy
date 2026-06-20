#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const DEFAULT_VIDEO_LIST = path.join(ROOT_DIR, "videos.txt");
const DEFAULT_OUTPUT_DIR = path.join(ROOT_DIR, "transcripts_raw");

function printHelp() {
  console.log(`
Download YouTube subtitles with yt-dlp.

Usage:
  node scripts/download-transcripts.js
  node scripts/download-transcripts.js --channel-url "https://www.youtube.com/@CHANNEL_HANDLE/videos"
  node scripts/download-transcripts.js --channel-url "https://www.youtube.com/@CHANNEL_HANDLE/videos" --playlist-end 10

Options:
  --channel-url <url>    YouTube channel videos URL or playlist URL.
  --playlist-url <url>   Alias for --channel-url.
  --playlist-start <n>   Start at item n when using a channel or playlist.
  --playlist-end <n>     Stop at item n when using a channel or playlist.
  --videos-file <path>   File with one video URL per line. Default: videos.txt.
  --output-dir <path>    Directory for downloaded subtitle files. Default: transcripts_raw.
  --languages <value>    yt-dlp subtitle languages. Default: en.*,en.
  --sub-format <value>   yt-dlp subtitle format. Default: vtt/srt/best.
  --yt-dlp <path>        yt-dlp executable name or path. Default: yt-dlp.
  --manual-only          Download manually provided subtitles only.
  --auto-only            Download auto-generated subtitles only.
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

function parsePositiveInteger(value, flag) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return number;
}

function parseArgs(argv) {
  const options = {
    channelUrl: "",
    videoList: DEFAULT_VIDEO_LIST,
    outputDir: DEFAULT_OUTPUT_DIR,
    playlistStart: null,
    playlistEnd: null,
    languages: "en.*,en",
    subFormat: "vtt/srt/best",
    ytDlp: process.env.YT_DLP_BIN || "yt-dlp",
    subtitleMode: "both",
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--channel-url" || arg === "--playlist-url") {
      options.channelUrl = readValue(argv, i, arg);
      i += 1;
    } else if (arg === "--playlist-start") {
      options.playlistStart = parsePositiveInteger(readValue(argv, i, arg), arg);
      i += 1;
    } else if (arg === "--playlist-end") {
      options.playlistEnd = parsePositiveInteger(readValue(argv, i, arg), arg);
      i += 1;
    } else if (arg === "--videos-file") {
      options.videoList = path.resolve(readValue(argv, i, arg));
      i += 1;
    } else if (arg === "--output-dir") {
      options.outputDir = path.resolve(readValue(argv, i, arg));
      i += 1;
    } else if (arg === "--languages" || arg === "--lang") {
      options.languages = readValue(argv, i, arg);
      i += 1;
    } else if (arg === "--sub-format") {
      options.subFormat = readValue(argv, i, arg);
      i += 1;
    } else if (arg === "--yt-dlp") {
      options.ytDlp = readValue(argv, i, arg);
      i += 1;
    } else if (arg === "--manual-only") {
      options.subtitleMode = "manual";
    } else if (arg === "--auto-only") {
      options.subtitleMode = "auto";
    } else if (!arg.startsWith("--") && !options.channelUrl) {
      options.channelUrl = arg;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (options.playlistStart && options.playlistEnd && options.playlistStart > options.playlistEnd) {
    throw new Error("--playlist-start cannot be greater than --playlist-end.");
  }

  return options;
}

async function assertVideoListExists(videoList) {
  let content;
  try {
    content = await fs.readFile(videoList, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(
        `No --channel-url was provided, and ${videoList} does not exist. ` +
        "Create videos.txt with one YouTube URL per line, or pass --channel-url."
      );
    }
    throw error;
  }

  const urls = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  if (!urls.length) {
    throw new Error(`${videoList} does not contain any video URLs.`);
  }
}

function buildYtDlpArgs(options) {
  const outputTemplate = path.join(
    options.outputDir,
    "%(uploader)s",
    "%(upload_date)s_%(title).160B_%(id)s.%(ext)s"
  );

  const args = [
    "--skip-download",
    "--ignore-errors",
    "--no-overwrites",
    "--windows-filenames",
    "--trim-filenames",
    "180",
    "--sub-langs",
    options.languages,
    "--sub-format",
    options.subFormat,
    "--output",
    outputTemplate
  ];

  if (options.subtitleMode !== "auto") args.push("--write-subs");
  if (options.subtitleMode !== "manual") args.push("--write-auto-subs");
  if (options.playlistStart) args.push("--playlist-start", String(options.playlistStart));
  if (options.playlistEnd) args.push("--playlist-end", String(options.playlistEnd));

  if (options.channelUrl) {
    args.push("--yes-playlist", options.channelUrl);
  } else {
    args.push("--batch-file", options.videoList);
  }

  return args;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  await fs.mkdir(options.outputDir, { recursive: true });
  if (!options.channelUrl) {
    await assertVideoListExists(options.videoList);
  }

  const args = buildYtDlpArgs(options);
  const result = spawnSync(options.ytDlp, args, { stdio: "inherit" });

  if (result.error) {
    if (result.error.code === "ENOENT") {
      throw new Error(
        `Could not find '${options.ytDlp}'. Install yt-dlp or pass --yt-dlp with the full executable path.`
      );
    }
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

main().catch((error) => {
  console.error(`[download-transcripts] ${error.message}`);
  process.exit(1);
});

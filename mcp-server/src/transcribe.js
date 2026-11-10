// Speech to text with whisper.cpp, run locally in the container: no outside API, no key.
// ffmpeg turns any audio or video into 16 kHz mono WAV, whisper-cli writes JSON with offsets.
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const WHISPER_BIN = process.env.WHISPER_BIN || 'whisper-cli';
const WHISPER_MODEL = process.env.WHISPER_MODEL || '/models/ggml-base.en.bin';
const WHISPER_LANG = process.env.WHISPER_LANG || 'en';
const MAX_SECONDS = Number(process.env.TRANSCRIBE_MAX_SECONDS || 1800);

let queue = Promise.resolve(); // one transcription at a time: whisper uses every CPU

export function transcribe(audio) {
  const job = queue.then(() => doTranscribe(audio));
  queue = job.catch(() => {});
  return job;
}

async function doTranscribe(audio) {
  const dir = await mkdtemp(path.join(tmpdir(), 'tr-'));
  try {
    const input = path.join(dir, 'input'), wav = path.join(dir, 'audio.wav'), out = path.join(dir, 'out');
    await writeFile(input, audio);
    await run('ffmpeg', ['-nostdin', '-v', 'error', '-i', input, '-t', String(MAX_SECONDS), '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav], { timeout: 120_000 });
    const { stdout: dur } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', wav]);
    const threads = String(Math.max(1, Number(process.env.WHISPER_THREADS || 0) || (await import('node:os')).availableParallelism()));
    await run(WHISPER_BIN, ['-m', WHISPER_MODEL, '-f', wav, '-l', WHISPER_LANG, '-t', threads, '-oj', '-of', out, '-np'], { timeout: 900_000, maxBuffer: 64 * 1024 * 1024 });
    const json = JSON.parse(await readFile(out + '.json', 'utf8'));
    const segments = (json.transcription || [])
      .map((s) => ({
        start: round(s.offsets.from / 1000),
        end: round(s.offsets.to / 1000),
        text: String(s.text).trim(),
      }))
      .filter((s) => s.text && !/^\[(BLANK_AUDIO|MUSIC|SILENCE)\]$/i.test(s.text));
    return { segments, duration: round(Number(dur) || 0), language: json.result?.language || WHISPER_LANG };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const round = (n) => Math.round(n * 100) / 100;

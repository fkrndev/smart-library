import { PATH_MAP, TtsSession, download, stored } from "@mintplex-labs/piper-tts-web";

/**
 * Piper TTS integration, running fully inside the webview via WASM + ONNX
 * Runtime Web. Voice models are downloaded once from HuggingFace and cached
 * in OPFS, so subsequent use works offline.
 *
 * Indonesian voice quirk: `id_ID-news_tts-medium` is hosted on the canonical
 * `rhasspy/piper-voices` repo but NOT on the `diffusionstudio/piper-voices`
 * mirror that this package points to. The storage layer caches blobs by
 * filename only, so we can register the voice in PATH_MAP and seed OPFS with
 * files fetched from the rhasspy repo — `getBlob()` then resolves the model
 * from cache and never touches the mirror.
 */

export const INDONESIAN_VOICE = "id_ID-news_tts-medium";
const RHASSPY_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main";
const INDONESIAN_PATH = "id/id_ID/news_tts/medium/id_ID-news_tts-medium.onnx";

// Register the Indonesian voice so PATH_MAP lookups succeed and stored()
// reports it correctly. If the entry is missing from PATH_MAP the session
// init fails before it ever reaches the OPFS cache.
(PATH_MAP as Record<string, string>)[INDONESIAN_VOICE] = INDONESIAN_PATH;

export interface TtsVoice {
  id: string;
  label: string;
  lang: "id" | "en";
}

export const TTS_VOICES: TtsVoice[] = [
  { id: INDONESIAN_VOICE, label: "Indonesia · Berita (perempuan)", lang: "id" },
  { id: "en_US-lessac-medium", label: "English US · Lessac (perempuan)", lang: "en" },
  { id: "en_US-ryan-medium", label: "English US · Ryan (laki-laki)", lang: "en" },
  { id: "en_GB-alba-medium", label: "English UK · Alba (perempuan)", lang: "en" },
];

export type TtsProgress = { loaded: number; total: number; url: string };

// WASM assets bundled in public/tts/ — makes the runtime fully offline after
// model download (no CDN dependency for the phonemizer or ONNX runtime).
const LOCAL_WASM = {
  onnxWasm: "/tts/ort/",
  piperData: "/tts/piper/piper_phonemize.data",
  piperWasm: "/tts/piper/piper_phonemize.wasm",
};

async function opfsWrite(fileName: string, data: Uint8Array | Blob): Promise<void> {
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle("piper", { create: true });
  const handle = await dir.getFileHandle(fileName, { create: true });
  const writable = await handle.createWritable();
  const chunk =
    data instanceof Blob
      ? data
      : new Blob([data.buffer.slice(0) as ArrayBuffer]);
  await writable.write(chunk);
  await writable.close();
}

async function opfsHas(fileName: string): Promise<boolean> {
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle("piper");
    await dir.getFileHandle(fileName);
    return true;
  } catch {
    return false;
  }
}

async function fetchToUint8(
  url: string,
  onProgress?: (p: TtsProgress) => void
): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Download failed (${res.status}) ${url}`);
  }
  const total = Number(res.headers.get("Content-Length") ?? 0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress?.({ url, loaded, total });
  }
  const out = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/** True when the voice model is already cached in OPFS. */
export async function isVoiceCached(voiceId: string): Promise<boolean> {
  if (voiceId === INDONESIAN_VOICE) {
    return (
      (await opfsHas(`${INDONESIAN_VOICE}.onnx`)) &&
      (await opfsHas(`${INDONESIAN_VOICE}.onnx.json`))
    );
  }
  const list = await stored();
  return list.includes(voiceId);
}

/** Download and cache the voice model (once). */
export async function ensureVoice(
  voiceId: string,
  onProgress?: (p: TtsProgress) => void
): Promise<void> {
  if (voiceId === INDONESIAN_VOICE) {
    if (await isVoiceCached(voiceId)) return;
    const modelUrl = `${RHASSPY_BASE}/${INDONESIAN_PATH}`;
    const [model, config] = await Promise.all([
      fetchToUint8(modelUrl, (p) => onProgress?.(p)),
      fetchToUint8(`${modelUrl}.json`),
    ]);
    await opfsWrite(`${INDONESIAN_VOICE}.onnx`, model);
    await opfsWrite(`${INDONESIAN_VOICE}.onnx.json`, config);
    return;
  }
  await download(voiceId, (p: any) =>
    onProgress?.({ url: p.url, loaded: p.loaded, total: p.total })
  );
}

let session: TtsSession | null = null;
let sessionVoice: string | null = null;

async function getSession(
  voiceId: string,
  onProgress?: (p: TtsProgress) => void
): Promise<TtsSession> {
  if (session && sessionVoice === voiceId && session.ready) return session;
  session = await TtsSession.create({
    voiceId,
    wasmPaths: LOCAL_WASM,
    progress: (p: any) =>
      onProgress?.({ url: p.url, loaded: p.loaded, total: p.total }),
  });
  sessionVoice = voiceId;
  return session;
}

/**
 * Split text into speakable chunks at sentence boundaries. Keeps each chunk
 * under ~300 chars so inference starts fast and playback is progressive.
 */
export function chunkText(text: string, maxLen = 300): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.!?;:]+[.!?;:"')\]]*\s*/g) ?? [clean];
  const chunks: string[] = [];
  let buf = "";
  for (const s of sentences) {
    if ((buf + s).length > maxLen && buf) {
      chunks.push(buf.trim());
      buf = s;
      if (buf.length > maxLen) {
        // Very long single sentence — hard split.
        chunks.push(buf.slice(0, maxLen).trim());
        buf = buf.slice(maxLen);
      }
    } else {
      buf += s;
    }
  }
  if (buf.trim()) chunks.push(buf.trim());
  return chunks;
}

export type SpeakHandle = {
  promise: Promise<void>;
  stop: () => void;
};

/**
 * Synthesize text chunk-by-chunk, calling onChunk for each audio Blob as it
 * becomes available. Progressive playback: audio starts on the first chunk.
 */
export function speak(
  text: string,
  voiceId: string,
  onChunk: (blob: Blob, index: number, total: number) => void,
  onProgress?: (p: TtsProgress) => void
): SpeakHandle {
  const chunks = chunkText(text);
  let cancelled = false;
  const promise = (async () => {
    if (!chunks.length) return;
    const s = await getSession(voiceId, onProgress);
    for (let i = 0; i < chunks.length; i++) {
      if (cancelled) return;
      const blob = await s.predict(chunks[i]);
      if (cancelled) return;
      onChunk(blob, i, chunks.length);
    }
  })();
  return {
    promise,
    stop: () => {
      cancelled = true;
    },
  };
}

/** Extract readable text from a pdf.js page. */
export async function extractPdfText(
  doc: import("pdfjs-dist").PDFDocumentProxy,
  pageNum: number
): Promise<string> {
  const page = await doc.getPage(pageNum);
  const content = await page.getTextContent();
  const parts: string[] = [];
  for (const item of content.items) {
    if ("str" in item && item.str) {
      parts.push(item.str);
      // hasEOL marks end-of-line — add a pause-friendly break.
      if ((item as any).hasEOL) parts.push(". ");
      else parts.push(" ");
    }
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

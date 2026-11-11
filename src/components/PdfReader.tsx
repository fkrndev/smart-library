import { useEffect, useRef, useState, useCallback } from "react";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { PageFlip } from "page-flip";
import {
  Loader2,
  ChevronLeft,
  ChevronRight,
  List,
  ZoomIn,
  ZoomOut,
  Headphones,
  Play,
  Pause,
  Square,
} from "lucide-react";
import {
  TTS_VOICES,
  ensureVoice,
  isVoiceCached,
  speak,
  extractPdfText,
  type SpeakHandle,
  type TtsProgress,
} from "../lib/tts";

pdfjsLib.GlobalWorkerOptions.workerSrc = PdfWorker;

interface PdfReaderProps {
  data: Uint8Array;
  initialPage: number;
  onProgress: (page: number, total: number, ratio: number, percent: number) => void;
  accent: string;
}

// Render a single PDF page to a data URL at a scale that fits a target width.
async function renderPageToDataUrl(
  doc: PDFDocumentProxy,
  pageNum: number,
  targetWidth: number
): Promise<string> {
  const page = await doc.getPage(pageNum);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.max(0.3, targetWidth / base.width);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  const out = window.devicePixelRatio || 1;
  canvas.width = Math.floor(viewport.width * out);
  canvas.height = Math.floor(viewport.height * out);
  const ctx = canvas.getContext("2d")!;
  const task: RenderTask = page.render({
    canvas,
    canvasContext: ctx,
    viewport,
    transform: out !== 1 ? [out, 0, 0, out, 0, 0] : undefined,
  } as any);
  await task.promise;
  return canvas.toDataURL("image/jpeg", 0.82);
}

// A 1x1 transparent placeholder so PageFlip has something to draw while a
// real page is still rendering.
const PLACEHOLDER =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiLz4=";

export default function PdfReader({ data, initialPage, onProgress, accent }: PdfReaderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const pageFlipRef = useRef<PageFlip | null>(null);
  const renderedRef = useRef<Map<number, string>>(new Map());
  const renderingRef = useRef<Set<number>>(new Set());
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastFlipSoundAt = useRef(0);

  // --- TTS (read aloud) state ---
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsQueueRef = useRef<string[]>([]);
  const ttsSpeakRef = useRef<SpeakHandle | null>(null);
  const ttsActiveRef = useRef(false);
  const ttsPlayingRef = useRef(false);
  const [ttsOpen, setTtsOpen] = useState(false);
  const [ttsVoice, setTtsVoice] = useState(TTS_VOICES[0].id);
  const [ttsBusy, setTtsBusy] = useState<"idle" | "downloading" | "reading">("idle");
  const [ttsPaused, setTtsPaused] = useState(false);
  const [ttsStatus, setTtsStatus] = useState("");

  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(Math.max(1, initialPage));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showThumbs, setShowThumbs] = useState(false);
  const [renderedCount, setRenderedCount] = useState(0);
  const [buildNonce, setBuildNonce] = useState(0);

  // Rebuild the book when the container is resized significantly, so the
  // page dimensions always fit within the available height and width.
  useEffect(() => {
    if (loading || error || numPages === 0) return;
    const el = containerRef.current;
    if (!el) return;
    let lastW = el.clientWidth;
    let lastH = el.clientHeight;
    let timer: number | null = null;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (Math.abs(w - lastW) < 40 && Math.abs(h - lastH) < 40) return;
      lastW = w;
      lastH = h;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => setBuildNonce((n) => n + 1), 300);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (timer) window.clearTimeout(timer);
    };
  }, [loading, error, numPages]);

  // Load the PDF document.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const doc = await pdfjsLib.getDocument({ data: data.slice(0) }).promise;
        if (cancelled) {
          doc.destroy();
          return;
        }
        docRef.current = doc;
        setNumPages(doc.numPages);
        setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError(String(e));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      docRef.current?.destroy().catch(() => {});
      docRef.current = null;
    };
  }, [data]);

  // Compute page dimensions that fit within BOTH the available width (two
  // pages side by side) and the available height, preserving the PDF aspect
  // ratio. Without the height constraint, tall PDFs produce a book taller
  // than the stage and the top/bottom content gets clipped by overflow-hidden.
  const computePageDims = useCallback(
    (aspect: number): { width: number; height: number } => {
      const el = containerRef.current;
      if (!el) return { width: 480, height: Math.floor(480 * aspect) };
      const availW = el.clientWidth - 48; // padding + a little breathing room
      const availH = el.clientHeight - 48;
      // Two pages side by side share the width.
      const widthByW = Math.floor(availW / 2);
      const heightByW = Math.floor(widthByW * aspect);
      if (heightByW <= availH) {
        return { width: Math.max(200, widthByW), height: heightByW };
      }
      // Height-bound: scale width down so the height fits.
      const widthByH = Math.floor(availH / aspect);
      return { width: Math.max(200, widthByH), height: availH };
    },
    []
  );

  // Page width target for rendering page images (matches the book page width).
  const getPageWidth = useCallback(() => {
    const el = containerRef.current;
    if (!el) return 480;
    return Math.max(280, Math.floor((el.clientWidth - 64) / 2));
  }, []);

  // Render a page on demand and push it into the live PageFlip image list.
  const ensurePageRendered = useCallback(
    async (pageNum: number) => {
      const doc = docRef.current;
      const pf = pageFlipRef.current;
      if (!doc || !pf || pageNum < 1 || pageNum > doc.numPages) return;
      if (renderedRef.current.has(pageNum) || renderingRef.current.has(pageNum)) return;
      renderingRef.current.add(pageNum);
      try {
        const url = await renderPageToDataUrl(doc, pageNum, getPageWidth());
        renderedRef.current.set(pageNum, url);
        setRenderedCount(renderedRef.current.size);
        // Update the live image array so the flip book shows the real page.
        const all = Array.from({ length: doc.numPages }, (_, i) => {
          const n = i + 1;
          return renderedRef.current.get(n) ?? PLACEHOLDER;
        });
        try {
          pf.updateFromImages(all);
        } catch {
          /* updateFromImages can throw if state is mid-flip; ignore */
        }
      } catch {
        /* ignore individual page failures */
      } finally {
        renderingRef.current.delete(pageNum);
      }
    },
    [getPageWidth]
  );

  // Play the page-flip sound, throttled so rapid flips don't stack audio.
  // Only triggered by the "flipping" state change, which fires exactly once
  // per page turn — not from manual button handlers or the flip event.
  const playFlipSound = useCallback(() => {
    const now = Date.now();
    if (now - lastFlipSoundAt.current < 500) return;
    lastFlipSoundAt.current = now;
    const a = audioRef.current;
    if (!a) return;
    try {
      a.currentTime = 0;
      a.play().catch(() => {});
    } catch {
      /* audio can fail before user gesture; ignore */
    }
  }, []);

  // Initialize the PageFlip book once the document is ready.
  useEffect(() => {
    if (loading || error || numPages === 0 || !bookRef.current) return;
    let destroyed = false;

    const doc = docRef.current!;
    doc.getPage(1).then((p) => {
      const vp = p.getViewport({ scale: 1 });
      const aspect = vp.height / vp.width;
      if (destroyed) return;
      const dims = computePageDims(aspect);
      buildBook(dims.width, dims.height);
    });

    const buildBook = (pw: number, ph: number) => {
      if (!bookRef.current) return;
      // Reuse already-rendered page images so resize-rebuilds are instant.
      const initial = Array.from({ length: numPages }, (_, i) => {
        const n = i + 1;
        return renderedRef.current.get(n) ?? PLACEHOLDER;
      });
      const pf = new PageFlip(bookRef.current, {
        width: pw,
        height: ph,
        size: "fixed",
        drawShadow: true,
        flippingTime: 800,
        usePortrait: true,
        startZIndex: 5,
        autoSize: true,
        maxShadowOpacity: 0.5,
        showCover: true,
        mobileScrollSupport: false,
        swipeDistance: 25,
        clickEventForward: false,
        useMouseEvents: true,
        showPageCorners: true,
        disableFlipByClick: false,
      });

      // Start on the current page (PageFlip uses 0-indexed startPage). On
      // first build this is initialPage; on resize-rebuild it's currentPage.
      const startPage = Math.max(0, Math.floor((currentPage - 1) / 2) * 2);
      (pf as any).setting.startPage = startPage;
      pf.loadFromImages(initial);
      pageFlipRef.current = pf;

      pf.on("flip", (e: any) => {
        const pageIdx: number = e.data;
        const humanPage = pageIdx + 1;
        setCurrentPage(humanPage);
        // Pre-render the visible pages and a small window ahead/behind.
        const visible = [pageIdx + 1, pageIdx + 2, pageIdx + 3, pageIdx - 1];
        visible.forEach((n) => {
          if (n >= 1 && n <= numPages) ensurePageRendered(n);
        });
      });

      // PageFlip goes through read -> user_fold -> flipping -> read on every
      // turn. Play the sound only on the "flipping" transition — once per
      // page turn, right at the start of the animation.
      pf.on("changeState", (e: any) => {
        if (e?.data === "flipping") playFlipSound();
      });

      // Kick off rendering the initial visible pages.
      const start = Math.max(1, initialPage);
      [start, start + 1, start - 1, start + 2].forEach((n) => {
        if (n >= 1 && n <= numPages) ensurePageRendered(n);
      });
    };

    return () => {
      destroyed = true;
      try {
        pageFlipRef.current?.destroy();
      } catch {
        /* ignore */
      }
      pageFlipRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, error, numPages, buildNonce]);

  // Report progress when the visible page changes.
  useEffect(() => {
    if (numPages === 0) return;
    const ratio = numPages > 0 ? (currentPage - 1) / numPages : 0;
    const percent = numPages > 0 ? (currentPage / numPages) * 100 : 0;
    onProgress(currentPage, numPages, ratio, percent);
  }, [currentPage, numPages, onProgress]);

  // The "flipping" state change plays the sound — no manual trigger needed,
  // and boundary flips (no more pages) stay silent since no state changes.
  const goPrev = () => pageFlipRef.current?.flipPrev();
  const goNext = () => pageFlipRef.current?.flipNext();

  // --- TTS read-aloud -------------------------------------------------------

  // Pages currently displayed in the book, 1-based, in reading order.
  const getSpreadPages = useCallback((): number[] => {
    const pf = pageFlipRef.current;
    if (!pf || !docRef.current) return [currentPage];
    const p = pf.getCurrentPageIndex(); // 0-based left/current page
    if (pf.getOrientation() === "portrait") return [p + 1];
    // Landscape with showCover: spreads are [0], [1,2], [3,4], ...
    const n = docRef.current.numPages;
    if (p === 0) return [1];
    const e = Math.floor((p + 1) / 2);
    const pages = [2 * e - 1, 2 * e].filter((x) => x >= 1 && x <= n);
    return pages;
  }, [currentPage]);

  // Pump the playback queue: plays blob URLs sequentially while reading.
  const pumpTtsQueue = useCallback(() => {
    const el = ttsAudioRef.current;
    if (!el || ttsPlayingRef.current) return;
    const next = ttsQueueRef.current.shift();
    if (!next) return;
    ttsPlayingRef.current = true;
    el.src = next;
    el.onended = () => {
      URL.revokeObjectURL(next);
      ttsPlayingRef.current = false;
      pumpTtsQueue();
    };
    el.onerror = () => {
      URL.revokeObjectURL(next);
      ttsPlayingRef.current = false;
      pumpTtsQueue();
    };
    el.play().catch(() => {
      ttsPlayingRef.current = false;
    });
  }, []);

  const stopTts = useCallback(() => {
    ttsActiveRef.current = false;
    ttsSpeakRef.current?.stop();
    ttsSpeakRef.current = null;
    const el = ttsAudioRef.current;
    if (el) {
      el.pause();
      el.removeAttribute("src");
      el.onended = null;
      el.onerror = null;
    }
    ttsQueueRef.current.forEach((u) => URL.revokeObjectURL(u));
    ttsQueueRef.current = [];
    ttsPlayingRef.current = false;
    setTtsPaused(false);
    setTtsBusy("idle");
    setTtsStatus("");
  }, []);

  // Single read-aloud loop: reads the current spread, drains the playback
  // queue, flips to the next spread, and repeats until stopped or the book
  // ends. Runs once; a guard prevents duplicate loops when the user flips
  // pages manually mid-read.
  const ttsReadingRef = useRef(false);
  const readLoop = useCallback(async () => {
    if (ttsReadingRef.current) return;
    ttsReadingRef.current = true;
    try {
      while (ttsActiveRef.current) {
        const doc = docRef.current;
        const pf = pageFlipRef.current;
        if (!doc || !pf) break;
        const pages = getSpreadPages();
        setTtsStatus(`Membaca hlm. ${pages.join(" & ")}…`);

        let text = "";
        for (const p of pages) {
          if (!ttsActiveRef.current) break;
          try {
            const t = await extractPdfText(doc, p);
            if (t) text += t + " ";
          } catch {
            /* skip unextractable pages */
          }
        }
        if (!ttsActiveRef.current) break;

        if (text.trim()) {
          const handle = speak(
            text.trim(),
            ttsVoice,
            (blob) => {
              ttsQueueRef.current.push(URL.createObjectURL(blob));
              pumpTtsQueue();
            },
            (pr: TtsProgress) => {
              if (pr.total > 0) {
                setTtsStatus(`Menyusun suara… ${Math.round((pr.loaded / pr.total) * 100)}%`);
              }
            }
          );
          ttsSpeakRef.current = handle;
          await handle.promise.catch(() => {});
          ttsSpeakRef.current = null;

          // Wait for the playback queue to finish speaking.
          await new Promise<void>((resolve) => {
            const tick = () => {
              if (!ttsActiveRef.current) return resolve();
              if (ttsQueueRef.current.length === 0 && !ttsPlayingRef.current) return resolve();
              window.setTimeout(tick, 150);
            };
            tick();
          });
          if (!ttsActiveRef.current) break;
        }

        // Move to the next spread, or finish at the end of the book.
        if (pf.getCurrentPageIndex() < doc.numPages - 1) {
          pf.flipNext();
          // Give the flip animation a moment to settle before reading.
          await new Promise((r) => window.setTimeout(r, 350));
        } else {
          ttsActiveRef.current = false;
        }
      }
    } finally {
      ttsReadingRef.current = false;
      if (ttsActiveRef.current) stopTts();
      else {
        setTtsBusy("idle");
        setTtsStatus("");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsVoice, getSpreadPages, pumpTtsQueue, stopTts]);

  const startTts = useCallback(async () => {
    if (ttsBusy === "reading") {
      // Toggle pause/resume.
      const el = ttsAudioRef.current;
      if (el) {
        if (ttsPaused) {
          el.play().catch(() => {});
          setTtsPaused(false);
        } else {
          el.pause();
          setTtsPaused(true);
        }
      }
      return;
    }
    setTtsOpen(true);
    setTtsBusy("downloading");
    setTtsStatus("Menyiapkan suara…");
    try {
      if (!(await isVoiceCached(ttsVoice))) {
        setTtsStatus("Mengunduh voice (sekali saja)…");
      }
      await ensureVoice(ttsVoice, (p) => {
        if (p.total > 0) {
          setTtsStatus(`Mengunduh voice… ${Math.round((p.loaded / p.total) * 100)}%`);
        } else {
          setTtsStatus(`Mengunduh voice… ${Math.round(p.loaded / 1048576)} MB`);
        }
      });
      ttsActiveRef.current = true;
      setTtsBusy("reading");
      readLoop();
    } catch (e) {
      setTtsStatus(`Gagal: ${String(e)}`);
      setTtsBusy("idle");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsBusy, ttsPaused, ttsVoice, readLoop]);

  // Stop TTS on unmount.
  useEffect(() => stopTts, [stopTts]);

  // Keyboard navigation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") {
        e.preventDefault();
        goNext();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numPages]);

  return (
    <div className="relative h-full flex flex-col" style={{ background: "var(--reader-bg)" }}>
      <audio ref={audioRef} src="/sounds/page-flip.mp3" preload="auto" />
      <audio ref={ttsAudioRef} />
      {/* Stage */}
      <div ref={containerRef} className="flex-1 relative overflow-hidden flex items-center justify-center px-4 py-6">
        {loading && (
          <div className="m-auto flex flex-col items-center gap-3" style={{ color: "var(--text-muted)" }}>
            <Loader2 className="w-7 h-7 animate-spin" />
            <span className="text-sm">Memuat dokumen…</span>
          </div>
        )}
        {error && (
          <div className="m-auto text-center" style={{ color: "var(--text-muted)" }}>
            <p className="text-sm">Gagal memuat PDF</p>
            <p className="text-xs mt-1 opacity-70">{error}</p>
          </div>
        )}
        {!loading && !error && (
          <>
            <div
              ref={bookRef}
              className="book-stage"
              style={{
                // Subtle warm vignette behind the book to make it feel like a
                // physical object resting on a desk.
                filter: "drop-shadow(0 18px 40px rgba(0,0,0,0.35))",
              }}
            />
            {renderedCount < numPages && (
              <div className="absolute bottom-20 left-1/2 -translate-x-1/2 text-[11px]" style={{ color: "var(--text-faint)" }}>
                Merender halaman… {renderedCount}/{numPages}
              </div>
            )}
          </>
        )}
      </div>

      {/* Thumbnails rail */}
      {showThumbs && !loading && !error && (
        <Thumbnails
          doc={docRef.current}
          numPages={numPages}
          current={currentPage}
          onSelect={(p) => {
            pageFlipRef.current?.flip(p - 1);
          }}
          accent={accent}
        />
      )}

      {/* Bottom control bar */}
      <div
        className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2 h-11 rounded-full z-30"
        style={{ background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "var(--shadow-lg)" }}
      >
        <ControlBtn onClick={() => setShowThumbs((v) => !v)} active={showThumbs} title="Halaman">
          <List className="w-4 h-4" />
        </ControlBtn>
        <ControlBtn onClick={goPrev} disabled={currentPage <= 1} title="Sebelumnya">
          <ChevronLeft className="w-4 h-4" />
        </ControlBtn>
        <div className="flex items-center gap-1 px-2 text-sm tabular-nums" style={{ color: "var(--text)" }}>
          <input
            type="number"
            value={currentPage}
            min={1}
            max={numPages || 1}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (!isNaN(v)) {
                const clamped = Math.min(numPages, Math.max(1, v));
                setCurrentPage(clamped);
                pageFlipRef.current?.flip(clamped - 1);
              }
            }}
            className="w-12 h-7 text-center rounded-md focus:outline-none"
            style={{ background: "var(--surface-hover)", border: "1px solid var(--border)", color: "var(--text)" }}
          />
          <span style={{ color: "var(--text-faint)" }}>/ {numPages || "—"}</span>
        </div>
        <ControlBtn onClick={goNext} disabled={currentPage >= numPages} title="Berikutnya">
          <ChevronRight className="w-4 h-4" />
        </ControlBtn>
        <div className="w-px h-5 mx-1" style={{ background: "var(--border)" }} />
        <ControlBtn onClick={() => pageFlipRef.current?.flipPrev()} title="Balik kiri">
          <ZoomOut className="w-4 h-4" />
        </ControlBtn>
        <ControlBtn onClick={() => pageFlipRef.current?.flipNext()} title="Balik kanan">
          <ZoomIn className="w-4 h-4" />
        </ControlBtn>
        <div className="w-px h-5 mx-1" style={{ background: "var(--border)" }} />
        <ControlBtn
          onClick={() => {
            setTtsOpen((v) => {
              if (v && ttsBusy === "idle") {
                // Closing while idle is fine; while reading keep it open.
              }
              return !v;
            });
          }}
          active={ttsOpen || ttsBusy === "reading"}
          title="Bacakan (TTS)"
        >
          <Headphones className="w-4 h-4" />
        </ControlBtn>
      </div>

      {/* TTS read-aloud panel */}
      {ttsOpen && (
        <div
          className="absolute bottom-16 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 h-12 rounded-2xl z-30"
          style={{ background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "var(--shadow-lg)" }}
        >
          <select
            value={ttsVoice}
            onChange={(e) => setTtsVoice(e.target.value)}
            disabled={ttsBusy === "reading"}
            className="h-8 px-2 rounded-lg text-xs focus:outline-none disabled:opacity-50"
            style={{ background: "var(--surface-hover)", border: "1px solid var(--border)", color: "var(--text)" }}
            title="Pilih suara"
          >
            {TTS_VOICES.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={startTts}
            disabled={ttsBusy === "downloading"}
            className="h-8 w-8 rounded-full flex items-center justify-center transition-transform active:scale-95 disabled:opacity-50"
            style={{ background: "var(--accent)", color: "var(--accent-contrast)" }}
            title={ttsBusy === "reading" ? (ttsPaused ? "Lanjutkan" : "Jeda") : "Bacakan"}
          >
            {ttsBusy === "downloading" ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : ttsBusy === "reading" && !ttsPaused ? (
              <Pause className="w-4 h-4" />
            ) : (
              <Play className="w-4 h-4" />
            )}
          </button>

          {ttsBusy !== "idle" && (
            <button
              type="button"
              onClick={stopTts}
              className="h-8 w-8 rounded-full flex items-center justify-center transition-transform active:scale-95"
              style={{ background: "var(--surface-hover)", border: "1px solid var(--border)", color: "var(--text-muted)" }}
              title="Berhenti"
            >
              <Square className="w-3.5 h-3.5" />
            </button>
          )}

          {ttsStatus && (
            <span className="text-[11px] whitespace-nowrap" style={{ color: "var(--text-faint)" }}>
              {ttsStatus}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function ControlBtn({
  children,
  onClick,
  disabled,
  active,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="h-8 w-8 rounded-full flex items-center justify-center transition-colors disabled:opacity-30"
      style={
        active
          ? { background: "var(--accent)", color: "var(--accent-contrast)" }
          : { color: "var(--text-muted)" }
      }
    >
      {children}
    </button>
  );
}

function Thumbnails({
  doc,
  numPages,
  current,
  onSelect,
  accent,
}: {
  doc: PDFDocumentProxy | null;
  numPages: number;
  current: number;
  onSelect: (p: number) => void;
  accent: string;
}) {
  const [thumbs, setThumbs] = useState<Record<number, string>>({});

  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    const renderThumb = async (p: number) => {
      try {
        const page = await doc.getPage(p);
        const viewport = page.getViewport({ scale: 0.22 });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        await page.render({ canvas, canvasContext: ctx, viewport } as any).promise;
        if (cancelled) return;
        setThumbs((prev) => ({ ...prev, [p]: canvas.toDataURL("image/jpeg", 0.6) }));
      } catch {
        /* ignore */
      }
    };
    const order: number[] = [];
    for (let dist = 0; dist < numPages; dist++) {
      for (const p of [current + dist, current - dist]) {
        if (p >= 1 && p <= numPages && !order.includes(p)) order.push(p);
      }
    }
    order.forEach((p) => renderThumb(p));
    return () => {
      cancelled = true;
    };
  }, [doc, numPages, current]);

  return (
    <div
      className="absolute left-3 top-3 bottom-16 w-40 z-20 overflow-y-auto py-3 px-2 rounded-xl"
      style={{ background: "var(--bg-sunken)", border: "1px solid var(--border)" }}
    >
      {Array.from({ length: numPages }, (_, i) => i + 1).map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onSelect(p)}
          className="w-full mb-2 rounded-md overflow-hidden transition-all"
          style={{
            border: p === current ? `2px solid ${accent}` : "1px solid var(--border)",
            opacity: p === current ? 1 : 0.7,
          }}
        >
          {thumbs[p] ? (
            <img src={thumbs[p]} alt={`Halaman ${p}`} className="w-full block" />
          ) : (
            <div
              className="w-full aspect-[3/4] flex items-center justify-center text-[10px]"
              style={{ background: "var(--surface)", color: "var(--text-faint)" }}
            >
              {p}
            </div>
          )}
          <div className="text-[10px] py-0.5 text-center" style={{ color: "var(--text-faint)" }}>
            {p}
          </div>
        </button>
      ))}
    </div>
  );
}

import { useEffect, useRef, useState, useCallback } from "react";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { PageFlip } from "page-flip";
import { Loader2, ChevronLeft, ChevronRight, List, ZoomIn, ZoomOut } from "lucide-react";

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

  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(Math.max(1, initialPage));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showThumbs, setShowThumbs] = useState(false);
  const [renderedCount, setRenderedCount] = useState(0);

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

  // Page width target based on container.
  const getPageWidth = useCallback(() => {
    const el = containerRef.current;
    if (!el) return 480;
    // Two pages side by side, minus spine/padding.
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
  const playFlipSound = useCallback(() => {
    const now = Date.now();
    if (now - lastFlipSoundAt.current < 250) return;
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

    const pageW = getPageWidth();
    // Estimate page height from the first page's aspect ratio.
    const doc = docRef.current!;
    let pageH = Math.floor(pageW * 1.414); // A4-ish fallback
    doc.getPage(1).then((p) => {
      const vp = p.getViewport({ scale: 1 });
      pageH = Math.floor(pageW * (vp.height / vp.width));
      if (destroyed) return;
      buildBook(pageW, pageH);
    });

    const buildBook = (pw: number, ph: number) => {
      if (!bookRef.current) return;
      const initial = Array.from({ length: numPages }, () => PLACEHOLDER);
      const pf = new PageFlip(bookRef.current, {
        width: pw,
        height: ph,
        size: "stretch",
        minWidth: 280,
        maxWidth: 1200,
        minHeight: 380,
        maxHeight: 1600,
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

      // Start on the saved page (PageFlip uses 0-indexed startPage).
      (pf as any).setting.startPage = Math.max(0, Math.floor((initialPage - 1) / 2) * 2);
      pf.loadFromImages(initial);
      pageFlipRef.current = pf;

      pf.on("flip", (e: any) => {
        const pageIdx: number = e.data;
        const humanPage = pageIdx + 1;
        setCurrentPage(humanPage);
        playFlipSound();
        // Pre-render the visible pages and a small window ahead/behind.
        const visible = [pageIdx + 1, pageIdx + 2, pageIdx + 3, pageIdx - 1];
        visible.forEach((n) => {
          if (n >= 1 && n <= numPages) ensurePageRendered(n);
        });
      });

      pf.on("changeState", () => {
        // Sound also on the start of a flip for a crisper feel.
        playFlipSound();
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
  }, [loading, error, numPages]);

  // Report progress when the visible page changes.
  useEffect(() => {
    if (numPages === 0) return;
    const ratio = numPages > 0 ? (currentPage - 1) / numPages : 0;
    const percent = numPages > 0 ? (currentPage / numPages) * 100 : 0;
    onProgress(currentPage, numPages, ratio, percent);
  }, [currentPage, numPages, onProgress]);

  const goPrev = () => {
    playFlipSound();
    pageFlipRef.current?.flipPrev();
  };
  const goNext = () => {
    playFlipSound();
    pageFlipRef.current?.flipNext();
  };

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
            playFlipSound();
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
                playFlipSound();
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
      </div>
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

import { useEffect, useRef, useState } from "react";
import ePub, { type Book, type Rendition } from "epubjs";
import { Loader2, ChevronLeft, ChevronRight, List } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface EpubReaderProps {
  data: Uint8Array;
  initialCfi: string | null;
  onProgress: (cfi: string, percent: number) => void;
  accent: string;
}

export default function EpubReader({ data, initialCfi, onProgress, accent }: EpubReaderProps) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showToc, setShowToc] = useState(false);
  const [toc, setToc] = useState<{ label: string; href: string }[]>([]);
  const [percent, setPercent] = useState(0);

  useEffect(() => {
    if (!viewerRef.current) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    const book = ePub(data.buffer as ArrayBuffer);
    bookRef.current = book;
    const rendition = book.renderTo(viewerRef.current, {
      width: "100%",
      height: "100%",
      spread: "none",
      allowScriptedContent: false,
    });
    renditionRef.current = rendition;

    const displayTarget = initialCfi || undefined;
    rendition.display(displayTarget).then(
      () => {
        if (cancelled) return;
        setLoading(false);
      },
      (e) => {
        if (cancelled) return;
        setError(String(e));
        setLoading(false);
      }
    );

    // Theme the epub contents to match the app.
    rendition.themes.register("app", {
      body: {
        background: "var(--reader-page)",
        color: "var(--text)",
        "font-family": "'Inter', Georgia, serif",
        "line-height": "1.7",
        padding: "0 8px",
      },
      a: { color: accent },
      p: { "font-size": "1.05rem" },
      h1: { color: "var(--text)" },
      h2: { color: "var(--text)" },
    });
    rendition.themes.select("app");

    // Track location for progress + resume.
    rendition.on("relocated", (location: any) => {
      const cfi = location?.start?.cfi ?? "";
      if (cfi) {
        const pct = book.locations
          ? book.locations.percentageFromCfi(cfi) * 100
          : 0;
        const p = typeof pct === "number" && !isNaN(pct) ? pct : 0;
        setPercent(p);
        onProgress(cfi, p);
      }
    });

    // Generate locations to enable percentage progress.
    book.ready.then(() => {
      book.locations.generate(1024).catch(() => {});
      const flatten = (items: any[], acc: { label: string; href: string }[] = []) => {
        for (const it of items ?? []) {
          acc.push({ label: it.label?.trim() || it.href, href: it.href });
          if (it.subitems) flatten(it.subitems, acc);
        }
        return acc;
      };
      try {
        setToc(flatten((book.navigation as any)?.toc ?? []));
      } catch {
        /* navigation not ready yet */
      }
    });

    return () => {
      cancelled = true;
      rendition.destroy();
      book.destroy();
      bookRef.current = null;
      renditionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const goPrev = () => renditionRef.current?.prev();
  const goNext = () => renditionRef.current?.next();

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
  }, []);

  return (
    <div className="relative h-full flex" style={{ background: "var(--reader-bg)" }}>
      <AnimatePresence>
        {showToc && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 220, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden shrink-0"
            style={{ background: "var(--bg-sunken)", borderRight: "1px solid var(--border)" }}
          >
            <div className="w-[220px] h-full overflow-y-auto py-3 px-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider px-2 mb-2" style={{ color: "var(--text-faint)" }}>
                Daftar Isi
              </h3>
              {toc.map((t, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    renditionRef.current?.display(t.href);
                    setShowToc(false);
                  }}
                  className="block w-full text-left px-2 py-1.5 rounded-md text-sm hover:opacity-80"
                  style={{ color: "var(--text-muted)" }}
                >
                  {t.label}
                </button>
              ))}
              {toc.length === 0 && (
                <p className="text-xs px-2" style={{ color: "var(--text-faint)" }}>
                  Memuat…
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex-1 flex flex-col">
        <div ref={viewerRef} className="flex-1" />
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ color: "var(--text-muted)" }}>
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-7 h-7 animate-spin" />
              <span className="text-sm">Memuat buku…</span>
            </div>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ color: "var(--text-muted)" }}>
            <div className="text-center">
              <p className="text-sm">Gagal memuat EPUB</p>
              <p className="text-xs mt-1 opacity-70">{error}</p>
            </div>
          </div>
        )}
      </div>

      {/* Bottom control bar */}
      <div
        className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2 h-11 rounded-full z-10"
        style={{ background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "var(--shadow-lg)" }}
      >
        <button
          type="button"
          onClick={() => setShowToc((v) => !v)}
          className="h-8 w-8 rounded-full flex items-center justify-center"
          style={{ color: showToc ? "var(--accent)" : "var(--text-muted)" }}
          title="Daftar isi"
        >
          <List className="w-4 h-4" />
        </button>
        <button type="button" onClick={goPrev} className="h-8 w-8 rounded-full flex items-center justify-center" style={{ color: "var(--text-muted)" }} title="Sebelumnya">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="px-3 text-sm tabular-nums" style={{ color: "var(--text)" }}>
          {Math.round(percent)}%
        </div>
        <button type="button" onClick={goNext} className="h-8 w-8 rounded-full flex items-center justify-center" style={{ color: "var(--text-muted)" }} title="Berikutnya">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

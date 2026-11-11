import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useLibrary } from "../store/library";
import { useTheme } from "../store/theme";
import { loadLibrary, getProgress, saveProgress, type LibraryItem } from "../lib/db";
import { readBookBytes } from "../lib/tauri";
import PdfReader from "../components/PdfReader";
import EpubReader from "../components/EpubReader";
import ThemeToggle from "../components/ThemeToggle";

export default function ReaderPage() {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const theme = useTheme((s) => s.theme);
  const refreshLibrary = useLibrary((s) => s.refresh);

  const [book, setBook] = useState<LibraryItem | null>(null);
  const [data, setData] = useState<Uint8Array | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [progressPercent, setProgressPercent] = useState(0);
  const [initialPage, setInitialPage] = useState(1);
  const [initialCfi, setInitialCfi] = useState<string | null>(null);

  // Load the book metadata + saved progress, then load the file bytes.
  useEffect(() => {
    if (!bookId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const all = await loadLibrary();
        const found = all.find((b) => b.id === bookId) ?? null;
        if (cancelled) return;
        if (!found) {
          setError("Buku tidak ditemukan di perpustakaan.");
          setLoading(false);
          return;
        }
        setBook(found);

        const saved = await getProgress(found.id);
        if (cancelled) return;
        if (saved) {
          setProgressPercent(saved.percent);
          if (found.format === "pdf") {
            setInitialPage(Math.max(1, saved.current_page || 1));
          } else {
            setInitialCfi(null); // CFI stored separately below
          }
        }

        const bytes = await readBookBytes(found.path);
        if (cancelled) return;
        setData(bytes);
        setLoading(false);

        // For epub, restore the CFI from a settings key after data is loaded.
        if (found.format === "epub" && saved) {
          // current_page is repurposed-free; we stash cfi in scroll_ratio? No.
          // We store the cfi in the settings table keyed by book id.
          const { getSetting } = await import("../lib/db");
          const cfi = await getSetting(`cfi:${found.id}`);
          if (cfi) setInitialCfi(cfi);
        }
      } catch (e) {
        if (!cancelled) {
          setError(String(e));
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bookId]);

  // Debounced progress persistence for PDF.
  const savePdfTimer = useRef<number | null>(null);
  const handlePdfProgress = useCallback(
    (page: number, total: number, ratio: number, percent: number) => {
      setProgressPercent(percent);
      if (savePdfTimer.current) window.clearTimeout(savePdfTimer.current);
      savePdfTimer.current = window.setTimeout(() => {
        if (bookId) saveProgress(bookId, page, total, ratio, percent).catch(() => {});
      }, 600);
    },
    [bookId]
  );

  // Debounced progress persistence for EPUB (stores cfi in settings).
  const saveEpubTimer = useRef<number | null>(null);
  const handleEpubProgress = useCallback(
    (cfi: string, percent: number) => {
      setProgressPercent(percent);
      if (saveEpubTimer.current) window.clearTimeout(saveEpubTimer.current);
      saveEpubTimer.current = window.setTimeout(async () => {
        if (!bookId) return;
        try {
          await saveProgress(bookId, 0, 0, 0, percent);
          const { setSetting } = await import("../lib/db");
          await setSetting(`cfi:${bookId}`, cfi);
        } catch {
          /* ignore */
        }
      }, 600);
    },
    [bookId]
  );

  // Persist final progress on unmount and refresh the library ordering.
  useEffect(() => {
    return () => {
      refreshLibrary().catch(() => {});
    };
  }, [refreshLibrary]);

  const accent = theme === "dark" ? "#d9a866" : "#a9692c";

  return (
    <div className="h-full flex flex-col" style={{ background: "var(--reader-bg)", color: "var(--text)" }}>
      {/* Top bar */}
      <header
        className="flex items-center gap-3 px-4 py-3 z-20"
        style={{
          background: "color-mix(in srgb, var(--reader-bg) 88%, transparent)",
          backdropFilter: "blur(12px)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <button
          type="button"
          onClick={() => navigate("/")}
          className="flex items-center gap-2 h-9 px-3 rounded-full text-sm transition-colors"
          style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-muted)" }}
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="hidden sm:inline">Perpustakaan</span>
        </button>

        <div className="flex-1 min-w-0 text-center">
          <h1 className="text-sm font-medium truncate" style={{ color: "var(--text)" }} title={book?.title}>
            {book?.title ?? "Memuat…"}
          </h1>
        </div>

        {/* Progress ring/bar */}
        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-2">
            <div className="w-28 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
              <motion.div
                className="h-full rounded-full"
                style={{ background: "var(--accent)" }}
                animate={{ width: `${Math.min(100, progressPercent)}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
            <span className="text-xs tabular-nums" style={{ color: "var(--text-faint)" }}>
              {Math.round(progressPercent)}%
            </span>
          </div>
          <ThemeToggle />
        </div>
      </header>

      {/* Reader stage */}
      <div className="flex-1 relative overflow-hidden">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ color: "var(--text-muted)" }}>
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-7 h-7 animate-spin" />
              <span className="text-sm">Membuka buku…</span>
            </div>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ color: "var(--text-muted)" }}>
            <div className="text-center max-w-sm">
              <p className="text-sm">{error}</p>
              <button
                type="button"
                onClick={() => navigate("/")}
                className="mt-4 h-9 px-4 rounded-full text-sm"
                style={{ background: "var(--accent)", color: "var(--accent-contrast)" }}
              >
                Kembali
              </button>
            </div>
          </div>
        )}
        {!loading && !error && data && book?.format === "pdf" && (
          <PdfReader data={data} initialPage={initialPage} onProgress={handlePdfProgress} accent={accent} />
        )}
        {!loading && !error && data && book?.format === "epub" && (
          <EpubReader data={data} initialCfi={initialCfi} onProgress={handleEpubProgress} accent={accent} />
        )}
      </div>
    </div>
  );
}


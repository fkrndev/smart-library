import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FolderPlus, Search, Library, Loader2, BookOpen } from "lucide-react";
import { useLibrary } from "../store/library";
import BookCard from "../components/BookCard";
import ThemeToggle from "../components/ThemeToggle";

export default function LibraryPage() {
  const { books, loading, scanning, scan, error } = useLibrary();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "pdf" | "epub" | "reading">("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return books.filter((b) => {
      if (filter === "pdf" && b.format !== "pdf") return false;
      if (filter === "epub" && b.format !== "epub") return false;
      if (filter === "reading" && b.percent <= 0) return false;
      if (!q) return true;
      return b.title.toLowerCase().includes(q) || b.file_name.toLowerCase().includes(q);
    });
  }, [books, query, filter]);

  const continueReading = useMemo(
    () => books.filter((b) => b.percent > 0).sort((a, b) => b.last_read_at - a.last_read_at).slice(0, 6),
    [books]
  );

  return (
    <div className="h-full flex flex-col" style={{ background: "var(--bg)", color: "var(--text)" }}>
      {/* Top bar */}
      <header
        className="flex items-center gap-3 px-6 py-4 sticky top-0 z-20"
        style={{
          background: "color-mix(in srgb, var(--bg) 88%, transparent)",
          backdropFilter: "blur(12px)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="h-9 w-9 rounded-xl flex items-center justify-center"
            style={{ background: "var(--accent)", color: "var(--accent-contrast)" }}
          >
            <Library className="w-5 h-5" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="font-semibold text-[15px]">Smart Library</span>
            <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>
              {books.length} buku
            </span>
          </div>
        </div>

        <div className="flex-1" />

        {/* Search */}
        <div className="relative hidden sm:block">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-faint)" }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari buku…"
            className="pl-9 pr-3 h-9 w-56 rounded-full text-sm focus:outline-none"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              color: "var(--text)",
            }}
          />
        </div>

        <button
          type="button"
          onClick={scan}
          disabled={scanning}
          className="flex items-center gap-2 h-9 px-4 rounded-full text-sm font-medium transition-transform active:scale-95 disabled:opacity-60"
          style={{ background: "var(--accent)", color: "var(--accent-contrast)" }}
        >
          {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderPlus className="w-4 h-4" />}
          {scanning ? "Memindai…" : "Pindai Folder"}
        </button>

        <ThemeToggle />
      </header>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 pb-10">
        {error && (
          <div className="mt-4 p-3 rounded-lg text-sm" style={{ background: "rgba(200,60,60,0.1)", color: "#c0392b" }}>
            {error}
          </div>
        )}

        {books.length === 0 && !loading && <EmptyState onScan={scan} />}

        {continueReading.length > 0 && (
          <section className="mt-6">
            <h2 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--text-faint)" }}>
              Lanjutkan Membaca
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {continueReading.map((b, i) => (
                <BookCard key={b.id} book={b} index={i} />
              ))}
            </div>
          </section>
        )}

        {books.length > 0 && (
          <div className="flex items-center gap-2 mt-8 mb-4">
            <h2 className="text-base font-semibold mr-2">Koleksi</h2>
            {(["all", "reading", "pdf", "epub"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className="px-3 h-7 rounded-full text-xs font-medium transition-colors"
                style={
                  filter === f
                    ? { background: "var(--accent)", color: "var(--accent-contrast)" }
                    : { background: "var(--surface)", color: "var(--text-muted)", border: "1px solid var(--border)" }
                }
              >
                {f === "all" ? "Semua" : f === "reading" ? "Sedang dibaca" : f.toUpperCase()}
              </button>
            ))}
          </div>
        )}

        <AnimatePresence mode="popLayout">
          {filtered.length > 0 && (
            <motion.div layout className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {filtered.map((b, i) => (
                <BookCard key={b.id} book={b} index={i} />
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {books.length > 0 && filtered.length === 0 && (
          <p className="mt-10 text-center text-sm" style={{ color: "var(--text-faint)" }}>
            Tidak ada buku yang cocok.
          </p>
        )}
      </div>
    </div>
  );
}

function EmptyState({ onScan }: { onScan: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="flex flex-col items-center justify-center text-center mt-20 px-6"
    >
      <div
        className="h-20 w-20 rounded-3xl flex items-center justify-center mb-5"
        style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--accent)" }}
      >
        <BookOpen className="w-9 h-9" strokeWidth={1.2} />
      </div>
      <h2 className="text-xl font-semibold mb-1">Perpustakaanmu masih kosong</h2>
      <p className="text-sm max-w-sm mb-6" style={{ color: "var(--text-muted)" }}>
        Pindai sebuah folder di komputermu untuk menambahkan buku PDF dan EPUB ke
        perpustakaan. Progress bacaanmu akan tersimpan otomatis.
      </p>
      <button
        type="button"
        onClick={onScan}
        className="flex items-center gap-2 h-11 px-6 rounded-full text-sm font-medium transition-transform active:scale-95"
        style={{ background: "var(--accent)", color: "var(--accent-contrast)" }}
      >
        <FolderPlus className="w-4 h-4" />
        Pindai Folder Buku
      </button>
    </motion.div>
  );
}

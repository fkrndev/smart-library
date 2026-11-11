import { motion } from "framer-motion";
import { BookOpen, FileText } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { formatBytes, formatPercent, timeAgo } from "../lib/format";
import type { LibraryItem } from "../lib/db";

interface BookCardProps {
  book: LibraryItem;
  index?: number;
}

// A deterministic, pleasant gradient per book based on its id, so the library
// looks alive even before covers are extracted.
function coverGradient(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  const h1 = hash % 360;
  const h2 = (h1 + 40) % 360;
  return `linear-gradient(135deg, hsl(${h1} 45% 38%), hsl(${h2} 50% 28%))`;
}

export default function BookCard({ book, index = 0 }: BookCardProps) {
  const navigate = useNavigate();
  const isPdf = book.format === "pdf";
  const hasProgress = book.percent > 0;

  return (
    <motion.button
      type="button"
      onClick={() => navigate(`/read/${book.id}`)}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index * 0.03, 0.4), ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -4 }}
      className="group relative flex flex-col text-left rounded-2xl overflow-hidden focus:outline-none"
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        boxShadow: "var(--shadow)",
      }}
    >
      {/* Cover */}
      <div
        className="relative aspect-[3/4] w-full overflow-hidden flex items-center justify-center"
        style={{ background: coverGradient(book.id) }}
      >
        <div className="absolute inset-0 opacity-30 mix-blend-overlay"
          style={{
            background:
              "radial-gradient(circle at 30% 20%, rgba(255,255,255,0.5), transparent 60%)",
          }}
        />
        {isPdf ? (
          <FileText className="w-12 h-12 text-white/85" strokeWidth={1.2} />
        ) : (
          <BookOpen className="w-12 h-12 text-white/85" strokeWidth={1.2} />
        )}
        <span
          className="absolute top-2 right-2 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide"
          style={{
            background: "rgba(0,0,0,0.35)",
            color: "rgba(255,255,255,0.92)",
            backdropFilter: "blur(4px)",
          }}
        >
          {book.format}
        </span>

        {/* Progress overlay */}
        {hasProgress && (
          <div className="absolute bottom-0 left-0 right-0 px-3 py-2"
            style={{ background: "linear-gradient(to top, rgba(0,0,0,0.55), transparent)" }}
          >
            <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.25)" }}>
              <motion.div
                className="h-full rounded-full"
                style={{ background: "var(--accent-soft)" }}
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(100, book.percent)}%` }}
                transition={{ duration: 0.6, delay: 0.1 + index * 0.02 }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Meta */}
      <div className="flex flex-col gap-1 p-3">
        <h3
          className="text-sm font-medium leading-snug line-clamp-2"
          style={{ color: "var(--text)" }}
          title={book.title}
        >
          {book.title}
        </h3>
        <div className="flex items-center justify-between text-[11px]" style={{ color: "var(--text-faint)" }}>
          <span>{book.page_count ? `${book.page_count} hlm` : formatBytes(book.size)}</span>
          <span>{hasProgress ? formatPercent(book.percent) : timeAgo(book.last_read_at)}</span>
        </div>
      </div>
    </motion.button>
  );
}

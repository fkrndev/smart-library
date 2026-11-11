import { create } from "zustand";
import { open } from "@tauri-apps/plugin-dialog";
import {
  loadLibrary,
  upsertBooks,
  deleteBook,
  type LibraryItem,
} from "../lib/db";
import { scanFolder, type BookEntry } from "../lib/tauri";

interface LibraryState {
  books: LibraryItem[];
  loading: boolean;
  scanning: boolean;
  lastFolder: string | null;
  error: string | null;
  refresh: () => Promise<void>;
  scan: () => Promise<void>;
  scanPath: (folder: string) => Promise<void>;
  remove: (bookId: string) => Promise<void>;
}

const toBookRow = (b: BookEntry): LibraryItem => ({
  id: b.id,
  path: b.path,
  file_name: b.file_name,
  title: b.title,
  format: b.format,
  size: b.size,
  page_count: b.page_count,
  cover_path: b.cover_path,
  added_at: Date.now(),
  current_page: 0,
  total_pages: 0,
  percent: 0,
  last_read_at: 0,
});

export const useLibrary = create<LibraryState>((set, get) => ({
  books: [],
  loading: false,
  scanning: false,
  lastFolder: null,
  error: null,
  refresh: async () => {
    set({ loading: true });
    try {
      const books = await loadLibrary();
      set({ books, loading: false });
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },
  scan: async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Pilih folder buku",
      });
      if (!selected) return;
      await get().scanPath(selected as string);
    } catch (e) {
      set({ error: String(e), scanning: false });
    }
  },
  scanPath: async (folder: string) => {
    set({ scanning: true, error: null });
    try {
      const result = await scanFolder(folder);
      const rows = result.books.map(toBookRow);
      await upsertBooks(rows);
      await get().refresh();
      set({ scanning: false, lastFolder: result.folder });
    } catch (e) {
      set({ scanning: false, error: String(e) });
    }
  },
  remove: async (bookId: string) => {
    await deleteBook(bookId);
    await get().refresh();
  },
}));

import Database from "@tauri-apps/plugin-sql";

let dbPromise: Promise<Database> | null = null;

const DB_URL = "sqlite:smart_library.db";

export function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = Database.load(DB_URL);
  }
  return dbPromise;
}

export interface BookRow {
  id: string;
  path: string;
  file_name: string;
  title: string;
  format: string;
  size: number;
  page_count: number | null;
  cover_path: string | null;
  added_at: number;
}

export interface ProgressRow {
  book_id: string;
  current_page: number;
  total_pages: number;
  scroll_ratio: number;
  last_read_at: number;
  percent: number;
}

export interface LibraryItem extends BookRow {
  current_page: number;
  total_pages: number;
  percent: number;
  last_read_at: number;
}

/** Upsert a batch of scanned books, ignoring ones already present. */
export async function upsertBooks(books: BookRow[]): Promise<void> {
  const db = await getDb();
  for (const b of books) {
    await db.execute(
      `INSERT INTO books (id, path, file_name, title, format, size, page_count, cover_path, added_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT(id) DO UPDATE SET
         path = excluded.path,
         file_name = excluded.file_name,
         title = excluded.title,
         size = excluded.size,
         page_count = COALESCE(excluded.page_count, books.page_count)`,
      [
        b.id,
        b.path,
        b.file_name,
        b.title,
        b.format,
        b.size,
        b.page_count,
        b.cover_path,
        b.added_at,
      ]
    );
  }
}

/** Load all books joined with their reading progress, most recently read first. */
export async function loadLibrary(): Promise<LibraryItem[]> {
  const db = await getDb();
  const rows = await db.select<LibraryItem[]>(`
    SELECT b.*,
           COALESCE(p.current_page, 0) AS current_page,
           COALESCE(p.total_pages, 0) AS total_pages,
           COALESCE(p.percent, 0) AS percent,
           COALESCE(p.last_read_at, 0) AS last_read_at
    FROM books b
    LEFT JOIN reading_progress p ON p.book_id = b.id
    ORDER BY p.last_read_at DESC, b.title ASC
  `);
  return rows;
}

export async function saveProgress(
  bookId: string,
  currentPage: number,
  totalPages: number,
  scrollRatio: number,
  percent: number
): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  await db.execute(
    `INSERT INTO reading_progress (book_id, current_page, total_pages, scroll_ratio, last_read_at, percent)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT(book_id) DO UPDATE SET
       current_page = excluded.current_page,
       total_pages = excluded.total_pages,
       scroll_ratio = excluded.scroll_ratio,
       last_read_at = excluded.last_read_at,
       percent = excluded.percent`,
    [bookId, currentPage, totalPages, scrollRatio, now, percent]
  );
}

export async function getProgress(bookId: string): Promise<ProgressRow | null> {
  const db = await getDb();
  const rows = await db.select<ProgressRow[]>(
    `SELECT * FROM reading_progress WHERE book_id = $1`,
    [bookId]
  );
  return rows[0] ?? null;
}

export async function getSetting(key: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<{ value: string }[]>(
    `SELECT value FROM settings WHERE key = $1`,
    [key]
  );
  return rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value]
  );
}

export async function deleteBook(bookId: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM reading_progress WHERE book_id = $1`, [bookId]);
  await db.execute(`DELETE FROM books WHERE id = $1`, [bookId]);
}

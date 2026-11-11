import { invoke } from "@tauri-apps/api/core";

export interface BookEntry {
  id: string;
  path: string;
  file_name: string;
  title: string;
  format: string;
  size: number;
  page_count: number | null;
  cover_path: string | null;
}

export interface ScanResult {
  folder: string;
  books: BookEntry[];
}

export async function scanFolder(folder: string): Promise<ScanResult> {
  return invoke<ScanResult>("scan_folder", { folder });
}

export async function readBookBytes(path: string): Promise<Uint8Array> {
  const bytes = await invoke<number[]>("read_book_bytes", { path });
  return new Uint8Array(bytes);
}

export async function getAppDataDir(): Promise<string> {
  return invoke<string>("get_app_data_dir");
}

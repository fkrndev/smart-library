use std::path::PathBuf;
use serde::Serialize;
use tauri::Manager;
use walkdir::WalkDir;

#[derive(Debug, Serialize, Clone)]
pub struct BookEntry {
    pub id: String,
    pub path: String,
    pub file_name: String,
    pub title: String,
    pub format: String,
    pub size: u64,
    pub page_count: Option<u32>,
    pub cover_path: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct ScanResult {
    pub folder: String,
    pub books: Vec<BookEntry>,
}

fn detect_format(file_name: &str) -> Option<String> {
    let lower = file_name.to_lowercase();
    if lower.ends_with(".pdf") {
        Some("pdf".to_string())
    } else if lower.ends_with(".epub") {
        Some("epub".to_string())
    } else {
        None
    }
}

fn title_from_file_name(file_name: &str) -> String {
    let stem = file_name
        .rsplit_once('.')
        .map(|(stem, _)| stem)
        .unwrap_or(file_name);
    stem.replace('_', " ").replace('.', " ").trim().to_string()
}

fn pdf_page_count(path: &PathBuf) -> Option<u32> {
    match lopdf::Document::load(path) {
        Ok(doc) => Some(doc.get_pages().len() as u32),
        Err(_) => None,
    }
}

fn make_id(path: &PathBuf) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    path.to_string_lossy().hash(&mut hasher);
    format!("{:x}", hasher.finish())
}

/// Scan a folder recursively for ebook files (pdf, epub).
#[tauri::command]
fn scan_folder(folder: String) -> Result<ScanResult, String> {
    let root = PathBuf::from(&folder);
    if !root.exists() {
        return Err(format!("Folder does not exist: {}", folder));
    }
    if !root.is_dir() {
        return Err(format!("Not a folder: {}", folder));
    }

    let mut books = Vec::new();
    for entry in WalkDir::new(&root)
        .follow_links(true)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        let file_name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        let format = match detect_format(&file_name) {
            Some(f) => f,
            None => continue,
        };
        let meta = std::fs::metadata(path).map_err(|e| e.to_string())?;
        let page_count = if format == "pdf" {
            pdf_page_count(&path.to_path_buf())
        } else {
            None
        };
        books.push(BookEntry {
            id: make_id(&path.to_path_buf()),
            path: path.to_string_lossy().to_string(),
            file_name: file_name.clone(),
            title: title_from_file_name(&file_name),
            format,
            size: meta.len(),
            page_count,
            cover_path: None,
        });
    }

    // Sort by title for a stable, readable library.
    books.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));

    Ok(ScanResult {
        folder,
        books,
    })
}

/// Read a file as bytes (for sending PDF/EPUB data to the frontend reader).
#[tauri::command]
fn read_book_bytes(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| format!("Failed to read {}: {}", path, e))
}

/// Persist the active library folder so the app remembers it between launches.
#[tauri::command]
fn get_app_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    app.path()
        .app_data_dir()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(
                    "sqlite:smart_library.db",
                    vec![tauri_plugin_sql::Migration {
                        version: 1,
                        description: "create books and progress tables",
                        sql: "CREATE TABLE IF NOT EXISTS books (
                            id TEXT PRIMARY KEY,
                            path TEXT NOT NULL,
                            file_name TEXT NOT NULL,
                            title TEXT NOT NULL,
                            format TEXT NOT NULL,
                            size INTEGER NOT NULL,
                            page_count INTEGER,
                            cover_path TEXT,
                            added_at INTEGER NOT NULL
                        );
                        CREATE TABLE IF NOT EXISTS reading_progress (
                            book_id TEXT PRIMARY KEY,
                            current_page INTEGER NOT NULL DEFAULT 0,
                            total_pages INTEGER NOT NULL DEFAULT 0,
                            scroll_ratio REAL NOT NULL DEFAULT 0.0,
                            last_read_at INTEGER NOT NULL DEFAULT 0,
                            percent REAL NOT NULL DEFAULT 0.0,
                            FOREIGN KEY (book_id) REFERENCES books(id)
                        );
                        CREATE TABLE IF NOT EXISTS settings (
                            key TEXT PRIMARY KEY,
                            value TEXT
                        );",
                        kind: tauri_plugin_sql::MigrationKind::Up,
                    }],
                )
                .build(),
        )
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            scan_folder,
            read_book_bytes,
            get_app_data_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}

use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::Emitter;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Song {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub duration: f64,
    pub vocals_path: String,
    pub no_vocals_path: String,
    pub pitch_path: String,
    pub thumb_path: Option<String>,
    pub lyrics: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProgressPayload {
    pub percent: f64,
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProcessResponse {
    pub success: bool,
    pub song: Option<Song>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ListResponse {
    pub success: bool,
    pub songs: Vec<Song>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SimpleResponse {
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchResultItem {
    pub id: String,
    pub title: String,
    pub duration: Option<f64>,
    pub uploader: Option<String>,
    pub url: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchResponse {
    pub success: bool,
    pub results: Vec<SearchResultItem>,
    pub error: Option<String>,
}

/// Discovers the python executable in conda or system
fn get_python_binary() -> PathBuf {
    let conda_path = PathBuf::from("/opt/anaconda3/envs/track-splitter/bin/python");
    if conda_path.exists() {
        return conda_path;
    }
    let home = std::env::var("HOME").unwrap_or_default();
    let miniconda_path = PathBuf::from(&home).join("miniconda3/envs/track-splitter/bin/python");
    if miniconda_path.exists() {
        return miniconda_path;
    }
    let anaconda_user_path = PathBuf::from(&home).join("anaconda3/envs/track-splitter/bin/python");
    if anaconda_user_path.exists() {
        return anaconda_user_path;
    }
    PathBuf::from("python3")
}

/// Finds the path to worker.py
fn get_worker_script() -> PathBuf {
    let rel = Path::new("../../track_splitter/worker.py");
    if rel.exists() {
        if let Ok(canon) = rel.canonicalize() {
            return canon;
        }
    }
    let fallback = PathBuf::from("/Users/francomolochegarcia/dev/test-proj-26-11/track-splitter/track_splitter/worker.py");
    if fallback.exists() {
        return fallback;
    }
    PathBuf::from("track_splitter/worker.py")
}

#[tauri::command]
async fn list_songs() -> Result<Vec<Song>, String> {
    let py = get_python_binary();
    let script = get_worker_script();

    let output = Command::new(&py)
        .arg(&script)
        .arg("list")
        .output()
        .map_err(|e| format!("Failed to execute python worker: {e}"))?;

    if !output.status.success() {
        let err_msg = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Worker list failed: {err_msg}"));
    }

    let stdout_str = String::from_utf8_lossy(&output.stdout);
    let resp: ListResponse = serde_json::from_str(&stdout_str)
        .map_err(|e| format!("Invalid JSON response: {e} -> {stdout_str}"))?;

    Ok(resp.songs)
}

#[tauri::command]
async fn search_youtube(query: String) -> Result<Vec<SearchResultItem>, String> {
    let py = get_python_binary();
    let script = get_worker_script();

    let output = Command::new(&py)
        .arg(&script)
        .arg("search")
        .arg(&query)
        .arg("--limit")
        .arg("8")
        .output()
        .map_err(|e| format!("Failed to search youtube: {e}"))?;

    if !output.status.success() {
        let err_msg = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Worker search failed: {err_msg}"));
    }

    let stdout_str = String::from_utf8_lossy(&output.stdout);
    let resp: SearchResponse = serde_json::from_str(&stdout_str)
        .map_err(|e| format!("Invalid search JSON: {e}"))?;

    Ok(resp.results)
}

#[tauri::command]
async fn delete_song(song_id: String) -> Result<bool, String> {
    let py = get_python_binary();
    let script = get_worker_script();

    let output = Command::new(&py)
        .arg(&script)
        .arg("delete")
        .arg(&song_id)
        .output()
        .map_err(|e| format!("Failed to delete song: {e}"))?;

    let stdout_str = String::from_utf8_lossy(&output.stdout);
    let resp: SimpleResponse = serde_json::from_str(&stdout_str)
        .map_err(|e| format!("Invalid JSON: {e}"))?;

    Ok(resp.success)
}

#[tauri::command]
async fn save_lyrics(song_id: String, lyrics: String) -> Result<bool, String> {
    let py = get_python_binary();
    let script = get_worker_script();

    let output = Command::new(&py)
        .arg(&script)
        .arg("save-lyrics")
        .arg(&song_id)
        .arg(&lyrics)
        .output()
        .map_err(|e| format!("Failed to save lyrics: {e}"))?;

    let stdout_str = String::from_utf8_lossy(&output.stdout);
    let resp: SimpleResponse = serde_json::from_str(&stdout_str)
        .map_err(|e| format!("Invalid JSON: {e}"))?;

    Ok(resp.success)
}

#[tauri::command]
async fn process_track<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    source: String,
    use_roformer: bool,
) -> Result<Song, String> {
    let py = get_python_binary();
    let script = get_worker_script();

    let mut cmd = Command::new(&py);
    cmd.arg(&script).arg("process").arg(&source);
    if use_roformer {
        cmd.arg("--roformer");
    }

    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn worker: {e}"))?;

    let stderr = child.stderr.take().ok_or("Failed to capture worker stderr")?;
    let app_handle = app.clone();

    // Spawn thread to monitor worker progress
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            if let Ok(l) = line {
                if l.starts_with("PROGRESS:") {
                    let parts: Vec<&str> = l.splitn(3, ':').collect();
                    if parts.len() == 3 {
                        let pct = parts[1].parse::<f64>().unwrap_or(0.0);
                        let msg = parts[2].to_string();
                        let _ = app_handle.emit(
                            "process-progress",
                            ProgressPayload {
                                percent: pct,
                                message: msg,
                            },
                        );
                    }
                }
            }
        }
    });

    let output = child
        .wait_with_output()
        .map_err(|e| format!("Worker crashed: {e}"))?;

    let stdout_str = String::from_utf8_lossy(&output.stdout);
    
    // Find the JSON object anywhere in stdout (even if preceded or followed by other text/carriage returns)
    let json_candidate = if let (Some(start_idx), Some(end_idx)) = (stdout_str.find('{'), stdout_str.rfind('}')) {
        if start_idx < end_idx {
            &stdout_str[start_idx..=end_idx]
        } else {
            stdout_str.trim()
        }
    } else {
        stdout_str.trim()
    };

    let resp: ProcessResponse = serde_json::from_str(json_candidate)
        .map_err(|e| format!("Failed to parse process output: {e} -> {stdout_str}"))?;

    if let Some(song) = resp.song {
        Ok(song)
    } else {
        Err(resp.error.unwrap_or_else(|| "Unknown processing error".into()))
    }
}

/// Reads a local file (e.g. wav or image) as base64
#[tauri::command]
async fn read_local_file_base64(path: String) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let bytes = std::fs::read(&path).map_err(|e| format!("Error reading {path}: {e}"))?;
    Ok(STANDARD.encode(bytes))
}

#[tauri::command]
async fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Error reading text {path}: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            list_songs,
            search_youtube,
            delete_song,
            save_lyrics,
            process_track,
            read_local_file_base64,
            read_text_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

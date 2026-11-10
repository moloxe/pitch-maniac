import json
import shutil
import time
from pathlib import Path
from typing import List, Dict, Any, Optional

DEFAULT_LIBRARY_DIR = Path.home() / ".cache" / "pitch-maniac"


def get_library_dir(custom_dir: Optional[str | Path] = None) -> Path:
    base = Path(custom_dir).resolve() if custom_dir else DEFAULT_LIBRARY_DIR
    base.mkdir(parents=True, exist_ok=True)
    return base


def _library_file(lib_dir: Path) -> Path:
    return lib_dir / "library.json"


def load_library(lib_dir: Optional[Path] = None) -> List[Dict[str, Any]]:
    ld = lib_dir or get_library_dir()
    lf = _library_file(ld)
    if not lf.exists():
        return []
    try:
        with open(lf, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data.get("songs", []) if isinstance(data, dict) else []
    except Exception:
        return []


def save_library(songs: List[Dict[str, Any]], lib_dir: Optional[Path] = None):
    ld = lib_dir or get_library_dir()
    lf = _library_file(ld)
    ld.mkdir(parents=True, exist_ok=True)
    with open(lf, "w", encoding="utf-8") as f:
        json.dump({"songs": songs}, f, indent=2, ensure_ascii=False)


def upsert_song(song: Dict[str, Any], lib_dir: Optional[Path] = None) -> List[Dict[str, Any]]:
    songs = load_library(lib_dir)
    songs = [s for s in songs if s.get("id") != song.get("id")]
    songs.insert(0, song)
    save_library(songs, lib_dir)
    return songs


def get_song(song_id: str, lib_dir: Optional[Path] = None) -> Optional[Dict[str, Any]]:
    for s in load_library(lib_dir):
        if s.get("id") == song_id:
            return s
    return None


def delete_song(song_id: str, lib_dir: Optional[Path] = None) -> bool:
    ld = lib_dir or get_library_dir()
    songs = load_library(ld)
    initial_len = len(songs)
    songs = [s for s in songs if s.get("id") != song_id]
    if len(songs) == initial_len:
        return False
    save_library(songs, ld)

    # Eliminar directorio físico de la canción si existe
    song_folder = ld / "songs" / song_id
    if song_folder.exists() and song_folder.is_dir():
        shutil.rmtree(song_folder, ignore_errors=True)
    return True


def save_song_lyrics(song_id: str, lyrics: str, lib_dir: Optional[Path] = None) -> bool:
    ld = lib_dir or get_library_dir()
    songs = load_library(ld)
    found = False
    for s in songs:
        if s.get("id") == song_id:
            s["lyrics"] = lyrics
            found = True
            break
    if found:
        save_library(songs, ld)
    return found


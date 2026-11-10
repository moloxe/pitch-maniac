import json
import pytest
from pathlib import Path
from track_splitter.pitch import hz_to_midi, extract_pitch_yin, save_pitch_json
from track_splitter.library import get_library_dir, save_library, load_library, upsert_song, delete_song, save_song_lyrics


def test_hz_to_midi():
    assert hz_to_midi(0) == 0.0
    assert abs(hz_to_midi(440.0) - 69.0) < 1e-4
    assert abs(hz_to_midi(220.0) - 57.0) < 1e-4


def test_library_crud(tmp_path):
    songs = load_library(tmp_path)
    assert songs == []

    song1 = {
        "id": "song1",
        "title": "Test Song",
        "artist": "Test Artist",
        "duration": 120.0,
        "vocals_path": str(tmp_path / "vocals.wav"),
        "no_vocals_path": str(tmp_path / "no_vocals.wav"),
        "pitch_path": str(tmp_path / "pitch.json"),
        "thumb_path": None,
        "lyrics": "Hello world",
    }
    upsert_song(song1, tmp_path)
    loaded = load_library(tmp_path)
    assert len(loaded) == 1
    assert loaded[0]["id"] == "song1"

    save_song_lyrics("song1", "Updated lyrics", tmp_path)
    loaded = load_library(tmp_path)
    assert loaded[0]["lyrics"] == "Updated lyrics"

    assert delete_song("song1", tmp_path) is True
    assert len(load_library(tmp_path)) == 0

import json
import pytest
from pathlib import Path
from track_splitter.pitch import hz_to_midi, extract_pitch_yin, save_pitch_json
from track_splitter.library import get_library_dir, save_library, load_library, upsert_song, delete_song, save_song_lyrics, reorder_songs
from track_splitter import lyrics as lyrics_mod


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

    save_song_lyrics("song1", "Updated lyrics", tmp_path, synced_lyrics="[00:01.00] Updated lyrics")
    loaded = load_library(tmp_path)
    assert loaded[0]["lyrics"] == "Updated lyrics"
    assert loaded[0]["synced_lyrics"] == "[00:01.00] Updated lyrics"

    assert delete_song("song1", tmp_path) is True
    assert len(load_library(tmp_path)) == 0


def test_library_reorder_songs(tmp_path):
    for sid in ["song1", "song2", "song3"]:
        upsert_song(
            {
                "id": sid,
                "title": f"Title {sid}",
                "artist": "Artist",
                "duration": 100.0,
                "vocals_path": str(tmp_path / sid / "vocals.wav"),
                "no_vocals_path": str(tmp_path / sid / "no_vocals.wav"),
                "pitch_path": str(tmp_path / sid / "pitch.json"),
            },
            tmp_path,
        )

    assert [s["id"] for s in load_library(tmp_path)] == ["song3", "song2", "song1"]

    reordered = reorder_songs(["song1", "song3", "song2"], tmp_path)
    assert [s["id"] for s in reordered] == ["song1", "song3", "song2"]
    assert [s["id"] for s in load_library(tmp_path)] == ["song1", "song3", "song2"]

    # Partial list moves specified IDs first and preserves remaining tracks
    partial = reorder_songs(["song2"], tmp_path)
    assert [s["id"] for s in partial] == ["song2", "song1", "song3"]


def test_lyrics_cleaning_and_lrc_stripping():
    assert lyrics_mod.clean_title("Carin Leon - Primera Cita [Official Video]") == "Carin Leon - Primera Cita"
    assert lyrics_mod.clean_title("Daryl Hall & John Oates - Maneater (Official Video)") == "Daryl Hall & John Oates - Maneater"
    assert lyrics_mod.clean_artist("alice smith music") == "alice smith"
    assert lyrics_mod.clean_artist("Unknown") == ""

    synced = "[ar:Amén]\n[00:10.50] Primera linea\n[00:15.25] Segunda linea"
    assert lyrics_mod.strip_lrc_timestamps(synced) == "Primera linea\nSegunda linea"


def test_fetch_lrclib_lyrics_prefers_duration_and_artist(monkeypatch):
    fake_results = [
        {
            "trackName": "Te Quiero, Te Quiero",
            "artistName": "Nino Bravo",
            "duration": 171.0,
            "plainLyrics": "Wrong song",
            "syncedLyrics": "[00:10.00] Wrong song",
            "instrumental": False,
        },
        {
            "trackName": "Te Quiero",
            "artistName": "Amén",
            "duration": 265.0,
            "plainLyrics": "Correct song",
            "syncedLyrics": "[00:12.00] Correct song",
            "instrumental": False,
        },
    ]

    monkeypatch.setattr(lyrics_mod, "_query_lrclib", lambda params, timeout=8.0: fake_results)
    res = lyrics_mod.fetch_lrclib_lyrics("Te Quiero", "AMEN rock Perú", duration=264.88)
    assert res is not None
    assert res["lyrics"] == "Correct song"
    assert res["synced_lyrics"] == "[00:12.00] Correct song"
    assert res["artist_name"] == "Amén"

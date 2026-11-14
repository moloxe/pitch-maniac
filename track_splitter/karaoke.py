import json
import os
import shutil
import subprocess
import uuid
import numpy as np
import torch
from pathlib import Path
from typing import Dict, Any, Optional

from .downloader import download, is_youtube_url, convert_to_wav, sanitize_filename
from .engine import separate_demucs, separate_roformer_vocals, resolve_device, load_wav, save_wav_f32
from .pitch import extract_pitch_yin, save_pitch_json
from .library import get_library_dir, upsert_song
from .lyrics import fetch_lyrics


def separate_karaoke_pair(
    source: str | Path,
    out_dir: Optional[str | Path] = None,
    device: str = "auto",
    use_roformer: bool = False,
    progress_callback=None,
) -> Dict[str, Any]:
    """
    Processes a YouTube URL or local audio file to generate:
    - vocals.wav (isolated vocals)
    - no_vocals.wav (accompaniment: drums + bass + other, or original minus vocals)
    - pitch.json (YIN pitch curve)
    - thumb.jpg (song thumbnail)
    - metadata registered in local library cache.
    """
    def report(status: str, progress: float):
        if progress_callback:
            progress_callback(status, progress)

    dev = resolve_device(device)
    lib_dir = get_library_dir()
    song_id = str(uuid.uuid4())[:8]

    # Destination directory for this song
    song_dir = lib_dir / "songs" / song_id if out_dir is None else Path(out_dir).resolve()
    song_dir.mkdir(parents=True, exist_ok=True)
    temp_dir = song_dir / "_temp"
    temp_dir.mkdir(parents=True, exist_ok=True)

    title = "Song"
    artist = "Unknown"
    thumb_path: Optional[Path] = None
    orig_wav = temp_dir / "orig.wav"

    source_str = str(source).strip()
    report("Downloading / Preparing audio...", 0.1)

    if is_youtube_url(source_str):
        # Download from YouTube with thumbnail
        audio_file, thumb_file, info = download(
            source_str,
            out_dir=temp_dir,
            format="wav",
            quiet=True,
            download_thumbnail=True,
        )
        title = info.get("title") or "YouTube Track"
        artist = info.get("uploader") or info.get("channel") or "Unknown"
        
        # Move audio to orig_wav
        if audio_file.exists():
            shutil.move(str(audio_file), str(orig_wav))
            
        # Move thumbnail if present
        if thumb_file and thumb_file.exists():
            final_thumb = song_dir / "thumb.jpg"
            shutil.copyfile(str(thumb_file), str(final_thumb))
            thumb_path = final_thumb
    else:
        # Local file
        local_file = Path(source_str).resolve()
        if not local_file.is_file():
            raise FileNotFoundError(f"Source file not found: {local_file}")
        title = local_file.stem
        if local_file.suffix.lower() == ".wav":
            shutil.copyfile(str(local_file), str(orig_wav))
        else:
            convert_to_wav(local_file, orig_wav)

    report("Separating vocal and backing tracks...", 0.35)

    vocals_path = song_dir / "vocals.wav"
    no_vocals_path = song_dir / "no_vocals.wav"

    if use_roformer:
        # Use Mel-Band Roformer for vocals
        stems_temp = temp_dir / "stems"
        stems_temp.mkdir(parents=True, exist_ok=True)
        v_path = separate_roformer_vocals(orig_wav, stems_temp, device=dev)
        shutil.move(str(v_path), str(vocals_path))
        
        # Backing track = original - vocals
        orig_audio, sr = load_wav(orig_wav)
        voc_audio, _ = load_wav(vocals_path)
        min_len = min(orig_audio.shape[1], voc_audio.shape[1])
        backing_audio = orig_audio[:, :min_len] - voc_audio[:, :min_len]
        save_wav_f32(no_vocals_path, backing_audio, sr)
    else:
        # Use Demucs for complete separation and sum non-vocals
        stems_temp = temp_dir / "stems"
        demucs_stems = separate_demucs(
            wav_path=orig_wav,
            out_dir=stems_temp,
            model_name="htdemucs",
            wanted_stems=None,
            shifts=1,
            device=dev,
        )
        # Demucs produces: vocals, drums, bass, other
        if "vocals" in demucs_stems:
            shutil.move(str(demucs_stems["vocals"]), str(vocals_path))
        
        # Backing track: sum drums, bass, and other
        backing_stems = [p for name, p in demucs_stems.items() if name != "vocals" and p.exists()]
        if backing_stems:
            backing_acc = None
            sr = 44100
            for sp in backing_stems:
                data, sr = load_wav(sp)
                if backing_acc is None:
                    backing_acc = data
                else:
                    min_len = min(backing_acc.shape[1], data.shape[1])
                    backing_acc = backing_acc[:, :min_len] + data[:, :min_len]
            save_wav_f32(no_vocals_path, backing_acc, sr)
        else:
            # Fallback
            orig_audio, sr = load_wav(orig_wav)
            voc_audio, _ = load_wav(vocals_path)
            min_len = min(orig_audio.shape[1], voc_audio.shape[1])
            save_wav_f32(no_vocals_path, orig_audio[:, :min_len] - voc_audio[:, :min_len], sr)

    report("Extracting vocal pitch trajectory (YIN)...", 0.75)
    pitch_frames = extract_pitch_yin(vocals_path, frame_rate=50)
    pitch_json_path = song_dir / "pitch.json"
    save_pitch_json(pitch_frames, pitch_json_path)

    # Clean up temp files
    try:
        shutil.rmtree(temp_dir, ignore_errors=True)
    except Exception:
        pass

    # Read duration
    import torchaudio
    info_audio = torchaudio.info(str(vocals_path))
    duration = round(info_audio.num_frames / info_audio.sample_rate, 2)

    report("Fetching lyrics...", 0.9)
    yt_source = source_str if is_youtube_url(source_str) else None
    lyrics_text = ""
    synced_lyrics_text: Optional[str] = None
    try:
        lyr_res = fetch_lyrics(
            title=title,
            artist=artist,
            duration=duration,
            source_url=yt_source,
        )
        if lyr_res.get("found"):
            lyrics_text = lyr_res.get("lyrics") or ""
            synced_lyrics_text = lyr_res.get("synced_lyrics")
    except Exception:
        pass

    song_record = {
        "id": song_id,
        "title": title,
        "artist": artist,
        "duration": duration,
        "vocals_path": str(vocals_path),
        "no_vocals_path": str(no_vocals_path),
        "pitch_path": str(pitch_json_path),
        "thumb_path": str(thumb_path) if thumb_path and thumb_path.exists() else None,
        "lyrics": lyrics_text,
        "synced_lyrics": synced_lyrics_text,
        "source_url": yt_source,
    }

    upsert_song(song_record)
    report("Completed!", 1.0)
    return song_record

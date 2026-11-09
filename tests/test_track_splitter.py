import math
import struct
import wave
import numpy as np
from pathlib import Path
from track_splitter.downloader import parse_video_id, sanitize_filename
from track_splitter.engine import save_wav_f32, load_wav, resolve_device
from track_splitter import split, download


def test_url_parser():
    assert parse_video_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert parse_video_id("https://youtu.be/dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert parse_video_id("dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert parse_video_id("https://youtube.com/shorts/dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert sanitize_filename('Queen: Bohemian "Rhapsody"?') == "Queen- Bohemian -Rhapsody"


def test_wav_io(tmp_path: Path):
    sr = 44100
    # Generar 1 segundo de tono estéreo sintético
    t = np.linspace(0, 1.0, sr, endpoint=False)
    left = 0.5 * np.sin(2 * np.pi * 440 * t)
    right = 0.5 * np.cos(2 * np.pi * 440 * t)
    data = np.stack([left, right], axis=0).astype(np.float32)

    wav_file = tmp_path / "test.wav"
    save_wav_f32(wav_file, data, sr)
    assert wav_file.exists()

    loaded_data, loaded_sr = load_wav(wav_file)
    assert loaded_sr == sr
    assert loaded_data.shape == (2, sr)
    assert np.allclose(data, loaded_data, atol=1e-4)


def test_device_detection():
    dev = resolve_device("auto")
    assert dev in ("mps", "cuda", "cpu")


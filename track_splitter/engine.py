import gc
import os
import struct
import sys
import time
import urllib.request
import wave
from pathlib import Path
from typing import List, Dict, Optional, Tuple

import numpy as np
import torch

# Parche para torch >= 2.6: permitir cargar checkpoints pickled de Demucs
_orig_torch_load = torch.load


def _load_any(*args, **kwargs):
    kwargs.setdefault("weights_only", False)
    return _orig_torch_load(*args, **kwargs)


torch.load = _load_any

# Directorio de modelos y constantes Roformer
ROFORMER_CKPT_NAME = "MelBandRoformer.ckpt"
ROFORMER_CKPT_URL = "https://huggingface.co/KimberleyJSN/melbandroformer/resolve/main/MelBandRoformer.ckpt"
ROFORMER_PARAMS = dict(
    dim=384,
    depth=6,
    stereo=True,
    num_stems=1,
    time_transformer_depth=1,
    freq_transformer_depth=1,
    num_bands=60,
    dim_head=64,
    heads=8,
    attn_dropout=0,
    ff_dropout=0,
    flash_attn=True,
    dim_freqs_in=1025,
    sample_rate=44100,
    stft_n_fft=2048,
    stft_hop_length=441,
    stft_win_length=2048,
    stft_normalized=False,
    mask_estimator_depth=2,
    multi_stft_resolution_loss_weight=1.0,
    multi_stft_resolutions_window_sizes=(4096, 2048, 1024, 512, 256),
    multi_stft_hop_size=147,
    multi_stft_normalized=False,
)
ROFORMER_CHUNK_SIZE = 352800  # 8s at 44100
ROFORMER_NUM_OVERLAP = 2


def resolve_device(device: str = "auto") -> str:
    """Detecta el mejor acelerador disponible (cuda -> mps -> cpu)."""
    if device == "auto":
        if torch.cuda.is_available():
            return "cuda"
        if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
            return "mps"
        return "cpu"
    return device


def release_memory(device: str):
    """Libera caché de memoria de PyTorch y fuerza recolección de basura."""
    try:
        if device == "cuda" and torch.cuda.is_available():
            torch.cuda.empty_cache()
        elif device == "mps" and getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
            torch.mps.empty_cache()
    except Exception:
        pass
    gc.collect()


def load_wav(path: str | Path) -> Tuple[np.ndarray, int]:
    """Carga un archivo WAV a numpy array float32 de forma (canales, muestras). Soporta PCM y IEEE float."""
    import torchaudio

    waveform, sr = torchaudio.load(str(path))
    return waveform.numpy(), sr


def save_wav_f32(path: str | Path, data: np.ndarray, sr: int):
    """Guarda directamente un array numpy a un archivo WAV PCM Float32 sin saturar memoria."""
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    channels, _ = data.shape
    block = np.ascontiguousarray(data.T, dtype="<f4")
    size = block.nbytes
    block_align = channels * 4
    header = b"RIFF" + struct.pack("<I", 36 + size) + b"WAVE"
    header += b"fmt " + struct.pack("<IHHIIHH", 16, 3, channels, sr, sr * block_align, block_align, 32)
    header += b"data" + struct.pack("<I", size)
    with open(str(path), "wb") as f:
        f.write(header)
        block.tofile(f)


def _ensure_roformer_model(ckpt_dir: Path) -> Path:
    """Descarga el checkpoint de Mel-Band Roformer si no existe."""
    ckpt_dir.mkdir(parents=True, exist_ok=True)
    ckpt_path = ckpt_dir / ROFORMER_CKPT_NAME
    if ckpt_path.exists():
        return ckpt_path

    part = ckpt_path.with_suffix(".ckpt.part")
    headers = {"User-Agent": "track-splitter"}
    req = urllib.request.Request(ROFORMER_CKPT_URL, headers=headers)
    with urllib.request.urlopen(req, timeout=120) as res, open(part, "wb") as f:
        while True:
            chunk = res.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
    part.replace(ckpt_path)
    return ckpt_path


def separate_roformer_vocals(
    wav_path: Path,
    out_dir: Path,
    device: str = "auto",
    models_cache: Optional[Path] = None,
) -> Path:
    """Separa pistas vocales usando Mel-Band Roformer con calidad de estudio."""
    dev = resolve_device(device)
    use_half = dev in ("cuda", "mps")
    cache_dir = models_cache or (Path.home() / ".cache" / "track-splitter" / "models")
    ckpt_path = _ensure_roformer_model(cache_dir)

    # Añadir vendor al path para cargar MelBandRoformer
    vendor_path = str(Path(__file__).parent / "vendor")
    if vendor_path not in sys.path:
        sys.path.insert(0, vendor_path)

    from models.bs_roformer.mel_band_roformer import MelBandRoformer

    model = MelBandRoformer(**ROFORMER_PARAMS)
    ckpt = torch.load(ckpt_path, map_location="cpu")
    if isinstance(ckpt, dict) and "state_dict" in ckpt:
        ckpt = ckpt["state_dict"]
    model.load_state_dict(ckpt, strict=True)
    del ckpt
    gc.collect()

    model.to(dev)
    if use_half:
        model.half()
        model.band_split.to(torch.float32)
    model.eval()

    audio, sr = load_wav(wav_path)
    if audio.shape[0] == 1:
        audio = np.repeat(audio, 2, axis=0)
    mix = torch.from_numpy(audio).to(dev)

    # Inferencia en chunks con ventana de superposición
    step = ROFORMER_CHUNK_SIZE // ROFORMER_NUM_OVERLAP
    border = ROFORMER_CHUNK_SIZE - step
    fade_size = ROFORMER_CHUNK_SIZE // 10
    total = mix.shape[-1]
    length_init = total

    if length_init > 2 * border and border > 0:
        mix = torch.nn.functional.pad(mix, (border, border), mode="reflect")

    window = torch.ones(ROFORMER_CHUNK_SIZE, device=dev)
    window[:fade_size] = torch.linspace(0, 1, fade_size, device=dev)
    window[-fade_size:] = torch.linspace(1, 0, fade_size, device=dev)

    result = torch.zeros(mix.shape, device=dev)
    counter = torch.zeros(mix.shape, device=dev)

    with torch.inference_mode():
        i = 0
        batch_data = []
        batch_locations = []
        while i < mix.shape[-1]:
            part = mix[:, i : i + ROFORMER_CHUNK_SIZE]
            chunk_len = part.shape[-1]
            pad_mode = "reflect" if chunk_len > ROFORMER_CHUNK_SIZE // 2 else "constant"
            part = torch.nn.functional.pad(part, (0, ROFORMER_CHUNK_SIZE - chunk_len), mode=pad_mode, value=0)
            if use_half:
                part = part.to(torch.float16)
            batch_data.append(part)
            batch_locations.append((i, chunk_len))
            i += step
            if len(batch_data) >= 1 or i >= mix.shape[-1]:
                arr = torch.stack(batch_data, dim=0)
                x = model(arr)
                for j, (start, seg_len) in enumerate(batch_locations):
                    win = window[:seg_len].clone()
                    if start == 0:
                        win[:fade_size] = 1
                    elif i >= mix.shape[-1]:
                        win[-fade_size:] = 1
                    result[..., start : start + seg_len] += x[j, :, :seg_len].float() * win
                    counter[..., start : start + seg_len] += win
                batch_data.clear()
                batch_locations.clear()

    est = result / counter.clamp(min=1e-8)
    if length_init > 2 * border and border > 0:
        est = est[..., border:-border]

    vocals = est.cpu().numpy()
    del model, mix, est, result, counter
    release_memory(dev)

    vocals_file = out_dir / "vocals.wav"
    save_wav_f32(vocals_file, vocals, sr)
    return vocals_file


def separate_demucs(
    wav_path: Path,
    out_dir: Path,
    model_name: str = "htdemucs",
    wanted_stems: Optional[List[str]] = None,
    shifts: int = 1,
    overlap: float = 0.25,
    device: str = "auto",
) -> Dict[str, Path]:
    """Separa pistas usando Demucs (htdemucs o htdemucs_6s)."""
    import demucs.apply as dapply
    from demucs.pretrained import get_model

    dev = resolve_device(device)
    model = get_model(model_name)
    model.to(dev)
    model.eval()

    audio, sr = load_wav(wav_path)
    target_sr = model.samplerate
    if sr != target_sr:
        import torchaudio

        t = torch.from_numpy(audio)
        t = torchaudio.functional.resample(t, sr, target_sr)
        audio = t.numpy()
        sr = target_sr

    if audio.shape[0] == 1:
        audio = np.repeat(audio, 2, axis=0)

    mix = torch.from_numpy(audio).to(dev)[None]
    del audio

    try:
        sources = dapply.apply_model(
            model,
            mix,
            device=dev,
            shifts=shifts,
            split=True,
            overlap=overlap,
            progress=False,
        )
    except Exception as e:
        if dev == "mps":
            # Fallback seguro a CPU si MPS se queda sin memoria
            model = model.cpu()
            mix = mix.cpu()
            dev = "cpu"
            release_memory("mps")
            sources = dapply.apply_model(
                model,
                mix,
                device=dev,
                shifts=shifts,
                split=True,
                overlap=overlap,
                progress=False,
            )
        else:
            raise e

    del mix
    names = list(model.sources)
    out_cpu = sources[0].cpu().numpy()
    del model, sources
    release_memory(dev)

    out_dir.mkdir(parents=True, exist_ok=True)
    saved_stems: Dict[str, Path] = {}
    for i, name in enumerate(names):
        if wanted_stems is not None and name not in wanted_stems:
            continue
        dest_path = out_dir / f"{name}.wav"
        save_wav_f32(dest_path, out_cpu[i], sr)
        saved_stems[name] = dest_path

    return saved_stems


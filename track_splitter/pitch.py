import json
import math
from pathlib import Path
from typing import List, Dict, Any, Tuple
import numpy as np
import torch
import torchaudio


def hz_to_midi(hz: float) -> float:
    """Convierte frecuencia en Hz a número de nota MIDI fraccionario (A4 = 440 Hz = 69)."""
    if hz <= 0:
        return 0.0
    return 69.0 + 12.0 * math.log2(hz / 440.0)


def extract_pitch_yin(
    wav_path: str | Path,
    frame_rate: int = 50,
    fmin: float = 65.0,  # ~C2
    fmax: float = 1050.0,  # ~C6
    harmonic_threshold: float = 0.15,
) -> List[Dict[str, Any]]:
    """
    Extrae la trayectoria de pitch en el tiempo usando una implementación vectorizada del algoritmo YIN.
    
    Retorna una lista de frames:
    [
        {"t": 0.02, "hz": 220.5, "midi": 57.04, "voiced": True},
        ...
    ]
    """
    waveform, sr = torchaudio.load(str(wav_path))
    if waveform.shape[0] > 1:
        audio = torch.mean(waveform, dim=0).numpy()
    else:
        audio = waveform[0].numpy()

    hop_size = int(sr / frame_rate)
    window_size = int(sr / fmin * 2)  # Ventana que cubre al menos 2 periodos de la frecuencia mínima
    
    min_period = max(2, int(sr / fmax))
    max_period = min(window_size // 2, int(sr / fmin))

    num_frames = (len(audio) - window_size) // hop_size
    if num_frames <= 0:
        return []

    pitch_data: List[Dict[str, Any]] = []

    for i in range(num_frames):
        start = i * hop_size
        frame = audio[start : start + window_size]
        t = round((start + window_size / 2) / sr, 3)

        # 1. Energía y umbral de silencio
        rms = np.sqrt(np.mean(frame**2))
        if rms < 0.005:
            pitch_data.append({"t": t, "hz": 0.0, "midi": 0.0, "voiced": False})
            continue

        # 2. Difference function d_t(tau)
        # Vectorizado mediante correlación cruzada (FFT)
        n = len(frame)
        # padding para correlación
        f_pad = np.pad(frame, (0, n), mode="constant")
        fft_f = np.fft.rfft(f_pad)
        power_spec = fft_f * np.conj(fft_f)
        corr = np.fft.irfft(power_spec)[:n]

        sq_sum = np.sum(frame**2)
        # energy term for lagged window
        cumsum_sq = np.cumsum(frame**2)
        # d(tau) = sum (x_t - x_{t+tau})^2 = sum x_t^2 + sum x_{t+tau}^2 - 2 * corr
        # aproximación YIN estándar:
        d = np.zeros(max_period + 1, dtype=np.float32)
        for tau in range(min_period, max_period + 1):
            d[tau] = np.sum((frame[: n - tau] - frame[tau:]) ** 2)

        # 3. Cumulative mean normalized difference d'(tau)
        d_prime = np.zeros_like(d)
        d_prime[0] = 1.0
        running_sum = 0.0
        for tau in range(1, len(d)):
            running_sum += d[tau]
            if running_sum > 0:
                d_prime[tau] = d[tau] / (running_sum / tau)
            else:
                d_prime[tau] = 1.0

        # 4. Absolute thresholding & min selection
        tau_selected = -1
        for tau in range(min_period, max_period):
            if d_prime[tau] < harmonic_threshold:
                while tau + 1 < max_period and d_prime[tau + 1] < d_prime[tau]:
                    tau += 1
                tau_selected = tau
                break

        if tau_selected == -1:
            # Fallback al mínimo global si es razonablemente armónico
            best_tau = np.argmin(d_prime[min_period:max_period]) + min_period
            if d_prime[best_tau] < 0.35:
                tau_selected = best_tau

        if tau_selected > 0:
            # 5. Interpolación parabólica
            alpha = d_prime[tau_selected - 1]
            beta = d_prime[tau_selected]
            gamma = d_prime[min(tau_selected + 1, len(d_prime) - 1)]
            denom = alpha - 2 * beta + gamma
            if abs(denom) > 1e-6:
                delta = 0.5 * (alpha - gamma) / denom
                delta = np.clip(delta, -0.5, 0.5)
            else:
                delta = 0.0

            refined_tau = tau_selected + delta
            hz = sr / refined_tau
            midi = round(hz_to_midi(hz), 2)
            pitch_data.append({"t": t, "hz": round(float(hz), 1), "midi": midi, "voiced": True})
        else:
            pitch_data.append({"t": t, "hz": 0.0, "midi": 0.0, "voiced": False})

    return pitch_data


def save_pitch_json(pitch_data: List[Dict[str, Any]], output_path: str | Path):
    """Guarda la serie temporal de pitch en un archivo JSON comprimido y estructurado."""
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    with open(str(output_path), "w", encoding="utf-8") as f:
        json.dump({"version": 1, "frames": pitch_data}, f, separators=(",", ":"))


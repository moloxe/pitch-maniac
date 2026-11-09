from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Dict, Optional, Union
import shutil

from .downloader import (
    download,
    search,
    is_youtube_url,
    convert_to_wav,
    parse_video_id,
    sanitize_filename,
)
from .engine import (
    separate_demucs,
    separate_roformer_vocals,
    resolve_device,
)

PRESETS = {
    "all": ["vocals", "drums", "bass", "other"],
    "karaoke": ["drums", "bass", "other"],
    "acapella": ["vocals"],
    "rhythm": ["drums", "bass"],
}


@dataclass
class SplitResult:
    """Resultado estructurado de la separación."""
    title: str
    mix: Path
    out_dir: Path
    model: str
    device: str
    stems: Dict[str, Path] = field(default_factory=dict)


def split(
    source: Union[str, Path],
    stems: Optional[Union[List[str], str]] = None,
    out_dir: Union[str, Path] = "output",
    *,
    studio_vocals: bool = False,
    fine_tuned: bool = False,
    shifts: int = 1,
    device: str = "auto",
) -> SplitResult:
    """
    Descarga (si es YouTube) o procesa un audio local, y separa las pistas deseadas.
    
    Args:
        source: URL de YouTube, ID de video, o ruta a un archivo de audio local.
        stems: Lista de stems a extraer (ej: ['vocals', 'guitar'] o 'drums') o preset ('karaoke', 'acapella').
               Si es None o 'all', extrae todas las pistas disponibles.
        out_dir: Carpeta donde se guardarán los stems y el mix.
        studio_vocals: Si True, usa el modelo Mel-Band Roformer para las voces (máxima calidad).
        fine_tuned: Si True y se usa Demucs 4-stems, usa el checkpoint fino 'htdemucs_ft'.
        shifts: Número de pases de refinamiento (1 o 2).
        device: Dispositivo de cómputo ('auto', 'mps', 'cuda', 'cpu').
        
    Returns:
        SplitResult con los caminos a cada archivo .wav generado.
    """
    dev = resolve_device(device)
    out_root = Path(out_dir).resolve()
    out_root.mkdir(parents=True, exist_ok=True)

    # 1. Normalizar selección de stems
    wanted_stems: Optional[List[str]] = None
    if isinstance(stems, str):
        stems_lower = stems.lower().strip()
        if stems_lower in PRESETS:
            wanted_stems = PRESETS[stems_lower]
        else:
            wanted_stems = [s.strip() for s in stems_lower.split(",") if s.strip()]
    elif isinstance(stems, (list, tuple, set)):
        wanted_stems = [str(s).lower().strip() for s in stems]

    # 2. Obtener archivo de audio (WAV 44.1kHz estéreo)
    source_str = str(source)
    if is_youtube_url(source_str):
        # Descargar de YouTube
        downloaded_wav = download(source_str, out_dir=out_root / "_temp", format="wav", quiet=True)
        title = downloaded_wav.stem
        song_dir = out_root / sanitize_filename(title)
        song_dir.mkdir(parents=True, exist_ok=True)
        mix_wav = song_dir / "mix.wav"
        shutil.move(str(downloaded_wav), str(mix_wav))
        # Limpiar archivo o carpeta temporal de forma segura
        temp_dir = out_root / "_temp"
        try:
            if temp_dir.exists():
                shutil.rmtree(temp_dir, ignore_errors=True)
        except Exception:
            pass
    else:
        # Archivo local
        local_path = Path(source_str).resolve()
        if not local_path.is_file():
            raise FileNotFoundError(f"Archivo de audio no encontrado: {local_path}")
        title = local_path.stem
        song_dir = out_root / sanitize_filename(title)
        song_dir.mkdir(parents=True, exist_ok=True)
        mix_wav = song_dir / "mix.wav"
        if local_path.suffix.lower() == ".wav":
            shutil.copyfile(str(local_path), str(mix_wav))
        else:
            convert_to_wav(local_path, mix_wav)

    stems_out_dir = song_dir / "stems"
    stems_out_dir.mkdir(parents=True, exist_ok=True)
    generated_stems: Dict[str, Path] = {}

    # 3. Determinar motor y modelo
    uses_extended = wanted_stems and any(s in ("guitar", "piano") for s in wanted_stems)
    if uses_extended:
        model_name = "htdemucs_6s"
    elif fine_tuned:
        model_name = "htdemucs_ft"
    else:
        model_name = "htdemucs"

    wants_vocals = wanted_stems is None or "vocals" in wanted_stems

    # 4. Ejecución de separación
    if studio_vocals and wants_vocals and not uses_extended:
        # A. Voces con Roformer
        vocals_path = separate_roformer_vocals(mix_wav, stems_out_dir, device=dev)
        generated_stems["vocals"] = vocals_path

        # B. Otros instrumentos con Demucs si se solicitaron
        other_stems = (
            [s for s in wanted_stems if s != "vocals"]
            if wanted_stems is not None
            else ["drums", "bass", "other"]
        )
        if other_stems:
            demucs_stems = separate_demucs(
                wav_path=mix_wav,
                out_dir=stems_out_dir,
                model_name=model_name,
                wanted_stems=other_stems,
                shifts=shifts,
                device=dev,
            )
            generated_stems.update(demucs_stems)
        effective_model = f"roformer_hybrid_{model_name}"
    else:
        # Todo con Demucs (htdemucs o htdemucs_6s)
        demucs_stems = separate_demucs(
            wav_path=mix_wav,
            out_dir=stems_out_dir,
            model_name=model_name,
            wanted_stems=wanted_stems,
            shifts=shifts,
            device=dev,
        )
        generated_stems.update(demucs_stems)
        effective_model = model_name

    return SplitResult(
        title=title,
        mix=mix_wav,
        out_dir=stems_out_dir,
        model=effective_model,
        device=dev,
        stems=generated_stems,
    )


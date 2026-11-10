import re
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple
import subprocess
import shutil
import yt_dlp

_YT_PATTERNS = [
    re.compile(r"(?:youtube\.com/watch\?.*v=)([\w-]{11})"),
    re.compile(r"(?:youtu\.be/)([\w-]{11})"),
    re.compile(r"(?:youtube\.com/shorts/)([\w-]{11})"),
    re.compile(r"(?:youtube\.com/embed/)([\w-]{11})"),
]


def parse_video_id(url_or_id: str) -> Optional[str]:
    """Extrae el ID de 11 caracteres de un video de YouTube o retorna el ID si ya lo es."""
    text = str(url_or_id).strip()
    for pattern in _YT_PATTERNS:
        match = pattern.search(text)
        if match:
            return match.group(1)
    if re.fullmatch(r"[\w-]{11}", text):
        return text
    return None


def is_youtube_url(url_or_path: str) -> bool:
    """Verifica si el input es una URL o ID de YouTube o si es un archivo local."""
    return parse_video_id(url_or_path) is not None or "youtube.com" in url_or_path or "youtu.be" in url_or_path


def sanitize_filename(name: str) -> str:
    """Limpia caracteres inválidos para nombres de archivo."""
    clean = re.sub(r'[\\/:*?"<>|]+', "-", name).strip(" -")
    return clean[:120] if clean else "audio"


def search(query: str, limit: int = 10) -> List[Dict[str, Any]]:
    """Busca videos en YouTube y retorna una lista de resultados con id, título, duración y canal."""
    query = str(query).strip()
    if not query:
        return []

    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": True,
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        result = ydl.extract_info(f"ytsearch{limit}:{query}", download=False)
        entries = result.get("entries", []) if result else []
        return [
            {
                "id": e.get("id"),
                "title": e.get("title"),
                "duration": e.get("duration"),
                "uploader": e.get("uploader") or e.get("channel"),
                "url": f"https://www.youtube.com/watch?v={e.get('id')}",
            }
            for e in entries
            if e.get("id")
        ]


def convert_to_wav(input_path: Path, output_path: Path, sample_rate: int = 44100) -> Path:
    """Convierte cualquier archivo de audio a WAV PCM 16-bit 44.1kHz estéreo usando ffmpeg."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    ffmpeg_bin = shutil.which("ffmpeg")
    if not ffmpeg_bin:
        raise RuntimeError(
            "ffmpeg no se encontró en el PATH. Instálalo con 'conda install ffmpeg' o agrégalo a tu sistema."
        )

    cmd = [
        ffmpeg_bin,
        "-y",
        "-i",
        str(input_path),
        "-ar",
        str(sample_rate),
        "-ac",
        "2",
        "-c:a",
        "pcm_s16le",
        str(output_path),
    ]
    res = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"Error convirtiendo audio con ffmpeg: {res.stderr}")
    return output_path


def download(
    url_or_id: str,
    out_dir: str | Path = "downloads",
    format: str = "wav",
    quiet: bool = True,
    download_thumbnail: bool = False,
) -> Tuple[Path, Optional[Path], Dict[str, Any]]:
    """
    Descarga el audio de un video de YouTube en la mejor calidad y opcionalmente su miniatura.
    
    Retorna: (audio_path, thumbnail_path, info_dict)
    """
    vid = parse_video_id(url_or_id)
    url = f"https://www.youtube.com/watch?v={vid}" if vid else str(url_or_id).strip()
    out_path = Path(out_dir).resolve()
    out_path.mkdir(parents=True, exist_ok=True)

    # 1. Obtener metadatos
    ydl_opts_info = {"quiet": quiet, "no_warnings": True}
    with yt_dlp.YoutubeDL(ydl_opts_info) as ydl:
        info = ydl.extract_info(url, download=False)
        title = sanitize_filename(info.get("title") or vid or "track")

    final_audio_path = out_path / f"{title}.{format}"
    thumb_path = out_path / "thumb.jpg" if download_thumbnail else None

    # Descargar thumbnail si se pide y aún no existe
    if download_thumbnail and not thumb_path.exists():
        thumb_url = info.get("thumbnail") or (f"https://i.ytimg.com/vi/{vid}/mqdefault.jpg" if vid else None)
        if thumb_url:
            try:
                import urllib.request
                urllib.request.urlretrieve(thumb_url, str(thumb_path))
            except Exception:
                pass

    if final_audio_path.exists():
        return final_audio_path, thumb_path, info

    # 2. Descargar audio con un identificador temporal seguro (sin caracteres especiales de glob)
    temp_prefix = f"raw_{vid or 'temp'}"
    temp_template = str(out_path / f"{temp_prefix}.%(ext)s")
    ydl_opts_download = {
        "format": "bestaudio/best",
        "outtmpl": temp_template,
        "quiet": quiet,
        "no_warnings": True,
    }
    with yt_dlp.YoutubeDL(ydl_opts_download) as ydl:
        ydl.download([url])

    # Encontrar archivo descargado buscando por el prefijo seguro
    matching = [f for f in out_path.iterdir() if f.name.startswith(f"{temp_prefix}.")]
    if not matching:
        raise RuntimeError("No se pudo localizar el archivo descargado de YouTube.")
    temp_file = matching[0]

    try:
        if format.lower() == "wav":
            convert_to_wav(temp_file, final_audio_path)
        else:
            ffmpeg_bin = shutil.which("ffmpeg")
            if not ffmpeg_bin:
                raise RuntimeError("ffmpeg requerido para transcodificar.")
            cmd = [
                ffmpeg_bin,
                "-y",
                "-i",
                str(temp_file),
                "-c:a",
                "aac",
                "-b:a",
                "256k",
                str(final_audio_path),
            ]
            subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return final_audio_path, thumb_path, info
    finally:
        if temp_file.exists():
            temp_file.unlink(missing_ok=True)


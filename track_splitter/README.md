# track-splitter (Backend Python & CLI)

Librería, worker y herramienta CLI en Python para descargar audio de YouTube, separar pistas musicales (*stems*: voz, batería, bajo, guitarra, piano, otros) y extraer curvas de afinación de forma 100% local. Actúa como el motor backend de **Pitch Maniac**.

---

## Archivos de configuración del entorno

- [`environment.yml`](../environment.yml): Definición del entorno Conda (`track-splitter`), Python 3.11, `ffmpeg` de `conda-forge` y paquetes pip.
- [`requirements.txt`](../requirements.txt): Dependencias pip (`torch`, `torchaudio`, `demucs`, `yt-dlp`, etc.).
- [`pyproject.toml`](../pyproject.toml): Metadatos del paquete Python y punto de entrada CLI `track-splitter`.
- [`.gitignore`](../.gitignore): Reglas de exclusión para temporales, modelos, archivos de audio generados y cachés.
- [`.vscode/settings.json`](../.vscode/settings.json): Intérprete Python predeterminado apuntando al entorno Conda `track-splitter`.

---

## Instalación y gestión del entorno

```bash
# 1. Crear el entorno por primera vez
conda env create -f environment.yml

# 2. Activar el entorno
conda activate track-splitter

# 3. Instalar la librería en modo editable
pip install -e .
```

Para salir del entorno:

```bash
conda deactivate
```

---

## Pistas (Stems) y Presets Disponibles

Puedes elegir cualquiera de estas pistas individuales o combinarlas:

| Nombre del Stem | Instrumento / Componente | Motor utilizado |
| :--- | :--- | :--- |
| `vocals` | Voz principal y coros | `htdemucs` o `Mel-Band Roformer` (`studio_vocals=True`) |
| `drums` | Batería y percusiones | `htdemucs` o `htdemucs_6s` |
| `bass` | Bajo | `htdemucs` o `htdemucs_6s` |
| `guitar` | Guitarra (eléctrica / acústica) | `htdemucs_6s` (activación automática) |
| `piano` | Teclados y piano | `htdemucs_6s` (activación automática) |
| `other` | Resto de instrumentos (sintetizadores, metales, etc.) | `htdemucs` o `htdemucs_6s` |

### Presets rápidos
También puedes pasar directamente un preset en `stems="..."`:
- `"all"`: Extrae todas las pistas disponibles (`vocals`, `drums`, `bass`, `other`).
- `"karaoke"`: Extrae toda la base instrumental sin la voz (`drums`, `bass`, `other`).
- `"acapella"`: Extrae únicamente la voz (`vocals`).
- `"rhythm"`: Extrae la base rítmica (`drums`, `bass`).

---

## Uso en Código Python

```python
from track_splitter import split, download, search

# 1. Separar pistas seleccionadas directamente desde YouTube o archivo local:
res = split("https://www.youtube.com/watch?v=dQw4w9WgXcQ", stems=["vocals", "guitar"])
print(res.stems["vocals"])  # Path a output/dQw4w9WgXcQ/stems/vocals.wav
print(res.stems["guitar"])  # Path a output/dQw4w9WgXcQ/stems/guitar.wav

# 2. Separar solo batería:
res = split("cancion.mp3", stems=["drums"])

# 3. Presets rápidos ('karaoke', 'acapella', 'rhythm', 'all'):
res = split("https://youtu.be/...", stems="karaoke")

# 4. Calidad de estudio para voces (Mel-Band Roformer):
res = split("https://youtu.be/...", stems=["vocals"], studio_vocals=True)

# 5. Solo descargar el audio sin separar:
wav_path = download("https://youtu.be/...", out_dir="downloads")

# 6. Buscar canciones en YouTube:
resultados = search("Bohemian Rhapsody", limit=3)
```

---

## Referencia del CLI (`track-splitter`)

```text
track-splitter [-h] [-s STEMS] [-o OUT] [--download-only] [--format {wav,m4a}]
               [--search QUERY] [--studio-vocals] [--fine-tuned]
               [--device {auto,mps,cuda,cpu}] [source]
```

### Argumentos y Opciones

| Opción / Flag | Parámetro | Por defecto | Descripción |
| :--- | :--- | :--- | :--- |
| `source` | `URL / ID / Archivo` | *Requerido (salvo `--search`)* | Enlace de YouTube (`https://...`), ID de video (ej. `dQw4w9WgXcQ`), o ruta a un archivo local (`.mp3`, `.wav`, `.m4a`, `.flac`). |
| `-s`, `--stems` | `STEMS` | `None` (todas) | Pistas a extraer separadas por coma (ej. `guitar,drums`, `vocals,bass`) o presets (`karaoke`, `acapella`, `rhythm`, `all`). |
| `-o`, `--out` | `DIRECTORIO` | `output` | Carpeta de destino donde se guardarán la mezcla y los stems. |
| `--download-only` | *(Flag)* | `False` | Solo descarga y convierte el audio de YouTube sin realizar separación de stems. |
| `--format` | `wav` \| `m4a` | `wav` | Formato de salida cuando se usa con `--download-only`. |
| `--search` | `QUERY` | - | Busca canciones en YouTube mostrando título, duración y URL en terminal. |
| `--studio-vocals` | *(Flag)* | `False` | Usa el modelo **Mel-Band Roformer** para aislar voces con calidad de estudio. |
| `--fine-tuned` | *(Flag)* | `False` | Usa el modelo refinado `htdemucs_ft` en lugar del estándar. |
| `--device` | `auto` \| `mps` \| `cuda` \| `cpu` | `auto` | Dispositivo de cómputo. `auto` detecta automáticamente Apple Silicon (`mps`) o NVIDIA (`cuda`). |
| `-h`, `--help` | *(Flag)* | - | Muestra el mensaje de ayuda con todas las opciones. |

---

## Ejemplos Rápidos de Comandos CLI

```bash
# 1. Separar guitarra y batería desde YouTube
track-splitter "https://www.youtube.com/watch?v=wMsazR6Tnf8" -s guitar,drums

# 2. Separar solo voz y bajo desde un MP3 local
track-splitter ./mi_cancion.mp3 -s vocals,bass

# 3. Base instrumental completa (preset Karaoke)
track-splitter "https://youtu.be/..." -s karaoke

# 4. Solo voces con calidad de estudio (Mel-Band Roformer)
track-splitter "https://youtu.be/..." -s vocals --studio-vocals

# 5. Guardar en una carpeta personalizada
track-splitter "https://youtu.be/..." -s drums -o ./mis_baterias

# 6. Solo descargar el audio en WAV sin separar
track-splitter "https://youtu.be/..." --download-only

# 7. Solo descargar en formato M4A / AAC
track-splitter "https://youtu.be/..." --download-only --format m4a

# 8. Buscar canciones en YouTube
track-splitter --search "Queen Radio Ga Ga"
```

---

## Worker para Pitch Maniac (`worker.py`)

La aplicación de escritorio invoca `track_splitter/worker.py` desde Tauri para:
- `list`: listar canciones procesadas en la biblioteca local (`~/.cache/pitch-maniac`).
- `search <query>`: buscar pistas en YouTube.
- `process <source> [--roformer]`: descargar/convertir audio, separar `vocals.wav` y `no_vocals.wav`, extraer `pitch.json` (YIN) y guardar metadatos.
- `save-lyrics <song_id> <lyrics>`: guardar letras asociadas a una canción.
- `delete <song_id>`: eliminar una canción de la biblioteca local.


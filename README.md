# track-splitter

Librería y herramienta CLI en Python minimalista para descargar audio de YouTube y separar pistas musicales (*stems*: voz, batería, bajo, guitarra, piano, otros) de forma 100% local, inspirada en la arquitectura de **StemKit**.

---

## Estructura de archivos de configuración (Entorno estilo `py-playground`)

- [`environment.yml`](file:///Users/francomolochegarcia/dev/test-proj-26-11/track-splitter/environment.yml): Definición del entorno Conda (`track-splitter`), versión de Python 3.11, `ffmpeg` de conda-forge y paquetes pip.
- [`requirements.txt`](file:///Users/francomolochegarcia/dev/test-proj-26-11/track-splitter/requirements.txt): Requisitos de paquetes pip (`torch`, `demucs`, `yt-dlp`, etc.).
- [`.gitignore`](file:///Users/francomolochegarcia/dev/test-proj-26-11/track-splitter/.gitignore): Reglas de exclusión para temporales, modelos, archivos de audio generados y cachés.
- [`.vscode/settings.json`](file:///Users/francomolochegarcia/dev/test-proj-26-11/track-splitter/.vscode/settings.json): Intérprete predeterminado apuntando al entorno de Conda.

---

## Uso y Gestión del Entorno

### 1. Crear el entorno por primera vez
```bash
conda env create -f environment.yml
```

### 2. Activar el entorno
```bash
conda activate track-splitter
```

### 3. Instalar la librería en modo editable
```bash
pip install -e .
```

### 4. Desactivar el entorno
```bash
conda deactivate
```

---

## Uso en Código Python (Mínima Verbosidad)

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

## Uso desde Línea de Comandos (CLI)

```bash
# Separar voz y guitarra desde YouTube
track-splitter "https://www.youtube.com/watch?v=dQw4w9WgXcQ" -s vocals,guitar

# Separar con preset karaoke desde un archivo local
track-splitter ./mi_cancion.mp3 -s karaoke

# Solo descargar el audio en WAV
track-splitter "https://youtu.be/..." --download-only

# Buscar canciones en YouTube
track-splitter --search "Queen Radio Ga Ga"
```


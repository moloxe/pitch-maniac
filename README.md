# Pitch Maniac

Aplicación de escritorio de **Karaoke y Visualización de Afinación Vocal en Tiempo Real**, construida con **Tauri v2 + React + TypeScript** y respaldada por **`track-splitter`** como motor backend en Python para descarga de audio, separación de stems y análisis de pitch de forma 100% local.

---

## Características Principales

- **Separación vocal local**: Aísla voz (`vocals.wav`) y acompañamiento (`no_vocals.wav`) usando **Demucs** (`htdemucs` / `htdemucs_6s`) o **Mel-Band Roformer** para máxima calidad vocal.
- **Extracción de curva de tono (YIN)**: Genera la referencia melódica de la canción (`pitch.json`) mediante análisis YIN sobre la pista vocal.
- **Visualizador de afinación en tiempo real**: Captura tu voz por micrófono y compara tu entonación al instante frente a la guía vocal de la canción.
- **Reproductor multipista sincronizado**: Control independiente de presencia vocal para practicar sobre la voz original o cantar en modo karaoke puro.
- **Buscador y descarga de YouTube + archivos locales**: Busca canciones directamente desde la interfaz o importa audio local (`.mp3`, `.wav`, `.m4a`, `.flac`).
- **Letras y biblioteca local**: Guarda letras y gestiona tus canciones procesadas en `~/.cache/pitch-maniac`.

---

## Arquitectura y Estructura del Proyecto

```text
pitch-maniac/
├── app/                   # Aplicación de escritorio (Frontend + Tauri/Rust)
│   ├── src/               # React 19, TypeScript, Tailwind CSS v4, visualizador YIN y reproductor
│   └── src-tauri/         # Backend Tauri v2 en Rust (comandos IPC y puente con Python)
├── track_splitter/        # Backend principal en Python (descarga, Demucs/Roformer, YIN, librería)
│   └── worker.py          # Punto de entrada invocado por Tauri para procesar y gestionar canciones
├── tests/                 # Suite de tests Python (pytest)
├── environment.yml        # Definición del entorno Conda (`track-splitter`)
├── pyproject.toml         # Configuración del paquete Python `track-splitter`
└── package.json           # Scripts de desarrollo unificados desde la raíz
```

El frontend en `app/` se comunica mediante comandos Tauri (`app/src-tauri/src/lib.rs`) con `track_splitter/worker.py`, ejecutado con el entorno Conda `track-splitter`.

---

## Requisitos Previos

- **Conda** (Anaconda o Miniconda) para el entorno Python 3.11 + `ffmpeg`
- **Bun** (gestor de paquetes y runner para el frontend)
- **Rust / Cargo** (para compilar el host Tauri v2)

---

## Instalación y Configuración

### 1. Configurar el backend Python (`track-splitter`)

```bash
conda env create -f environment.yml
conda activate track-splitter
pip install -e .
```

### 2. Instalar dependencias del frontend

```bash
bun install --cwd app
```

---

## Desarrollo

Desde la raíz del repositorio tienes atajos en `package.json`:

```bash
# Iniciar la app de escritorio completa (Vite + Tauri)
bun run dev

# Iniciar solo el servidor web de desarrollo (Vite)
bun run dev:web

# Compilar el frontend (TypeScript + Vite)
bun run build

# Ejecutar la suite de tests del backend Python (con el entorno conda activo)
bun run test
```

También puedes correr `pytest` directamente con el intérprete del entorno:

```bash
/opt/anaconda3/envs/track-splitter/bin/python -m pytest
```

---

## Backend `track-splitter` (CLI y API Python)

Además de impulsar Pitch Maniac, `track_splitter` sigue disponible como librería Python y herramienta CLI (`track-splitter`) para descargar audio de YouTube o separar pistas individuales (`vocals`, `drums`, `bass`, `guitar`, `piano`, `other`).

```bash
# Ejemplo rápido por CLI
track-splitter "https://youtu.be/..." -s karaoke
```

Consulta la documentación completa de la API Python, presets, flags y ejemplos en [track_splitter/README.md](track_splitter/README.md).

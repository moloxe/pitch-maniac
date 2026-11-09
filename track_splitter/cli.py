import argparse
import sys
from pathlib import Path
from . import split, download, search


def main():
    parser = argparse.ArgumentParser(
        prog="track-splitter",
        description="Descarga y separa pistas de audio de YouTube o archivos locales sin UI.",
    )
    parser.add_argument("source", nargs="?", help="URL/ID de YouTube o ruta a un archivo de audio local.")
    parser.add_argument(
        "-s",
        "--stems",
        default=None,
        help="Pistas a extraer separadas por coma (ej. 'vocals,guitar' o 'drums') o presets ('karaoke', 'acapella').",
    )
    parser.add_argument(
        "-o",
        "--out",
        default="output",
        help="Directorio de salida (por defecto: 'output').",
    )
    parser.add_argument(
        "--download-only",
        action="store_true",
        help="Solo descarga y convierte el audio de YouTube sin separar pistas.",
    )
    parser.add_argument(
        "--format",
        choices=["wav", "m4a"],
        default="wav",
        help="Formato de audio para --download-only (por defecto: 'wav').",
    )
    parser.add_argument(
        "--search",
        metavar="QUERY",
        help="Busca canciones en YouTube y muestra los resultados.",
    )
    parser.add_argument(
        "--studio-vocals",
        action="store_true",
        help="Usa Mel-Band Roformer para aislar voces de estudio.",
    )
    parser.add_argument(
        "--fine-tuned",
        action="store_true",
        help="Usa el modelo refinado htdemucs_ft.",
    )
    parser.add_argument(
        "--device",
        default="auto",
        choices=["auto", "mps", "cuda", "cpu"],
        help="Dispositivo de aceleración (auto detecta MPS o CUDA).",
    )

    args = parser.parse_args()

    # Modo búsqueda
    if args.search:
        results = search(args.search, limit=5)
        if not results:
            print("No se encontraron resultados.")
            return
        print(f"\nResultados para '{args.search}':")
        for i, r in enumerate(results, 1):
            dur = f"{r['duration']}s" if r.get("duration") else "N/A"
            print(f"[{i}] {r['title']} ({dur}) - {r['url']}")
        return

    if not args.source:
        parser.print_help()
        sys.exit(1)

    # Modo solo descarga
    if args.download_only:
        print(f"Descargando audio de {args.source}...")
        path = download(args.source, out_dir=args.out, format=args.format, quiet=False)
        print(f"Descarga lista en: {path}")
        return

    # Modo separación
    print(f"Procesando: {args.source}")
    stems_desc = args.stems or "todas"
    print(f"Separando pistas ({stems_desc}) en {args.device}...")
    result = split(
        source=args.source,
        stems=args.stems,
        out_dir=args.out,
        studio_vocals=args.studio_vocals,
        fine_tuned=args.fine_tuned,
        device=args.device,
    )

    print(f"\n¡Completado con éxito!")
    print(f"Título: {result.title}")
    print(f"Motor: {result.model} ({result.device})")
    print(f"Mezcla original: {result.mix}")
    print("Stems generados:")
    for name, p in result.stems.items():
        print(f"  - {name}: {p}")


if __name__ == "__main__":
    main()


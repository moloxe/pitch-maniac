import argparse
import json
import sys
from pathlib import Path

# Add project root to sys.path if not present
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from track_splitter.downloader import search
from track_splitter.library import load_library, delete_song, save_song_lyrics, get_song
from track_splitter.karaoke import separate_karaoke_pair
from track_splitter.lyrics import fetch_lyrics


def main():
    parser = argparse.ArgumentParser(description="Pitch Maniac Python Worker")
    subparsers = parser.add_subparsers(dest="command")

    # Command: process
    proc_p = subparsers.add_parser("process")
    proc_p.add_argument("source", help="YouTube URL/ID or local audio file")
    proc_p.add_argument("--device", default="auto", help="Compute device (auto, mps, cpu, cuda)")
    proc_p.add_argument("--roformer", action="store_true", help="Use Mel-Band Roformer for vocals")

    # Command: list
    subparsers.add_parser("list")

    # Command: delete
    del_p = subparsers.add_parser("delete")
    del_p.add_argument("song_id", help="Song ID to delete")

    # Command: save-lyrics
    lyr_p = subparsers.add_parser("save-lyrics")
    lyr_p.add_argument("song_id", help="Song ID")
    lyr_p.add_argument("lyrics", help="Lyrics text")

    # Command: fetch-lyrics
    flyr_p = subparsers.add_parser("fetch-lyrics")
    flyr_p.add_argument("song_id", help="Song ID")

    # Command: search
    s_p = subparsers.add_parser("search")
    s_p.add_argument("query", help="YouTube search query")
    s_p.add_argument("--limit", type=int, default=10, help="Max results")

    args = parser.parse_args()

    if args.command == "process":
        def on_prog(msg: str, frac: float):
            sys.stderr.write(f"PROGRESS:{frac:.2f}:{msg}\n")
            sys.stderr.flush()

        try:
            record = separate_karaoke_pair(
                source=args.source,
                device=args.device,
                use_roformer=args.roformer,
                progress_callback=on_prog,
            )
            print(json.dumps({"success": True, "song": record}))
        except Exception as e:
            sys.stderr.write(f"ERROR: {str(e)}\n")
            print(json.dumps({"success": False, "error": str(e)}))
            sys.exit(1)

    elif args.command == "list":
        songs = load_library()
        print(json.dumps({"success": True, "songs": songs}))

    elif args.command == "delete":
        deleted = delete_song(args.song_id)
        print(json.dumps({"success": deleted}))

    elif args.command == "save-lyrics":
        ok = save_song_lyrics(args.song_id, args.lyrics)
        print(json.dumps({"success": ok}))

    elif args.command == "fetch-lyrics":
        song = get_song(args.song_id)
        if not song:
            print(json.dumps({"success": False, "found": False, "error": "Song not found"}))
            sys.exit(1)
        try:
            res = fetch_lyrics(
                title=song.get("title", ""),
                artist=song.get("artist", ""),
                duration=song.get("duration"),
                source_url=song.get("source_url"),
            )
            if res.get("found"):
                save_song_lyrics(
                    args.song_id,
                    res.get("lyrics") or "",
                    synced_lyrics=res.get("synced_lyrics"),
                )
            print(
                json.dumps(
                    {
                        "success": True,
                        "found": bool(res.get("found")),
                        "lyrics": res.get("lyrics") or "",
                        "synced_lyrics": res.get("synced_lyrics"),
                        "source": res.get("source"),
                    }
                )
            )
        except Exception as e:
            print(json.dumps({"success": False, "found": False, "error": str(e)}))
            sys.exit(1)

    elif args.command == "search":
        results = search(args.query, limit=args.limit)
        print(json.dumps({"success": True, "results": results}))

    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()

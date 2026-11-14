import json
import re
import unicodedata
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

LRCLIB_SEARCH_URL = "https://lrclib.net/api/search"
USER_AGENT = "PitchManiac/1.0 (https://github.com/pitch-maniac)"

_NOISE_PARENS_RE = re.compile(
    r"[\(\[\{]\s*(?:official\s*(?:music\s*)?(?:video|audio|lyric\s*video|visualizer)|"
    r"video\s*oficial|audio\s*oficial|lyric\s*video|lyrics?|letra|hd|4k|8k|"
    r"remastered(?:\s*\d{2,4})?|live|en\s*vivo|explicit|clean|version|visualizer|"
    r"sub\s*español|subtitulad[oa])\b[^)\]\}]*[\)\]\}]",
    re.IGNORECASE,
)
_ANY_BRACKETS_RE = re.compile(r"\[[^\]]+\]")
_FEAT_RE = re.compile(r"\b(?:feat\.?|ft\.?|featuring)\b.*$", re.IGNORECASE)
_ARTIST_NOISE_RE = re.compile(r"\s*(?:-|•)?\s*\b(?:topic|vevo|official|music)\b\s*$", re.IGNORECASE)
_LRC_TAG_RE = re.compile(r"^\s*\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?\]\s*(.*)$")


def _strip_accents(text: str) -> str:
    nfkd = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in nfkd if not unicodedata.combining(ch))


def _tokenize(text: str) -> set[str]:
    norm = _strip_accents(text).lower()
    return {tok for tok in re.findall(r"[a-z0-9]+", norm) if len(tok) > 1}


def clean_title(raw_title: str) -> str:
    """Remove common YouTube video/audio tags while keeping artist/track text."""
    text = str(raw_title or "").strip()
    text = _NOISE_PARENS_RE.sub(" ", text)
    text = _ANY_BRACKETS_RE.sub(" ", text)
    text = re.sub(r"\s{2,}", " ", text).strip(" -|•")
    return text


def clean_artist(raw_artist: str) -> str:
    """Normalize uploader/artist string, ignoring generic placeholders."""
    text = str(raw_artist or "").strip()
    if text.lower() in {"", "unknown", "unknown artist", "various artists"}:
        return ""
    text = _ARTIST_NOISE_RE.sub("", text).strip(" -|•")
    return text


def strip_lrc_timestamps(synced_lyrics: str) -> str:
    """Convert LRC-formatted lyrics into plain multi-line text."""
    lines: List[str] = []
    for raw_line in synced_lyrics.splitlines():
        m = _LRC_TAG_RE.match(raw_line)
        if m:
            content = m.group(4).strip()
            if content:
                lines.append(content)
        else:
            stripped = raw_line.strip()
            if stripped and not re.match(r"^\[[a-zA-Z]+:.*\]$", stripped):
                lines.append(stripped)
    return "\n".join(lines).strip()


def _split_artist_track(cleaned_title: str) -> Optional[Tuple[str, str]]:
    for sep in (" - ", " – ", " — "):
        if sep in cleaned_title:
            left, right = cleaned_title.split(sep, 1)
            left, right = left.strip(), right.strip()
            if left and right:
                return left, right
    return None


def _build_search_queries(title: str, artist: str) -> Tuple[List[Dict[str, str]], set[str], set[str]]:
    c_title = clean_title(title)
    c_artist = clean_artist(artist)
    split = _split_artist_track(c_title)

    expected_artist_tokens = _tokenize(c_artist)
    expected_track_tokens = _tokenize(c_title)

    queries: List[Dict[str, str]] = []
    seen: set[Tuple[Tuple[str, str], ...]] = set()

    def add_query(params: Dict[str, str]):
        cleaned_params = {k: v.strip() for k, v in params.items() if v and v.strip()}
        if not cleaned_params:
            return
        key = tuple(sorted(cleaned_params.items()))
        if key not in seen:
            seen.add(key)
            queries.append(cleaned_params)

    if split:
        left, right = split
        right_no_feat = _FEAT_RE.sub("", right).strip()
        expected_artist_tokens |= _tokenize(left)
        expected_track_tokens = _tokenize(right_no_feat or right)

        add_query({"track_name": right_no_feat or right, "artist_name": left})
        add_query({"q": f"{left} {right_no_feat or right}"})
        if right_no_feat and right_no_feat != right:
            add_query({"q": f"{left} {right}"})

    title_no_feat = _FEAT_RE.sub("", c_title).strip()
    if c_artist:
        title_norm = _strip_accents(c_title).lower()
        artist_norm = _strip_accents(c_artist).lower()
        if artist_norm not in title_norm:
            add_query({"q": f"{title_no_feat or c_title} {c_artist}"})
            first_word = c_artist.split()[0]
            if len(c_artist.split()) > 1 and len(first_word) >= 3:
                add_query({"q": f"{title_no_feat or c_title} {first_word}"})
        if not split:
            add_query({"track_name": title_no_feat or c_title, "artist_name": c_artist})

    add_query({"q": c_title})
    if title_no_feat and title_no_feat != c_title:
        add_query({"q": title_no_feat})

    return queries, expected_artist_tokens, expected_track_tokens


def _score_candidate(
    item: Dict[str, Any],
    target_duration: Optional[float],
    expected_artist_tokens: set[str],
    expected_track_tokens: set[str],
) -> float:
    if item.get("instrumental"):
        return -1.0
    plain = (item.get("plainLyrics") or "").strip()
    synced = (item.get("syncedLyrics") or "").strip()
    if not plain and not synced:
        return -1.0

    score = 0.0
    item_dur = item.get("duration")
    if target_duration and target_duration > 0 and item_dur is not None:
        try:
            dur_diff = abs(float(item_dur) - float(target_duration))
        except (TypeError, ValueError):
            dur_diff = 0.0
        if dur_diff > 20.0:
            return -1.0
        score += max(0.0, 40.0 - dur_diff * 2.0)

    cand_artist_tokens = _tokenize(str(item.get("artistName") or ""))
    cand_track_tokens = _tokenize(str(item.get("trackName") or ""))

    if expected_artist_tokens and cand_artist_tokens:
        overlap = len(expected_artist_tokens & cand_artist_tokens) / len(expected_artist_tokens)
        score += overlap * 35.0

    if expected_track_tokens and cand_track_tokens:
        overlap = len(expected_track_tokens & cand_track_tokens) / len(expected_track_tokens)
        score += overlap * 25.0

    if synced:
        score += 10.0

    return score


def _query_lrclib(params: Dict[str, str], timeout: float = 8.0) -> List[Dict[str, Any]]:
    url = f"{LRCLIB_SEARCH_URL}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return data if isinstance(data, list) else []


def fetch_lrclib_lyrics(
    title: str,
    artist: str = "",
    duration: Optional[float] = None,
    timeout: float = 8.0,
) -> Optional[Dict[str, Any]]:
    """Query LRCLIB for plain and synced lyrics matching title/artist/duration."""
    queries, exp_artist_tokens, exp_track_tokens = _build_search_queries(title, artist)
    best_item: Optional[Dict[str, Any]] = None
    best_score = -1.0

    for params in queries:
        try:
            results = _query_lrclib(params, timeout=timeout)
        except Exception:
            continue

        for item in results:
            score = _score_candidate(item, duration, exp_artist_tokens, exp_track_tokens)
            if score > best_score:
                best_score = score
                best_item = item

        # Stop early once we have a high-confidence match
        if best_item is not None and best_score >= 50.0:
            break

    if best_item is None or best_score < 20.0:
        return None

    synced = (best_item.get("syncedLyrics") or "").strip() or None
    plain = (best_item.get("plainLyrics") or "").strip()
    if not plain and synced:
        plain = strip_lrc_timestamps(synced)

    if not plain:
        return None

    return {
        "lyrics": plain,
        "synced_lyrics": synced,
        "source": "lrclib",
        "track_name": best_item.get("trackName"),
        "artist_name": best_item.get("artistName"),
    }


def _ms_to_lrc_tag(ms: int) -> str:
    total_cs = max(0, ms // 10)
    minutes = total_cs // 6000
    seconds = (total_cs % 6000) // 100
    cs = total_cs % 100
    return f"[{minutes:02d}:{seconds:02d}.{cs:02d}]"


def _parse_json3_subtitles(payload: str) -> Tuple[str, Optional[str]]:
    data = json.loads(payload)
    plain_lines: List[str] = []
    lrc_lines: List[str] = []
    for ev in data.get("events", []):
        segs = ev.get("segs")
        if not segs:
            continue
        text = "".join(s.get("utf8", "") for s in segs).replace("\n", " ").strip()
        if not text or re.fullmatch(r"\[.*\]", text):
            continue
        plain_lines.append(text)
        start_ms = ev.get("tStartMs")
        if isinstance(start_ms, (int, float)):
            lrc_lines.append(f"{_ms_to_lrc_tag(int(start_ms))} {text}")

    plain = "\n".join(plain_lines).strip()
    synced = "\n".join(lrc_lines).strip() or None
    return plain, synced


def fetch_youtube_subtitles(source_url: str, timeout: float = 8.0) -> Optional[Dict[str, Any]]:
    """Attempt to extract manual or automatic captions from a YouTube video using yt-dlp."""
    try:
        import yt_dlp
    except ImportError:
        return None

    try:
        ydl_opts = {"quiet": True, "no_warnings": True, "skip_download": True}
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(source_url, download=False)
    except Exception:
        return None

    if not isinstance(info, dict):
        return None

    lang = str(info.get("language") or "").split("-")[0].lower()
    lang_order = [l for l in (lang, "es", "en") if l]

    for pool_key in ("subtitles", "automatic_captions"):
        pool = info.get(pool_key) or {}
        if not isinstance(pool, dict) or not pool:
            continue

        chosen_tracks = None
        for code in lang_order:
            if code in pool and pool[code]:
                chosen_tracks = pool[code]
                break
        if not chosen_tracks:
            # Fallback to first available language track
            for tracks in pool.values():
                if tracks:
                    chosen_tracks = tracks
                    break
        if not chosen_tracks:
            continue

        json3_entry = next((t for t in chosen_tracks if t.get("ext") == "json3" and t.get("url")), None)
        if not json3_entry:
            continue

        try:
            req = urllib.request.Request(json3_entry["url"], headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read().decode("utf-8")
            plain, synced = _parse_json3_subtitles(raw)
            if plain:
                return {
                    "lyrics": plain,
                    "synced_lyrics": synced,
                    "source": f"youtube_{pool_key}",
                }
        except Exception:
            continue

    return None


def fetch_lyrics(
    title: str,
    artist: str = "",
    duration: Optional[float] = None,
    source_url: Optional[str] = None,
) -> Dict[str, Any]:
    """Fetch lyrics via LRCLIB with optional YouTube captions fallback."""
    res = fetch_lrclib_lyrics(title=title, artist=artist, duration=duration)
    if res:
        return {"found": True, **res}

    if source_url:
        yt_res = fetch_youtube_subtitles(source_url)
        if yt_res:
            return {"found": True, **yt_res}

    return {"found": False, "lyrics": "", "synced_lyrics": None, "source": None}

"""
yt-dlp audio clip download, faster-whisper transcription, thumbnail fetch + EasyOCR.
Optional dependencies: yt-dlp, faster-whisper, easyocr — failures degrade gracefully.
"""
from __future__ import annotations

import os
import re
import tempfile
import urllib.request
from typing import Callable

# --- Optional imports ---
try:
    import yt_dlp

    _HAS_YTDLP = True
    try:
        from yt_dlp.utils import download_range_func
    except ImportError:
        download_range_func = None  # type: ignore
except ImportError:
    _HAS_YTDLP = False
    yt_dlp = None  # type: ignore
    download_range_func = None  # type: ignore

try:
    from faster_whisper import WhisperModel

    _HAS_FW = True
except ImportError:
    WhisperModel = None  # type: ignore
    _HAS_FW = False

try:
    import easyocr

    _HAS_EASYOCR = True
except ImportError:
    easyocr = None  # type: ignore
    _HAS_EASYOCR = False

# First N seconds of audio only (clickbait signal in opening)
AUDIO_CLIP_SECONDS = int(os.environ.get("BYTEBAIT_AUDIO_CLIP_SEC", "300"))
WHISPER_MODEL_SIZE = os.environ.get("BYTEBAIT_WHISPER_MODEL", "base")

_whisper_model: object | None = None
_easyocr_reader: object | None = None


def _get_whisper():
    global _whisper_model
    if not _HAS_FW or WhisperModel is None:
        return None
    if _whisper_model is None:
        _whisper_model = WhisperModel(
            WHISPER_MODEL_SIZE,
            device=os.environ.get("BYTEBAIT_WHISPER_DEVICE", "cpu"),
            compute_type=os.environ.get("BYTEBAIT_WHISPER_COMPUTE", "int8"),
        )
    return _whisper_model


def _get_easyocr_reader():
    global _easyocr_reader
    if not _HAS_EASYOCR or easyocr is None:
        return None
    if _easyocr_reader is None:
        # Urdu + English for code-switching
        _easyocr_reader = easyocr.Reader(
            ["ur", "en"],
            gpu=os.environ.get("BYTEBAIT_OCR_GPU", "").lower() in ("1", "true", "yes"),
        )
    return _easyocr_reader


def ytdlp_get_info(video_url: str) -> dict | None:
    if not _HAS_YTDLP:
        return None
    try:
        opts: dict = {"quiet": True, "no_warnings": True, "skip_download": True}
        with yt_dlp.YoutubeDL(opts) as ydl:
            return ydl.extract_info(video_url, download=False)
    except Exception as e:
        print(f"⚠️ yt-dlp extract_info failed: {e}")
        return None


def ytdlp_get_thumbnail_url(video_url: str) -> str | None:
    info = ytdlp_get_info(video_url)
    if not info:
        return None
    thumbs = info.get("thumbnails") or []
    if thumbs:
        return thumbs[-1].get("url") or thumbs[-1].get("url_fragment")
    return info.get("thumbnail")


def ytdlp_download_audio_clip(video_url: str, progress_hook: Callable[[str], None] | None = None) -> str | None:
    """Download ~first AUDIO_CLIP_SECONDS of audio; returns path to audio file (mp3/m4a) or None."""
    if not _HAS_YTDLP:
        return None
    if download_range_func is None:
        print("⚠️ yt-dlp has no download_range_func; upgrade yt-dlp and install FFmpeg on PATH for audio fallback.")
        return None
    work = tempfile.mkdtemp(prefix="bytebait_a_")
    outtmpl = os.path.join(work, "clip.%(ext)s")
    opts: dict = {
        "quiet": True,
        "no_warnings": True,
        "format": "bestaudio/best",
        "outtmpl": outtmpl,
        "download_ranges": download_range_func(None, [(0, AUDIO_CLIP_SECONDS)]),
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "96",
            }
        ],
    }

    def _hook(d: dict):
        if progress_hook and d.get("status") == "downloading":
            progress_hook("Downloading audio clip…")

    if progress_hook:
        opts["progress_hooks"] = [_hook]

    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download([video_url])
        for name in os.listdir(work):
            if name.endswith((".mp3", ".m4a", ".opus", ".webm")):
                return os.path.join(work, name)
        return None
    except Exception as e:
        print(f"⚠️ yt-dlp audio download failed: {e}")
        return None


def transcribe_audio_faster_whisper(audio_path: str, progress_hook: Callable[[str], None] | None = None) -> str:
    model = _get_whisper()
    if model is None:
        return ""
    if progress_hook:
        progress_hook("Transcribing with Faster-Whisper…")
    try:
        # auto-detect language preserves code-switching better than forcing ur only
        segments, _info = model.transcribe(
            audio_path,
            language=None,
            task="transcribe",
            vad_filter=True,
            beam_size=1,
        )
        parts: list[str] = []
        for seg in segments:
            parts.append(seg.text.strip())
        text = " ".join(p for p in parts if p).strip()
        return text.encode("utf-8", errors="ignore").decode("utf-8")
    except Exception as e:
        print(f"⚠️ Faster-Whisper failed: {e}")
        return ""


def ocr_image_from_url(image_url: str, progress_hook: Callable[[str], None] | None = None) -> str:
    reader = _get_easyocr_reader()
    if not reader or not image_url:
        return ""
    if progress_hook:
        progress_hook("Reading thumbnail text (EasyOCR)…")
    path = None
    try:
        req = urllib.request.Request(image_url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=25) as resp:
            data = resp.read()
        fd, path = tempfile.mkstemp(suffix=".jpg")
        os.close(fd)
        with open(path, "wb") as f:
            f.write(data)
        result = reader.readtext(path, detail=0, paragraph=True)
        if isinstance(result, list):
            lines = [str(x).strip() for x in result if x]
        else:
            lines = [str(result).strip()] if result else []
        text = " ".join(lines).strip()
        return text.encode("utf-8", errors="ignore").decode("utf-8")
    except Exception as e:
        print(f"⚠️ EasyOCR / thumbnail fetch failed: {e}")
        return ""
    finally:
        if path and os.path.isfile(path):
            try:
                os.remove(path)
            except OSError:
                pass


def cleanup_audio_workdir(audio_path: str | None):
    if not audio_path:
        return
    try:
        d = os.path.dirname(audio_path)
        if d and os.path.isdir(d) and "bytebait_a_" in d:
            for name in os.listdir(d):
                try:
                    os.remove(os.path.join(d, name))
                except OSError:
                    pass
            os.rmdir(d)
    except Exception:
        pass

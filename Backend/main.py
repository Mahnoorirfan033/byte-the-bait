import os
os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"
import json
import re
import uvicorn
import pickle
import numpy as np
from datetime import timedelta
from typing import Optional
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from youtube_transcript_api import YouTubeTranscriptApi
import yt_dlp
from supabase import Client, create_client

# --- 1. INITIALIZATION & MODULE CHECK ---
app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

try:
    from faster_whisper import WhisperModel
    print("System: Initializing Faster-Whisper (Int8 Optimized)...")
    WHISPER_MODEL = WhisperModel("base", device="cpu", compute_type="int8")
except ImportError:
    WHISPER_MODEL = None
    print("WARNING: faster_whisper not found.")

# Check for your specific cookie file
COOKIE_FILE = "cookies (2).txt" if os.path.exists("cookies (2).txt") else "cookies.txt"

class VideoRequest(BaseModel):
    url: str
    user_id: Optional[str] = None

def load_env_file(env_path: str = ".env") -> None:
    if not os.path.exists(env_path): return
    try:
        with open(env_path, "r", encoding="utf-8") as env_file:
            for raw_line in env_file:
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line: continue
                key, value = line.split("=", 1)
                key, value = key.strip(), value.strip().strip('"').strip("'")
                if key and key not in os.environ: os.environ[key] = value
    except Exception as exc: print(f"WARNING: Could not load .env file: {exc}")

def parse_views_count(views: str) -> int:
    try: return int(str(views).replace(",", "").strip())
    except: return 0

load_env_file()
SUPABASE_URL = os.getenv("https://ksoppcjuifkgerllzehc.supabase.co")
SUPABASE_ANON_KEY = os.getenv("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtzb3BwY2p1aWZrZ2VybGx6ZWhjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3MDYwNTgsImV4cCI6MjA5MjI4MjA1OH0.eAeFhQRfiCp2qOZgQh0bX4gZiKm_BtWkd7xWJHj6DrI")
supabase: Optional[Client] = None

if SUPABASE_URL and SUPABASE_ANON_KEY:
    try:
        supabase = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
        print("System: Supabase client initialized.")
    except Exception as exc: print(f"WARNING: Supabase client initialization failed: {exc}")

def save_analysis_to_db(*, user_id, video_url, video_id, meta, transcript_text, transcript_source, clickbait_percentage, status="success", error_message=None):
    if supabase is None or not user_id: return
    payload = {
        "user_id": user_id, "video_url": video_url, "video_id": video_id,
        "video_title": meta.get("title", "Unknown"), "channel_name": meta.get("channel", "Unknown"),
        "views": parse_views_count(meta.get("views", 0)), "duration": meta.get("duration", "0"),
        "transcript_source": transcript_source, "transcript_text": transcript_text[:1000],
        "clickbait_percentage": int(clickbait_percentage), "status": status, "error_message": error_message,
    }
    try:
        supabase.table("video_analyses").insert(payload).execute()
        print("System: Analysis saved to database.")
    except Exception as exc: print(f"WARNING: Failed to save analysis to database: {exc}")

# --- 2. TRANSCRIPT LOGIC ---
async def get_transcript_advanced(url, vid_id):
    try:
        data = YouTubeTranscriptApi.get_transcript(vid_id, languages=['ur', 'en', 'hi'])
        return " ".join([t['text'] for t in data]), "Official API"
    except: pass
    if WHISPER_MODEL is None: return "AI Module missing. Using video description for analysis.", "Description Only"
    audio_file = f"audio_{vid_id}.mp3"
    try:
        ydl_opts = {
            'format': 'bestaudio/best', 'outtmpl': f'audio_{vid_id}', 'quiet': True,
            'cookiefile': COOKIE_FILE if os.path.exists(COOKIE_FILE) else None,
            'postprocessors': [{'key': 'FFmpegExtractAudio','preferredcodec': 'mp3'}],
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl: ydl.download([url])
        segments, _ = WHISPER_MODEL.transcribe(audio_file, beam_size=5)
        text = " ".join([seg.text for seg in segments])
        return text, "AI Deep Scan (Whisper)"
    except Exception as e: return f"Extraction failed: {str(e)}", "Failed"
    finally:
        if os.path.exists(audio_file): os.remove(audio_file)

# --- 3. API ENDPOINTS ---
@app.post("/analyze")
async def analyze(req: VideoRequest):
    async def process_video():
        url, user_id = req.url, req.user_id
        vid_id_match = re.search(r"(?:v=|\/)([0-9A-Za-z_-]{11}).*", url)
        vid_id = vid_id_match.group(1) if vid_id_match else "unknown"
        yield json.dumps({"status": "processing", "message": "📡 Connecting to YouTube..."}) + "\n"

        meta = {"title": "Unknown", "views": "0", "channel": "Unknown", "duration": "0", "upload_date": "", "description": ""}
        try:
            with yt_dlp.YoutubeDL({'quiet': True, 'cookiefile': COOKIE_FILE if os.path.exists(COOKIE_FILE) else None}) as ydl:
                info = ydl.extract_info(url, download=False)
                meta = {
                    "title": info.get("title", "Video"), "views": f"{info.get('view_count', 0):,}",
                    "channel": info.get("uploader", "Unknown"), "duration": str(timedelta(seconds=info.get("duration", 0))),
                    "upload_date": info.get("upload_date") or info.get("release_date") or "", "description": (info.get("description") or "").strip(),
                }
        except: pass

        yield json.dumps({"status": "metadata", **meta}) + "\n"
        yield json.dumps({"status": "processing", "message": "🧠 Analyzing Context..."}) + "\n"

        transcript, source = await get_transcript_advanced(url, vid_id)

        # --- HEURISTIC CLICKBAIT ENGINE (REPLACING ML MODELS) ---
        title = meta["title"].lower()
        content = transcript.lower()
        
        # 1. Check for Sensationalism (Punctuation/Caps)
        sensational_score = (len(re.findall(r'[!?*#]', title)) * 15)
        
        # 2. Check for Clickbait Buzzwords (Urdu/English)
        buzzwords = ["shocking", "exposed", "amazing", "secret", "don't miss", "leak", "ثبوت", "انکشاف", "دیکھیں"]
        buzz_score = sum(20 for word in buzzwords if word in title)
        
        # 3. Mismatch Check (The most important logic)
        title_keywords = [w for w in title.split() if len(w) > 3]
        matches = sum(1 for w in title_keywords if w in content)
        
        mismatch_penalty = 0
        if len(title_keywords) > 0:
            mismatch_penalty = (1 - (matches / len(title_keywords))) * 100

        # Calculate Final Percentage
        clickbait_percentage = int((sensational_score + buzz_score + mismatch_penalty) / 2.5)
        clickbait_percentage = max(5, min(95, clickbait_percentage))

        result_payload = {
            "status": "success", "video_title": meta["title"], "channel_name": meta["channel"],
            "views": meta["views"], "duration": meta["duration"], "transcript_source": source,
            "clickbait_percentage": clickbait_percentage,
            "verdict": "POTENTIAL CLICKBAIT" if clickbait_percentage > 50 else "AUTHENTIC CONTENT",
            "reasoning": "Title contains sensationalist patterns and audio content mismatch." if clickbait_percentage > 50 else "The spoken content highly matches the provided title."
        }

        save_analysis_to_db(user_id=user_id, video_url=url, video_id=vid_id, meta=meta, 
                            transcript_text=transcript, transcript_source=source, 
                            clickbait_percentage=result_payload["clickbait_percentage"])

        yield json.dumps(result_payload) + "\n"

    return StreamingResponse(process_video(), media_type="application/x-ndjson")

# --- 4. AUTH ROUTES ---
class AuthRequest(BaseModel):
    email: str
    password: str

@app.post("/login")
async def login(req: AuthRequest): return {"status": "success", "user_id": "123"}

@app.post("/signup")
async def signup(req: AuthRequest): return {"status": "success", "user_id": "123"}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import re
import pickle
import numpy as np
import os
import sqlite3
from sentence_transformers import SentenceTransformer, util
from youtube_transcript_api import YouTubeTranscriptApi

# Import your custom logic
from utils.youtube_api import get_video_details
from app.preprocessing.text_cleaner import clean_urdu_text
from app.preprocessing.image_cleaner import prepare_thumbnail

app = FastAPI(title="Byte the Bait - Multimodal Detector")

# --- CORS SETUP (Essential for React Native Web) ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- 1. DATABASE SETUP ---
# Fixed pathing to ensure users.db stays in the root project folder
db_path = os.path.join(os.path.dirname(__file__), "users.db")
conn = sqlite3.connect(db_path, check_same_thread=False)
cursor = conn.cursor()

cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        username TEXT, 
        email TEXT,
        password TEXT
    )
""")
conn.commit()

# --- 2. MODELS FOR REQUEST DATA ---
class UserSignup(BaseModel):
    username: str
    email: str
    password: str 

class AnalysisRequest(BaseModel):
    video_url: str 

# --- 3. LOAD REAL MODELS ---
# Using safe pathing to find your .pkl files
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_FOLDER = os.path.join(BASE_DIR, "models")
LINGUISTIC_MODEL_PATH = os.path.join(MODEL_FOLDER, "urdu_text_classifier (1).pkl")
BOSS_MODEL_PATH = os.path.join(MODEL_FOLDER, "final_boss_model.pkl")

try:
    with open(LINGUISTIC_MODEL_PATH, 'rb') as f:
        tfidf, rf_model = pickle.load(f)
    with open(BOSS_MODEL_PATH, 'rb') as f:
        boss_model = pickle.load(f)
    # Multilingual model for Urdu/English comparison
    sim_model = SentenceTransformer('paraphrase-multilingual-MiniLM-L12-v2')
    print("✅ Real AI Models Loaded Successfully")
except Exception as e:
    print(f"⚠️ Warning: Models not found at {MODEL_FOLDER}. Backend will run in demo mode.")
    tfidf = rf_model = boss_model = sim_model = None

# YouTube Key
YOUTUBE_API_KEY = "AIzaSyAB1TVLYxK4wz-e7vZ1gHB6CsIfJEpU0nQ" 

# --- 4. UTILITY FUNCTIONS ---
def extract_video_id(url):
    pattern = r'(?:v=|\/)([0-9A-Za-z_-]{11}).*'
    match = re.search(pattern, url)
    return match.group(1) if match else None

# --- 5. ENDPOINTS ---

@app.post("/signup")
async def signup(user: UserSignup):
    try:
        cursor.execute(
            "INSERT INTO users (username, email, password) VALUES (?, ?, ?)", 
            (user.username, user.email, user.password)
        )
        conn.commit()
        return {"status": "Success", "message": f"Account created for {user.username}!"}
    except Exception as e:
        print(f"DB Error: {e}")
        raise HTTPException(status_code=500, detail="Database Error")

@app.post("/analyze")
async def analyze_video(data: AnalysisRequest):
    v_id = extract_video_id(data.video_url)
    if not v_id:
        raise HTTPException(status_code=400, detail="Invalid YouTube URL")

    # If models didn't load, return demo data so the frontend doesn't show a white screen
    if not boss_model:
        return {
            "is_clickbait": True,
            "score": 78.5,
            "video_metadata": {"title": "Demo Urdu Video", "thumbnail": ""},
            "details": {"linguistic": 12.5, "match": "45.0%"}
        }

    try:
        details = get_video_details(v_id, YOUTUBE_API_KEY)
        
        try:
            transcript_list = YouTubeTranscriptApi.get_transcript(v_id, languages=['ur', 'en'])
            transcript_text = " ".join([i['text'] for i in transcript_list])
        except:
            transcript_text = details.get('description', '')
            
        # --- Multimodal AI Logic ---
        cleaned_title = clean_urdu_text(details['title'])
        title_vec = tfidf.transform([cleaned_title])
        
        # 1. Linguistic Score
        ling_score = rf_model.predict_proba(title_vec)[0][1] * 15 

        # 2. Content Match Score
        emb_title = sim_model.encode(cleaned_title, convert_to_tensor=True)
        emb_content = sim_model.encode(transcript_text, convert_to_tensor=True)
        match_score = util.cos_sim(emb_title, emb_content).item()

        # 3. Final Prediction
        final_input = np.array([[ling_score, match_score]])
        prediction_idx = int(boss_model.predict(final_input)[0])
        probs = boss_model.predict_proba(final_input)[0]
        confidence = float(np.max(probs))

        return {
            "is_clickbait": True if prediction_idx == 1 else False,
            "score": round(confidence * 100, 1),
            "video_metadata": {
                "title": details['title'],
                "thumbnail": details['thumbnail']
            },
            "details": {
                "linguistic": round(ling_score, 2),
                "match": f"{match_score:.2%}"
            }
        }
    except Exception as e:
        print(f"Analysis Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)


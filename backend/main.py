# main.py
import os
import uuid
import json
import asyncio
from datetime import datetime
from typing import List, Dict, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import azure.cognitiveservices.speech as speechsdk

app = FastAPI(title="Meeting Recorder & Transcriber")

# CORS middleware để cho phép frontend kết nối
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Trong môi trường production, hãy thay bằng domain cụ thể
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Thay thế bằng key và region Azure Speech của bạn
AZURE_SPEECH_KEY = os.environ.get("AZURE_SPEECH_KEY", "your-azure-speech-key")
AZURE_SPEECH_REGION = os.environ.get("AZURE_SPEECH_REGION", "eastus")

# Lưu trữ phiên ghi âm
active_sessions = {}

class TranscriptionResult(BaseModel):
    session_id: str
    text: str
    speaker: Optional[str] = None
    timestamp: float


class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, List[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, session_id: str):
        await websocket.accept()
        if session_id not in self.active_connections:
            self.active_connections[session_id] = []
        self.active_connections[session_id].append(websocket)

    def disconnect(self, websocket: WebSocket, session_id: str):
        if session_id in self.active_connections:
            if websocket in self.active_connections[session_id]:
                self.active_connections[session_id].remove(websocket)
            if not self.active_connections[session_id]:
                del self.active_connections[session_id]

    async def broadcast(self, message: str, session_id: str):
        if session_id in self.active_connections:
            for connection in self.active_connections[session_id]:
                await connection.send_text(message)


manager = ConnectionManager()

def process_speech_with_azure(audio_data, session_id):
    """
    Xử lý audio bằng Azure Speech API với Speaker Diarization
    """
    # Cấu hình Azure Speech
    speech_config = speechsdk.SpeechConfig(subscription=AZURE_SPEECH_KEY, region=AZURE_SPEECH_REGION)
    speech_config.speech_recognition_language = "vi-VN"  # Cấu hình tiếng Việt, thay đổi nếu cần
    
    # Kích hoạt Speaker Diarization
    auto_detect_source_language_config = speechsdk.languageconfig.AutoDetectSourceLanguageConfig(
        languages=["vi-VN", "en-US"]  # Các ngôn ngữ bạn muốn hỗ trợ
    )
    
    # Cấu hình cho Speaker Diarization
    audio_config = speechsdk.audio.AudioConfig(filename=None, stream=audio_data)
    speech_recognizer = speechsdk.SpeechRecognizer(
        speech_config=speech_config, 
        audio_config=audio_config,
        auto_detect_source_language_config=auto_detect_source_language_config
    )

    # Đặt thuộc tính để kích hoạt Speaker Diarization
    speech_config.set_property(
        property_id=speechsdk.PropertyId.SpeechServiceConnection_TranslationVoice,
        value="TrueSpeaker"
    )

    # Xử lý kết quả
    result = speech_recognizer.recognize_once()

    if result.reason == speechsdk.ResultReason.RecognizedSpeech:
        # Trích xuất thông tin về người nói từ kết quả
        speaker_id = "Unknown"
        if hasattr(result, 'speaker_id') and result.speaker_id:
            speaker_id = f"Speaker {result.speaker_id}"
        
        return {
            "text": result.text,
            "speaker": speaker_id,
            "timestamp": datetime.now().timestamp()
        }
    else:
        # Trả về một chuỗi rỗng nếu không nhận diện được
        return {
            "text": "",
            "speaker": "Unknown",
            "timestamp": datetime.now().timestamp()
        }


@app.websocket("/ws/record/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    await manager.connect(websocket, session_id)
    
    if session_id not in active_sessions:
        active_sessions[session_id] = {
            "transcriptions": [],
            "start_time": datetime.now().timestamp()
        }
    
    try:
        while True:
            # Nhận dữ liệu audio từ client
            audio_data = await websocket.receive_bytes()
            
            # Xử lý audio bằng Azure Speech API
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(None, process_speech_with_azure, audio_data, session_id)
            
            if result and result["text"]:
                # Lưu kết quả
                active_sessions[session_id]["transcriptions"].append(result)
                
                # Broadcast kết quả đến tất cả các kết nối trong phiên
                await manager.broadcast(json.dumps(result), session_id)
    
    except WebSocketDisconnect:
        manager.disconnect(websocket, session_id)


@app.post("/start-session")
async def start_session():
    """
    Tạo phiên ghi âm mới
    """
    session_id = str(uuid.uuid4())
    active_sessions[session_id] = {
        "transcriptions": [],
        "start_time": datetime.now().timestamp()
    }
    return {"session_id": session_id}


@app.get("/session/{session_id}")
async def get_session(session_id: str):
    """
    Lấy thông tin về phiên ghi âm
    """
    if session_id not in active_sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    
    return active_sessions[session_id]


@app.post("/end-session/{session_id}")
async def end_session(session_id: str):
    """
    Kết thúc phiên ghi âm
    """
    if session_id not in active_sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    
    session_data = active_sessions[session_id]
    return {
        "session_id": session_id,
        "transcriptions": session_data["transcriptions"],
        "duration": datetime.now().timestamp() - session_data["start_time"]
    }


@app.post("/export/{session_id}")
async def export_transcription(session_id: str, format: str = "txt"):
    """
    Xuất bản ghi cuộc họp theo định dạng
    """
    if session_id not in active_sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    
    transcriptions = active_sessions[session_id]["transcriptions"]
    
    if format == "txt":
        content = ""
        for t in transcriptions:
            content += f"{t['speaker']} ({datetime.fromtimestamp(t['timestamp']).strftime('%H:%M:%S')}): {t['text']}\n\n"
        
        return {"content": content, "format": "txt"}
    
    elif format == "json":
        return {"content": transcriptions, "format": "json"}
    
    else:
        raise HTTPException(status_code=400, detail="Unsupported format")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
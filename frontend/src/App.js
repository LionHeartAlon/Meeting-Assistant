// src/App.js
import React, { useState, useEffect, useRef } from 'react';
import { Container, Box, Button, Typography, Paper, Tooltip } from '@mui/material';
import MicIcon from '@mui/icons-material/Mic';
import StopIcon from '@mui/icons-material/Stop';
import DownloadIcon from '@mui/icons-material/Download';
import AnalyticsIcon from '@mui/icons-material/Analytics';
import PersonIcon from '@mui/icons-material/Person';
import TimerIcon from '@mui/icons-material/Timer';
import './App.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [transcriptions, setTranscriptions] = useState([]);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [speakerCount, setSpeakerCount] = useState(0);
  const [recordingStatus, setRecordingStatus] = useState('');
  
  const mediaRecorderRef = useRef(null);
  const socketRef = useRef(null);
  const timerRef = useRef(null);
  const transcriptionEndRef = useRef(null);
  
  // Effect to scroll to the bottom of transcriptions
  useEffect(() => {
    if (transcriptionEndRef.current) {
      transcriptionEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [transcriptions]);

  // Effect to handle timer
  useEffect(() => {
    if (isRecording && !isPaused) {
      timerRef.current = setInterval(() => {
        setElapsedTime(prev => prev + 1);
      }, 1000);
      setRecordingStatus('Đang ghi âm...');
    } else if (isRecording && isPaused) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      setRecordingStatus('Tạm dừng');
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      setRecordingStatus('');
    }
    
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [isRecording, isPaused]);

  // Effect to count unique speakers
  useEffect(() => {
    if (transcriptions.length > 0) {
      const uniqueSpeakers = new Set(transcriptions.map(t => t.speaker));
      setSpeakerCount(uniqueSpeakers.size);
    } else {
      setSpeakerCount(0);
    }
  }, [transcriptions]);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    
    return `${mins.toString().padStart(2, '0')} : ${secs.toString().padStart(2, '0')}`;
  };

  const startRecording = async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      // Khởi tạo phiên mới
      const response = await fetch(`${API_URL}/start-session`, {
        method: 'POST',
      });
      
      if (!response.ok) {
        throw new Error('Failed to create a new session');
      }
      
      const data = await response.json();
      setSessionId(data.session_id);
      
      // Yêu cầu quyền truy cập microphone
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Thiết lập WebSocket
      const socket = new WebSocket(`ws://${API_URL.replace('http://', '')}/ws/record/${data.session_id}`);
      
      socket.onopen = () => {
        console.log('WebSocket connection established');
      };
      
      socket.onmessage = (event) => {
        try {
          const result = JSON.parse(event.data);
          // Thêm 3 giây độ trễ để hiển thị text
          setTimeout(() => {
            setTranscriptions(prev => [...prev, result]);
          }, 3000);
        } catch (e) {
          console.error('Error parsing WebSocket message:', e);
        }
      };
      
      socket.onerror = (error) => {
        console.error('WebSocket error:', error);
        setError('WebSocket connection error');
      };
      
      socketRef.current = socket;
      
      // Thiết lập MediaRecorder
      const mediaRecorder = new MediaRecorder(stream);
      let audioChunks = [];
      
      mediaRecorder.ondataavailable = (event) => {
        audioChunks.push(event.data);
        
        // Gửi audio chunks qua WebSocket
        if (socket.readyState === WebSocket.OPEN && audioChunks.length > 0) {
          const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
          socket.send(audioBlob);
          audioChunks = [];
        }
      };
      
      mediaRecorder.start(1000); // Capture mỗi 1 giây
      mediaRecorderRef.current = mediaRecorder;
      
      setIsRecording(true);
      setElapsedTime(0);
      setIsLoading(false);
      
    } catch (error) {
      console.error('Error starting recording:', error);
      setError(`Error starting recording: ${error.message}`);
      setIsLoading(false);
    }
  };

  const pauseRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      if (!isPaused) {
        mediaRecorderRef.current.pause();
        setIsPaused(true);
      } else {
        mediaRecorderRef.current.resume();
        setIsPaused(false);
      }
    }
  };

  const stopRecording = async () => {
    try {
      setIsLoading(true);
      
      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.stop();
        mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      }
      
      if (socketRef.current) {
        socketRef.current.close();
      }
      
      if (sessionId) {
        // Kết thúc phiên
        const response = await fetch(`${API_URL}/end-session/${sessionId}`, {
          method: 'POST',
        });
        
        if (!response.ok) {
          throw new Error('Failed to end session');
        }
      }
      
      setIsRecording(false);
      setIsPaused(false);
      setIsLoading(false);
      
    } catch (error) {
      console.error('Error stopping recording:', error);
      setError(`Error stopping recording: ${error.message}`);
      setIsLoading(false);
    }
  };

  const exportTranscription = async (format = 'txt') => {
    try {
      if (!sessionId) return;
      
      setIsLoading(true);
      
      const response = await fetch(`${API_URL}/export/${sessionId}?format=${format}`, {
        method: 'POST',
      });
      
      if (!response.ok) {
        throw new Error('Failed to export transcription');
      }
      
      const data = await response.json();
      
      // Tạo và tải file
      let content;
      let fileName;
      let type;
      
      if (format === 'txt') {
        content = data.content;
        fileName = `transcription_${new Date().toISOString().slice(0, 10)}.txt`;
        type = 'text/plain';
      } else if (format === 'json') {
        content = JSON.stringify(data.content, null, 2);
        fileName = `transcription_${new Date().toISOString().slice(0, 10)}.json`;
        type = 'application/json';
      }
      
      const blob = new Blob([content], { type });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      
      URL.revokeObjectURL(url);
      setIsLoading(false);
      
    } catch (error) {
      console.error('Error exporting transcription:', error);
      setError(`Error exporting transcription: ${error.message}`);
      setIsLoading(false);
    }
  };

  const analyzeTranscription = () => {
    alert('Chức năng phân tích đang được phát triển!');
  };

  return (
    <Container className="app-container">
      <Paper elevation={1} className="app-wrapper">
        <div className="app-content">
          {/* Sidebar */}
          <div className="sidebar">
            <div className="logo-section">
              <div className="audio-icon">
                <div className="bar"></div>
                <div className="bar"></div>
                <div className="bar"></div>
                <div className="bar"></div>
                <div className="bar"></div>
              </div>
              <Typography variant="h5" className="app-title">
                Meeting<br />Assistant
              </Typography>
            </div>

            <Button 
              variant="contained"
              className="control-button record-button"
              startIcon={<MicIcon />}
              onClick={startRecording}
              disabled={isRecording || isLoading}
            >
              Bắt đầu ghi âm
            </Button>

            <Button 
              variant="outlined" 
              className="control-button stop-button"
              startIcon={<StopIcon />}
              onClick={stopRecording}
              disabled={!isRecording || isLoading}
            >
              Dừng ghi âm
            </Button>

            <div className="timer-container">
              <div className="timer-display">
                {formatTime(elapsedTime)}
              </div>
              {recordingStatus && (
                <div className="recording-status">
                  <div className={`recording-indicator ${isRecording && !isPaused ? 'pulse' : ''}`}></div>
                  <span>{recordingStatus}</span>
                </div>
              )}
            </div>

            <Button 
              variant="outlined"
              className="control-button analyze-button"
              startIcon={<AnalyticsIcon />}
              onClick={analyzeTranscription}
              disabled={isLoading || transcriptions.length === 0}
            >
              Phân tích
            </Button>

            <Button 
              variant="outlined"
              className="control-button export-button"
              startIcon={<DownloadIcon />}
              onClick={() => exportTranscription('txt')}
              disabled={isLoading || transcriptions.length === 0}
            >
              Xuất file TXT
            </Button>

            {transcriptions.length > 0 && (
              <div className="stats-container">
                <Tooltip title="Số người nói">
                  <div className="stat-item">
                    <PersonIcon fontSize="small" />
                    <span>{speakerCount} người nói</span>
                  </div>
                </Tooltip>
                <Tooltip title="Thời lượng">
                  <div className="stat-item">
                    <TimerIcon fontSize="small" />
                    <span>{formatTime(elapsedTime)}</span>
                  </div>
                </Tooltip>
              </div>
            )}
          </div>

          {/* Transcript area */}
          <div className="transcript-area">
            <Typography variant="h5" className="transcript-title">
              Transcript
            </Typography>
            
            <div className="transcript-content">
              {transcriptions.length === 0 ? (
                <Typography variant="body1" className="empty-message">
                  Chưa có nội dung được ghi lại. Bắt đầu ghi âm để xem bản ghi tại đây.
                </Typography>
              ) : (
                transcriptions.map((item, index) => (
                  <div key={index} className="transcript-item">
                    <div className="transcript-header">
                      <Typography variant="subtitle2" className="speaker-info">
                        {item.speaker}
                      </Typography>
                      <Typography variant="caption" className="timestamp">
                        {new Date(item.timestamp * 1000).toLocaleTimeString()}
                      </Typography>
                    </div>
                    <Typography variant="body1" className="transcript-text">
                      {item.text}
                    </Typography>
                  </div>
                ))
              )}
              <div ref={transcriptionEndRef} />
            </div>
          </div>
        </div>
        
        <div className="app-footer">
          2025 General Technology
        </div>
      </Paper>
    </Container>
  );
}

export default App;
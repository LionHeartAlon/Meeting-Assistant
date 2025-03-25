// src/App.js
import React, { useState, useEffect, useRef } from 'react';
import { Container, Box, Button, Typography, Paper, Grid, IconButton, Divider, CircularProgress, Tooltip } from '@mui/material';
import MicIcon from '@mui/icons-material/Mic';
import StopIcon from '@mui/icons-material/Stop';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import SaveIcon from '@mui/icons-material/Save';
import DownloadIcon from '@mui/icons-material/Download';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
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
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    }
    
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [isRecording, isPaused]);

  const formatTime = (seconds) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
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

  const copyToClipboard = () => {
    const text = transcriptions.map(t => `${t.speaker} (${new Date(t.timestamp * 1000).toLocaleTimeString()}): ${t.text}`).join('\n\n');
    
    navigator.clipboard.writeText(text)
      .then(() => {
        alert('Transcription copied to clipboard!');
      })
      .catch(err => {
        console.error('Error copying to clipboard:', err);
        setError('Error copying to clipboard');
      });
  };

  return (
    <Container maxWidth="lg" className="app-container">
      <Paper elevation={3} className="main-paper">
        <Box className="header">
          <Typography variant="h4" component="h1">
            Meeting Recorder & Transcriber
          </Typography>
          
          <Box className="timer-display">
            <AccessTimeIcon />
            <Typography variant="h6">
              {formatTime(elapsedTime)}
            </Typography>
          </Box>
        </Box>
        
        <Divider />
        
        <Grid container spacing={2} className="content-area">
          <Grid item xs={12}>
            <Box className="controls">
              {!isRecording ? (
                <Button 
                  variant="contained" 
                  color="primary" 
                  startIcon={<MicIcon />}
                  onClick={startRecording}
                  disabled={isLoading}
                  className="control-button"
                >
                  Bắt đầu ghi âm
                </Button>
              ) : (
                <>
                  <Button 
                    variant="outlined" 
                    color="secondary" 
                    startIcon={<StopIcon />}
                    onClick={stopRecording}
                    disabled={isLoading}
                    className="control-button"
                  >
                    Kết thúc
                  </Button>
                  
                  <Button 
                    variant="outlined" 
                    color="primary" 
                    startIcon={isPaused ? <PlayArrowIcon /> : <PauseIcon />}
                    onClick={pauseRecording}
                    disabled={isLoading}
                    className="control-button"
                  >
                    {isPaused ? 'Tiếp tục' : 'Tạm dừng'}
                  </Button>
                </>
              )}
            </Box>
          </Grid>
          
          <Grid item xs={12}>
            <Paper elevation={2} className="transcription-area">
              <Typography variant="h6" className="section-title">
                Bản ghi cuộc họp
              </Typography>
              
              <Box className="transcription-content">
                {transcriptions.length === 0 ? (
                  <Typography variant="body1" className="empty-message">
                    Chưa có nội dung được ghi lại. Bắt đầu ghi âm để xem bản ghi tại đây.
                  </Typography>
                ) : (
                  transcriptions.map((item, index) => (
                    <Box key={index} className="transcription-item">
                      <Typography variant="subtitle2" className="speaker-info">
                        {item.speaker} ({new Date(item.timestamp * 1000).toLocaleTimeString()})
                      </Typography>
                      <Typography variant="body1" className="transcription-text">
                        {item.text}
                      </Typography>
                    </Box>
                  ))
                )}
                <div ref={transcriptionEndRef} />
              </Box>
            </Paper>
          </Grid>
          
          <Grid item xs={12}>
            <Box className="action-buttons">
              <Tooltip title="Lưu bản ghi dưới dạng văn bản">
                <IconButton 
                  color="primary"
                  onClick={() => exportTranscription('txt')}
                  disabled={isLoading || transcriptions.length === 0}
                >
                  <SaveIcon />
                </IconButton>
              </Tooltip>
              
              <Tooltip title="Tải xuống bản ghi (JSON)">
                <IconButton 
                  color="primary"
                  onClick={() => exportTranscription('json')}
                  disabled={isLoading || transcriptions.length === 0}
                >
                  <DownloadIcon />
                </IconButton>
              </Tooltip>
              
              <Tooltip title="Sao chép vào clipboard">
                <IconButton 
                  color="primary"
                  onClick={copyToClipboard}
                  disabled={isLoading || transcriptions.length === 0}
                >
                  <ContentCopyIcon />
                </IconButton>
              </Tooltip>
            </Box>
          </Grid>
        </Grid>
        
        {isLoading && (
          <Box className="loading-overlay">
            <CircularProgress />
          </Box>
        )}
        
        {error && (
          <Box className="error-message">
            <Typography color="error">{error}</Typography>
          </Box>
        )}
      </Paper>
    </Container>
  );
}

export default App;
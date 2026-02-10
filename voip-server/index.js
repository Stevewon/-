import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import { createServer } from 'http';

// 라우트 임포트
import authRoutes from './routes/auth.js';
import channelRoutes from './routes/channels.js';
import alertRoutes from './routes/alerts.js';
import mediaRoutes from './routes/media.js';

// 유틸리티
import db from './database.js';
import { initializeFirebase } from './firebase.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 환경 변수 로드
dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3002;

// 미들웨어
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 정적 파일 서빙 (업로드된 미디어 파일)
const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '../uploads');
app.use('/uploads', express.static(uploadDir));

// 라우트
app.use('/api/auth', authRoutes);
app.use('/api/channels', channelRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/media', mediaRoutes);

// 헬스 체크
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    service: 'VoIP Alarm Server'
  });
});

// 루트 엔드포인트
app.get('/', (req, res) => {
  res.json({
    service: 'VoIP Alarm Server',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      auth: '/api/auth',
      channels: '/api/channels',
      alerts: '/api/alerts',
      media: '/api/media'
    }
  });
});

// Socket.io 실시간 이벤트
io.on('connection', (socket) => {
  console.log('✅ 클라이언트 연결:', socket.id);

  // 사용자 온라인 상태
  socket.on('user-online', (userId) => {
    socket.userId = userId;
    socket.join(`user:${userId}`);
    console.log(`👤 사용자 온라인: ${userId}`);
  });

  // 채널 입장
  socket.on('join-channel', (channelId) => {
    socket.join(`channel:${channelId}`);
    console.log(`📢 채널 입장: ${channelId} (${socket.id})`);
  });

  // 채널 퇴장
  socket.on('leave-channel', (channelId) => {
    socket.leave(`channel:${channelId}`);
    console.log(`🚪 채널 퇴장: ${channelId} (${socket.id})`);
  });

  // 알림 실시간 응답 브로드캐스트
  socket.on('alert-response', (data) => {
    const { alertId, channelId, userId, response, nickname } = data;
    io.to(`channel:${channelId}`).emit('alert-response-update', {
      alertId,
      userId,
      response,
      nickname,
      timestamp: new Date().toISOString()
    });
  });

  // 연결 해제
  socket.on('disconnect', () => {
    console.log('❌ 클라이언트 연결 해제:', socket.id);
  });
});

// Firebase 초기화
console.log('🔥 Firebase Admin SDK 초기화 중...');
initializeFirebase();

// 서버 시작
httpServer.listen(PORT, () => {
  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log('📞 VoIP 알람 서버 시작됨');
  console.log('═══════════════════════════════════════════════');
  console.log(`🌐 서버 주소: http://localhost:${PORT}`);
  console.log(`📡 Socket.io: 활성화`);
  console.log(`💾 데이터베이스: ${process.env.DATABASE_PATH || './voip_alarm.db'}`);
  console.log('═══════════════════════════════════════════════');
  console.log('');
});

// 에러 핸들러
process.on('uncaughtException', (error) => {
  console.error('❌ 처리되지 않은 예외:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ 처리되지 않은 Promise 거부:', reason);
});

export default app;

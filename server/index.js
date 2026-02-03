import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

// 채팅방 저장소 (실제로는 DB 사용)
const chatRooms = new Map();
const users = new Map();

// 채팅방 생성
app.post('/api/rooms', (req, res) => {
  const roomId = uuidv4();
  const { roomName, creatorName } = req.body;
  
  chatRooms.set(roomId, {
    id: roomId,
    name: roomName || '익명 채팅방',
    creator: creatorName,
    createdAt: new Date(),
    messages: []
  });
  
  res.json({ roomId, name: chatRooms.get(roomId).name });
});

// 채팅방 정보 조회
app.get('/api/rooms/:roomId', (req, res) => {
  const { roomId } = req.params;
  const room = chatRooms.get(roomId);
  
  if (!room) {
    return res.status(404).json({ error: '채팅방을 찾을 수 없습니다' });
  }
  
  res.json({ 
    id: room.id, 
    name: room.name,
    creator: room.creator,
    messageCount: room.messages.length 
  });
});

// WebSocket 연결 처리
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  // 채팅방 입장
  socket.on('join-room', ({ roomId, username }) => {
    if (!chatRooms.has(roomId)) {
      socket.emit('error', { message: '채팅방을 찾을 수 없습니다' });
      return;
    }
    
    socket.join(roomId);
    users.set(socket.id, { username, roomId });
    
    const room = chatRooms.get(roomId);
    
    // 기존 메시지 전송
    socket.emit('previous-messages', room.messages);
    
    // 입장 알림
    const joinMessage = {
      id: uuidv4(),
      type: 'system',
      content: `${username}님이 입장하셨습니다`,
      timestamp: new Date()
    };
    
    io.to(roomId).emit('message', joinMessage);
    
    console.log(`${username} joined room ${roomId}`);
  });
  
  // 메시지 전송
  socket.on('send-message', ({ roomId, message }) => {
    const user = users.get(socket.id);
    
    if (!user || !chatRooms.has(roomId)) {
      return;
    }
    
    const newMessage = {
      id: uuidv4(),
      type: 'user',
      username: user.username,
      content: message,
      timestamp: new Date()
    };
    
    // 메시지 저장
    const room = chatRooms.get(roomId);
    room.messages.push(newMessage);
    
    // 모든 사용자에게 브로드캐스트
    io.to(roomId).emit('message', newMessage);
  });
  
  // 연결 해제
  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    
    if (user) {
      const { username, roomId } = user;
      
      const leaveMessage = {
        id: uuidv4(),
        type: 'system',
        content: `${username}님이 퇴장하셨습니다`,
        timestamp: new Date()
      };
      
      io.to(roomId).emit('message', leaveMessage);
      users.delete(socket.id);
      
      console.log(`${username} left room ${roomId}`);
    }
    
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3001;

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

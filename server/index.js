import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';

dotenv.config();

import db from './database.js';
import authRoutes from './routes/auth.js';
import marketRoutes from './routes/market.js';
import orderRoutes from './routes/order.js';
import walletRoutes from './routes/wallet.js';
import adminRoutes from './routes/admin.js';
import MatchingEngine from './services/matchingEngine.js';
import PriceSimulator from './services/priceSimulator.js';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

app.use(cors());
app.use(express.json());

// Services
const matchingEngine = new MatchingEngine(io);
const priceSimulator = new PriceSimulator(io);

app.set('matchingEngine', matchingEngine);
app.set('io', io);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/market', marketRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/admin', adminRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// WebSocket
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  socket.on('subscribe', (channel) => {
    socket.join(channel);
    console.log(`${socket.id} subscribed to ${channel}`);
  });

  socket.on('unsubscribe', (channel) => {
    socket.leave(channel);
  });

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

// Start
const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`
  ============================================
    CryptoX Exchange Server
    Port: ${PORT}
    Status: Running
  ============================================
  `);
  priceSimulator.start();
});

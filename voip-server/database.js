import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '../voip_alarm.db');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('❌ 데이터베이스 연결 실패:', err);
  } else {
    console.log('✅ 데이터베이스 연결 성공:', dbPath);
    initDatabase();
  }
});

function initDatabase() {
  db.serialize(() => {
    // 사용자 테이블
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        nickname TEXT NOT NULL,
        photo_url TEXT,
        fcm_token TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 채널 테이블
    db.run(`
      CREATE TABLE IF NOT EXISTS channels (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        creator_id TEXT NOT NULL,
        invite_code TEXT UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (creator_id) REFERENCES users(id)
      )
    `);

    // 채널 멤버 테이블
    db.run(`
      CREATE TABLE IF NOT EXISTS channel_members (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT DEFAULT 'member',
        joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (channel_id) REFERENCES channels(id),
        FOREIGN KEY (user_id) REFERENCES users(id),
        UNIQUE(channel_id, user_id)
      )
    `);

    // 알림 테이블
    db.run(`
      CREATE TABLE IF NOT EXISTS alerts (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT,
        media_type TEXT CHECK(media_type IN ('audio', 'short_video', 'youtube_video')),
        media_url TEXT,
        youtube_url TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (channel_id) REFERENCES channels(id),
        FOREIGN KEY (sender_id) REFERENCES users(id)
      )
    `);

    // 알림 응답 테이블 (수락/거절)
    db.run(`
      CREATE TABLE IF NOT EXISTS alert_responses (
        id TEXT PRIMARY KEY,
        alert_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        response TEXT CHECK(response IN ('accepted', 'rejected', 'missed')),
        responded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (alert_id) REFERENCES alerts(id),
        FOREIGN KEY (user_id) REFERENCES users(id),
        UNIQUE(alert_id, user_id)
      )
    `);

    // 미디어 파일 테이블
    db.run(`
      CREATE TABLE IF NOT EXISTS media_files (
        id TEXT PRIMARY KEY,
        uploader_id TEXT NOT NULL,
        filename TEXT NOT NULL,
        original_filename TEXT NOT NULL,
        file_type TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        file_path TEXT NOT NULL,
        duration INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (uploader_id) REFERENCES users(id)
      )
    `);

    console.log('✅ 데이터베이스 테이블 초기화 완료');
  });
}

export default db;

import express from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import db from '../database.js';
import { generateToken } from '../auth.js';

const router = express.Router();

// 회원가입
router.post('/register', async (req, res) => {
  try {
    const { email, password, nickname } = req.body;

    if (!email || !password || !nickname) {
      return res.status(400).json({ error: '모든 필드를 입력해주세요' });
    }

    // 이메일 중복 확인
    db.get('SELECT id FROM users WHERE email = ?', [email], async (err, row) => {
      if (err) {
        return res.status(500).json({ error: '데이터베이스 오류' });
      }
      if (row) {
        return res.status(400).json({ error: '이미 사용 중인 이메일입니다' });
      }

      // 비밀번호 해시화
      const hashedPassword = await bcrypt.hash(password, 10);
      const userId = uuidv4();

      // 사용자 생성
      db.run(
        'INSERT INTO users (id, email, password, nickname) VALUES (?, ?, ?, ?)',
        [userId, email, hashedPassword, nickname],
        function (err) {
          if (err) {
            return res.status(500).json({ error: '회원가입 실패' });
          }

          const token = generateToken(userId);
          res.status(201).json({
            message: '회원가입 성공',
            user: { id: userId, email, nickname },
            token
          });
        }
      );
    });
  } catch (error) {
    console.error('회원가입 오류:', error);
    res.status(500).json({ error: '서버 오류' });
  }
});

// 로그인
router.post('/login', (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: '이메일과 비밀번호를 입력해주세요' });
    }

    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
      if (err) {
        return res.status(500).json({ error: '데이터베이스 오류' });
      }
      if (!user) {
        return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다' });
      }

      // 비밀번호 확인
      const isValidPassword = await bcrypt.compare(password, user.password);
      if (!isValidPassword) {
        return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다' });
      }

      const token = generateToken(user.id);
      res.json({
        message: '로그인 성공',
        user: {
          id: user.id,
          email: user.email,
          nickname: user.nickname
        },
        token
      });
    });
  } catch (error) {
    console.error('로그인 오류:', error);
    res.status(500).json({ error: '서버 오류' });
  }
});

// FCM 토큰 업데이트
router.post('/fcm-token', (req, res) => {
  try {
    const { userId, fcmToken } = req.body;

    if (!userId || !fcmToken) {
      return res.status(400).json({ error: 'userId와 fcmToken이 필요합니다' });
    }

    db.run(
      'UPDATE users SET fcm_token = ? WHERE id = ?',
      [fcmToken, userId],
      function (err) {
        if (err) {
          return res.status(500).json({ error: 'FCM 토큰 업데이트 실패' });
        }
        res.json({ message: 'FCM 토큰 업데이트 성공' });
      }
    );
  } catch (error) {
    console.error('FCM 토큰 업데이트 오류:', error);
    res.status(500).json({ error: '서버 오류' });
  }
});

export default router;

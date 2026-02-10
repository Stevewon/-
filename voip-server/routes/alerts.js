import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../database.js';
import { authenticateToken } from '../auth.js';
import { sendVoipPushToMultiple } from '../firebase.js';

const router = express.Router();

// 긴급 알림 발송
router.post('/send', authenticateToken, async (req, res) => {
  try {
    const { channelId, title, message, mediaType, mediaUrl, youtubeUrl } = req.body;
    const senderId = req.user.userId;

    if (!channelId || !title) {
      return res.status(400).json({ error: '채널 ID와 제목을 입력해주세요' });
    }

    // 채널 멤버 확인 및 권한 검증
    db.get(
      'SELECT role FROM channel_members WHERE channel_id = ? AND user_id = ?',
      [channelId, senderId],
      (err, membership) => {
        if (err || !membership) {
          return res.status(403).json({ error: '채널 접근 권한이 없습니다' });
        }

        // 알림 생성
        const alertId = uuidv4();
        db.run(
          `INSERT INTO alerts (id, channel_id, sender_id, title, message, media_type, media_url, youtube_url)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [alertId, channelId, senderId, title, message || '', mediaType || null, mediaUrl || null, youtubeUrl || null],
          async function (err) {
            if (err) {
              console.error('알림 생성 오류:', err);
              return res.status(500).json({ error: '알림 생성 실패' });
            }

            // 채널 정보 조회
            db.get('SELECT name FROM channels WHERE id = ?', [channelId], async (err, channel) => {
              if (err || !channel) {
                return res.status(500).json({ error: '채널 정보 조회 실패' });
              }

              // 발신자 정보 조회
              db.get('SELECT nickname FROM users WHERE id = ?', [senderId], async (err, sender) => {
                if (err || !sender) {
                  return res.status(500).json({ error: '발신자 정보 조회 실패' });
                }

                // 채널의 모든 멤버 FCM 토큰 조회 (본인 제외)
                const query = `
                  SELECT u.id, u.fcm_token
                  FROM channel_members cm
                  JOIN users u ON cm.user_id = u.id
                  WHERE cm.channel_id = ? AND u.id != ? AND u.fcm_token IS NOT NULL
                `;

                db.all(query, [channelId, senderId], async (err, members) => {
                  if (err) {
                    console.error('멤버 조회 오류:', err);
                    return res.status(500).json({ error: '멤버 조회 실패' });
                  }

                  if (members.length === 0) {
                    return res.json({
                      message: '알림 생성 성공 (수신자 없음)',
                      alertId,
                      recipientCount: 0
                    });
                  }

                  // FCM Push 발송
                  const fcmTokens = members.map(m => m.fcm_token);
                  const alertData = {
                    alertId,
                    channelId,
                    channelName: channel.name,
                    title,
                    message: message || '',
                    mediaType: mediaType || '',
                    mediaUrl: mediaUrl || '',
                    youtubeUrl: youtubeUrl || '',
                    senderId,
                    senderName: sender.nickname
                  };

                  const pushResult = await sendVoipPushToMultiple(fcmTokens, alertData);

                  // 미수신 응답 기록 (모든 멤버)
                  const responsePromises = members.map(member => {
                    return new Promise((resolve) => {
                      const responseId = uuidv4();
                      db.run(
                        'INSERT INTO alert_responses (id, alert_id, user_id, response) VALUES (?, ?, ?, ?)',
                        [responseId, alertId, member.id, 'missed'],
                        () => resolve()
                      );
                    });
                  });

                  await Promise.all(responsePromises);

                  res.json({
                    message: '알림 발송 성공',
                    alertId,
                    recipientCount: members.length,
                    pushResult
                  });
                });
              });
            });
          }
        );
      }
    );
  } catch (error) {
    console.error('알림 발송 오류:', error);
    res.status(500).json({ error: '서버 오류' });
  }
});

// 알림 응답 (수락/거절)
router.post('/respond', authenticateToken, (req, res) => {
  try {
    const { alertId, response } = req.body;
    const userId = req.user.userId;

    if (!alertId || !response) {
      return res.status(400).json({ error: 'alertId와 response를 입력해주세요' });
    }

    if (!['accepted', 'rejected'].includes(response)) {
      return res.status(400).json({ error: 'response는 accepted 또는 rejected여야 합니다' });
    }

    // 기존 응답 업데이트 또는 새 응답 생성
    db.get(
      'SELECT id FROM alert_responses WHERE alert_id = ? AND user_id = ?',
      [alertId, userId],
      (err, existing) => {
        if (err) {
          return res.status(500).json({ error: '데이터베이스 오류' });
        }

        if (existing) {
          // 기존 응답 업데이트
          db.run(
            'UPDATE alert_responses SET response = ?, responded_at = CURRENT_TIMESTAMP WHERE id = ?',
            [response, existing.id],
            (err) => {
              if (err) {
                return res.status(500).json({ error: '응답 업데이트 실패' });
              }
              res.json({ message: '응답 업데이트 성공', response });
            }
          );
        } else {
          // 새 응답 생성
          const responseId = uuidv4();
          db.run(
            'INSERT INTO alert_responses (id, alert_id, user_id, response) VALUES (?, ?, ?, ?)',
            [responseId, alertId, userId, response],
            (err) => {
              if (err) {
                return res.status(500).json({ error: '응답 저장 실패' });
              }
              res.json({ message: '응답 저장 성공', response });
            }
          );
        }
      }
    );
  } catch (error) {
    console.error('응답 처리 오류:', error);
    res.status(500).json({ error: '서버 오류' });
  }
});

// 알림 상세 정보 조회
router.get('/:alertId', authenticateToken, (req, res) => {
  try {
    const { alertId } = req.params;
    const userId = req.user.userId;

    // 알림 정보 조회
    const query = `
      SELECT a.*, c.name as channel_name, u.nickname as sender_nickname
      FROM alerts a
      JOIN channels c ON a.channel_id = c.id
      JOIN users u ON a.sender_id = u.id
      WHERE a.id = ?
    `;

    db.get(query, [alertId], (err, alert) => {
      if (err) {
        return res.status(500).json({ error: '데이터베이스 오류' });
      }
      if (!alert) {
        return res.status(404).json({ error: '알림을 찾을 수 없습니다' });
      }

      // 채널 멤버 확인
      db.get(
        'SELECT id FROM channel_members WHERE channel_id = ? AND user_id = ?',
        [alert.channel_id, userId],
        (err, membership) => {
          if (err || !membership) {
            return res.status(403).json({ error: '접근 권한이 없습니다' });
          }

          // 응답 통계
          const statsQuery = `
            SELECT 
              COUNT(*) as total,
              SUM(CASE WHEN response = 'accepted' THEN 1 ELSE 0 END) as accepted,
              SUM(CASE WHEN response = 'rejected' THEN 1 ELSE 0 END) as rejected,
              SUM(CASE WHEN response = 'missed' THEN 1 ELSE 0 END) as missed
            FROM alert_responses
            WHERE alert_id = ?
          `;

          db.get(statsQuery, [alertId], (err, stats) => {
            if (err) {
              return res.status(500).json({ error: '통계 조회 실패' });
            }

            // 내 응답 조회
            db.get(
              'SELECT response, responded_at FROM alert_responses WHERE alert_id = ? AND user_id = ?',
              [alertId, userId],
              (err, myResponse) => {
                res.json({
                  alert,
                  stats,
                  myResponse: myResponse || null
                });
              }
            );
          });
        }
      );
    });
  } catch (error) {
    console.error('알림 조회 오류:', error);
    res.status(500).json({ error: '서버 오류' });
  }
});

// 채널의 알림 목록
router.get('/channel/:channelId/history', authenticateToken, (req, res) => {
  try {
    const { channelId } = req.params;
    const userId = req.user.userId;

    // 채널 멤버 확인
    db.get(
      'SELECT id FROM channel_members WHERE channel_id = ? AND user_id = ?',
      [channelId, userId],
      (err, membership) => {
        if (err || !membership) {
          return res.status(403).json({ error: '채널 접근 권한이 없습니다' });
        }

        const query = `
          SELECT a.*, u.nickname as sender_nickname
          FROM alerts a
          JOIN users u ON a.sender_id = u.id
          WHERE a.channel_id = ?
          ORDER BY a.created_at DESC
          LIMIT 50
        `;

        db.all(query, [channelId], (err, alerts) => {
          if (err) {
            return res.status(500).json({ error: '알림 조회 실패' });
          }
          res.json({ alerts });
        });
      }
    );
  } catch (error) {
    console.error('알림 목록 조회 오류:', error);
    res.status(500).json({ error: '서버 오류' });
  }
});

export default router;

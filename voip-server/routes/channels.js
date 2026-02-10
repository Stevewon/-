import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../database.js';
import { authenticateToken } from '../auth.js';

const router = express.Router();

// 초대 코드 생성 함수 (6자리 대문자+숫자)
function generateInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 혼동되는 문자 제외 (I, O, 0, 1)
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// 고유한 초대 코드 생성 (중복 체크)
async function generateUniqueInviteCode() {
  return new Promise((resolve, reject) => {
    const tryGenerate = () => {
      const code = generateInviteCode();
      db.get('SELECT id FROM channels WHERE invite_code = ?', [code], (err, row) => {
        if (err) {
          reject(err);
        } else if (row) {
          // 중복되면 다시 생성
          tryGenerate();
        } else {
          resolve(code);
        }
      });
    };
    tryGenerate();
  });
}

// 채널 생성
router.post('/create', authenticateToken, async (req, res) => {
  try {
    const { name, description } = req.body;
    const creatorId = req.user.userId;

    if (!name) {
      return res.status(400).json({ error: '채널 이름을 입력해주세요' });
    }

    const channelId = uuidv4();
    const inviteCode = await generateUniqueInviteCode();

    db.run(
      'INSERT INTO channels (id, name, description, creator_id, invite_code) VALUES (?, ?, ?, ?, ?)',
      [channelId, name, description || '', creatorId, inviteCode],
      function (err) {
        if (err) {
          console.error('채널 생성 오류:', err);
          return res.status(500).json({ error: '채널 생성 실패' });
        }

        // 생성자를 관리자로 자동 추가
        const memberId = uuidv4();
        db.run(
          'INSERT INTO channel_members (id, channel_id, user_id, role) VALUES (?, ?, ?, ?)',
          [memberId, channelId, creatorId, 'admin'],
          (err) => {
            if (err) {
              console.error('채널 멤버 추가 오류:', err);
              return res.status(500).json({ error: '채널 멤버 추가 실패' });
            }

            res.status(201).json({
              message: '채널 생성 성공',
              channel: {
                id: channelId,
                name,
                description,
                creator_id: creatorId,
                invite_code: inviteCode
              }
            });
          }
        );
          }
        );
      }
    );
  } catch (error) {
    console.error('채널 생성 오류:', error);
    res.status(500).json({ error: '서버 오류' });
  }
});

// 내 채널 목록
router.get('/my-channels', authenticateToken, (req, res) => {
  try {
    const userId = req.user.userId;

    const query = `
      SELECT c.*, cm.role, u.nickname as creator_nickname
      FROM channels c
      JOIN channel_members cm ON c.id = cm.channel_id
      LEFT JOIN users u ON c.creator_id = u.id
      WHERE cm.user_id = ?
      ORDER BY c.created_at DESC
    `;

    db.all(query, [userId], (err, channels) => {
      if (err) {
        console.error('채널 조회 오류:', err);
        return res.status(500).json({ error: '채널 조회 실패' });
      }
      res.json({ channels });
    });
  } catch (error) {
    console.error('채널 조회 오류:', error);
    res.status(500).json({ error: '서버 오류' });
  }
});

// 채널 상세 정보
router.get('/:channelId', authenticateToken, (req, res) => {
  try {
    const { channelId } = req.params;
    const userId = req.user.userId;

    // 채널 멤버 확인
    db.get(
      'SELECT * FROM channel_members WHERE channel_id = ? AND user_id = ?',
      [channelId, userId],
      (err, membership) => {
        if (err) {
          return res.status(500).json({ error: '데이터베이스 오류' });
        }
        if (!membership) {
          return res.status(403).json({ error: '채널 접근 권한이 없습니다' });
        }

        // 채널 정보 조회
        db.get('SELECT * FROM channels WHERE id = ?', [channelId], (err, channel) => {
          if (err) {
            return res.status(500).json({ error: '데이터베이스 오류' });
          }
          if (!channel) {
            return res.status(404).json({ error: '채널을 찾을 수 없습니다' });
          }

          // 채널 멤버 목록
          const membersQuery = `
            SELECT u.id, u.nickname, u.email, cm.role, cm.joined_at
            FROM channel_members cm
            JOIN users u ON cm.user_id = u.id
            WHERE cm.channel_id = ?
          `;

          db.all(membersQuery, [channelId], (err, members) => {
            if (err) {
              return res.status(500).json({ error: '멤버 조회 실패' });
            }

            res.json({
              channel,
              members,
              myRole: membership.role
            });
          });
        });
      }
    );
  } catch (error) {
    console.error('채널 상세 조회 오류:', error);
    res.status(500).json({ error: '서버 오류' });
  }
});

// 채널 멤버 추가 (이메일로)
router.post('/:channelId/add-member', authenticateToken, (req, res) => {
  try {
    const { channelId } = req.params;
    const { email } = req.body;
    const userId = req.user.userId;

    if (!email) {
      return res.status(400).json({ error: '이메일을 입력해주세요' });
    }

    // 요청자가 관리자인지 확인
    db.get(
      'SELECT role FROM channel_members WHERE channel_id = ? AND user_id = ?',
      [channelId, userId],
      (err, membership) => {
        if (err || !membership) {
          return res.status(403).json({ error: '권한이 없습니다' });
        }
        if (membership.role !== 'admin') {
          return res.status(403).json({ error: '관리자만 멤버를 추가할 수 있습니다' });
        }

        // 추가할 사용자 조회
        db.get('SELECT id FROM users WHERE email = ?', [email], (err, user) => {
          if (err) {
            return res.status(500).json({ error: '데이터베이스 오류' });
          }
          if (!user) {
            return res.status(404).json({ error: '사용자를 찾을 수 없습니다' });
          }

          // 이미 멤버인지 확인
          db.get(
            'SELECT id FROM channel_members WHERE channel_id = ? AND user_id = ?',
            [channelId, user.id],
            (err, existingMember) => {
              if (err) {
                return res.status(500).json({ error: '데이터베이스 오류' });
              }
              if (existingMember) {
                return res.status(400).json({ error: '이미 채널 멤버입니다' });
              }

              // 멤버 추가
              const memberId = uuidv4();
              db.run(
                'INSERT INTO channel_members (id, channel_id, user_id, role) VALUES (?, ?, ?, ?)',
                [memberId, channelId, user.id, 'member'],
                (err) => {
                  if (err) {
                    return res.status(500).json({ error: '멤버 추가 실패' });
                  }
                  res.json({ message: '멤버 추가 성공' });
                }
              );
            }
          );
        });
      }
    );
  } catch (error) {
    console.error('멤버 추가 오류:', error);
    res.status(500).json({ error: '서버 오류' });
  }
});

// 채널 나가기
router.delete('/:channelId/leave', authenticateToken, (req, res) => {
  try {
    const { channelId } = req.params;
    const userId = req.user.userId;

    // 채널 생성자인지 확인
    db.get('SELECT creator_id FROM channels WHERE id = ?', [channelId], (err, channel) => {
      if (err || !channel) {
        return res.status(404).json({ error: '채널을 찾을 수 없습니다' });
      }

      if (channel.creator_id === userId) {
        return res.status(400).json({ error: '채널 생성자는 채널을 나갈 수 없습니다' });
      }

      db.run(
        'DELETE FROM channel_members WHERE channel_id = ? AND user_id = ?',
        [channelId, userId],
        function (err) {
          if (err) {
            return res.status(500).json({ error: '채널 나가기 실패' });
          }
          if (this.changes === 0) {
            return res.status(404).json({ error: '채널 멤버가 아닙니다' });
          }
          res.json({ message: '채널 나가기 성공' });
        }
      );
    });
  } catch (error) {
    console.error('채널 나가기 오류:', error);
    res.status(500).json({ error: '서버 오류' });
  }
});

// 초대 코드로 채널 가입
router.post('/join-by-code', authenticateToken, (req, res) => {
  try {
    const { inviteCode } = req.body;
    const userId = req.user.userId;

    if (!inviteCode) {
      return res.status(400).json({ error: '초대 코드를 입력해주세요' });
    }

    // 초대 코드로 채널 찾기
    db.get(
      'SELECT * FROM channels WHERE invite_code = ?',
      [inviteCode.toUpperCase()],
      (err, channel) => {
        if (err) {
          return res.status(500).json({ error: '데이터베이스 오류' });
        }
        if (!channel) {
          return res.status(404).json({ error: '유효하지 않은 초대 코드입니다' });
        }

        // 이미 멤버인지 확인
        db.get(
          'SELECT id FROM channel_members WHERE channel_id = ? AND user_id = ?',
          [channel.id, userId],
          (err, existingMember) => {
            if (err) {
              return res.status(500).json({ error: '데이터베이스 오류' });
            }
            if (existingMember) {
              return res.status(400).json({ error: '이미 채널 멤버입니다' });
            }

            // 멤버로 추가
            const memberId = uuidv4();
            db.run(
              'INSERT INTO channel_members (id, channel_id, user_id, role) VALUES (?, ?, ?, ?)',
              [memberId, channel.id, userId, 'member'],
              (err) => {
                if (err) {
                  console.error('멤버 추가 오류:', err);
                  return res.status(500).json({ error: '채널 가입 실패' });
                }

                res.json({
                  message: '채널 가입 성공',
                  channel: {
                    id: channel.id,
                    name: channel.name,
                    description: channel.description
                  }
                });
              }
            );
          }
        );
      }
    );
  } catch (error) {
    console.error('초대 코드 가입 오류:', error);
    res.status(500).json({ error: '서버 오류' });
  }
});

// 채널 초대 코드 재생성 (관리자만)
router.post('/:channelId/regenerate-code', authenticateToken, async (req, res) => {
  try {
    const { channelId } = req.params;
    const userId = req.user.userId;

    // 관리자 권한 확인
    db.get(
      'SELECT role FROM channel_members WHERE channel_id = ? AND user_id = ?',
      [channelId, userId],
      async (err, membership) => {
        if (err || !membership) {
          return res.status(403).json({ error: '권한이 없습니다' });
        }
        if (membership.role !== 'admin') {
          return res.status(403).json({ error: '관리자만 초대 코드를 재생성할 수 있습니다' });
        }

        // 새 초대 코드 생성
        const newInviteCode = await generateUniqueInviteCode();

        db.run(
          'UPDATE channels SET invite_code = ? WHERE id = ?',
          [newInviteCode, channelId],
          (err) => {
            if (err) {
              console.error('초대 코드 재생성 오류:', err);
              return res.status(500).json({ error: '초대 코드 재생성 실패' });
            }

            res.json({
              message: '초대 코드 재생성 성공',
              inviteCode: newInviteCode
            });
          }
        );
      }
    );
  } catch (error) {
    console.error('초대 코드 재생성 오류:', error);
    res.status(500).json({ error: '서버 오류' });
  }
});

export default router;

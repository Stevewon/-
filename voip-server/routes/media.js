import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';
import db from '../database.js';
import { authenticateToken } from '../auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// 업로드 디렉토리 설정
const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer 설정
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE || '52428800') // 50MB 기본값
  },
  fileFilter: (req, file, cb) => {
    // 허용할 파일 타입
    const allowedTypes = [
      'audio/mpeg',
      'audio/mp3',
      'audio/wav',
      'audio/ogg',
      'audio/m4a',
      'video/mp4',
      'video/mpeg',
      'video/quicktime',
      'video/x-msvideo',
      'video/webm'
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('지원하지 않는 파일 형식입니다. (음성/영상 파일만 가능)'));
    }
  }
});

// 미디어 파일 업로드
router.post('/upload', authenticateToken, upload.single('media'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '파일을 선택해주세요' });
    }

    const uploaderId = req.user.userId;
    const { originalname, filename, mimetype, size } = req.file;
    const filePath = `/uploads/${filename}`;
    const mediaId = uuidv4();

    // 파일 타입 결정
    let fileType = 'unknown';
    if (mimetype.startsWith('audio/')) {
      fileType = 'audio';
    } else if (mimetype.startsWith('video/')) {
      fileType = 'video';
    }

    // DB에 저장
    db.run(
      `INSERT INTO media_files (id, uploader_id, filename, original_filename, file_type, file_size, file_path)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [mediaId, uploaderId, filename, originalname, fileType, size, filePath],
      function (err) {
        if (err) {
          console.error('미디어 파일 DB 저장 오류:', err);
          // DB 저장 실패 시 업로드된 파일 삭제
          fs.unlinkSync(path.join(uploadDir, filename));
          return res.status(500).json({ error: '파일 정보 저장 실패' });
        }

        res.status(201).json({
          message: '파일 업로드 성공',
          media: {
            id: mediaId,
            filename,
            originalFilename: originalname,
            fileType,
            fileSize: size,
            fileUrl: filePath
          }
        });
      }
    );
  } catch (error) {
    console.error('파일 업로드 오류:', error);
    res.status(500).json({ error: '서버 오류' });
  }
});

// 미디어 파일 정보 조회
router.get('/:mediaId', authenticateToken, (req, res) => {
  try {
    const { mediaId } = req.params;

    db.get('SELECT * FROM media_files WHERE id = ?', [mediaId], (err, media) => {
      if (err) {
        return res.status(500).json({ error: '데이터베이스 오류' });
      }
      if (!media) {
        return res.status(404).json({ error: '파일을 찾을 수 없습니다' });
      }

      res.json({ media });
    });
  } catch (error) {
    console.error('파일 조회 오류:', error);
    res.status(500).json({ error: '서버 오류' });
  }
});

// 내가 업로드한 미디어 목록
router.get('/my/uploads', authenticateToken, (req, res) => {
  try {
    const uploaderId = req.user.userId;

    db.all(
      'SELECT * FROM media_files WHERE uploader_id = ? ORDER BY created_at DESC',
      [uploaderId],
      (err, files) => {
        if (err) {
          return res.status(500).json({ error: '데이터베이스 오류' });
        }
        res.json({ files });
      }
    );
  } catch (error) {
    console.error('미디어 목록 조회 오류:', error);
    res.status(500).json({ error: '서버 오류' });
  }
});

// 미디어 파일 삭제
router.delete('/:mediaId', authenticateToken, (req, res) => {
  try {
    const { mediaId } = req.params;
    const userId = req.user.userId;

    // 파일 소유자 확인
    db.get(
      'SELECT * FROM media_files WHERE id = ? AND uploader_id = ?',
      [mediaId, userId],
      (err, media) => {
        if (err) {
          return res.status(500).json({ error: '데이터베이스 오류' });
        }
        if (!media) {
          return res.status(404).json({ error: '파일을 찾을 수 없거나 삭제 권한이 없습니다' });
        }

        // DB에서 삭제
        db.run('DELETE FROM media_files WHERE id = ?', [mediaId], (err) => {
          if (err) {
            return res.status(500).json({ error: '파일 삭제 실패' });
          }

          // 실제 파일 삭제
          const filePath = path.join(uploadDir, media.filename);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }

          res.json({ message: '파일 삭제 성공' });
        });
      }
    );
  } catch (error) {
    console.error('파일 삭제 오류:', error);
    res.status(500).json({ error: '서버 오류' });
  }
});

export default router;

# VoIP 알람 서버 🔔

전화벨처럼 울리는 긴급 알림 시스템 - 백엔드 서버

## 🎯 주요 기능

### 1. 채널 기반 알림 시스템
- 채널 생성 및 멤버 관리
- 이메일 기반 멤버 초대
- 관리자/멤버 권한 관리

### 2. VoIP 스타일 푸시 알림
- **Android**: FCM High Priority Push
- 전화처럼 무조건 울리는 알림
- 무음/진동 모드 우회 가능

### 3. 미디어 지원
- **음성 메시지**: 녹음 파일 업로드 및 재생
- **짧은 영상**: 파일 업로드 (최대 50MB)
- **긴 영상**: YouTube URL 링크

### 4. 실시간 응답 처리
- 수락/거절/미응답 트래킹
- Socket.io 실시간 응답 알림
- 응답 통계 제공

## 🛠 기술 스택

- **Node.js + Express**: REST API
- **Socket.io**: 실시간 통신
- **SQLite**: 데이터베이스
- **Firebase Admin SDK**: FCM 푸시 알림
- **Multer**: 파일 업로드
- **JWT**: 인증

## 📦 설치 및 실행

### 1. 의존성 설치
```bash
cd voip-server
npm install
```

### 2. Firebase 설정

Firebase Console에서 서비스 계정 키 생성:
1. Firebase Console → 프로젝트 설정 → 서비스 계정
2. "새 비공개 키 생성" 클릭
3. 다운로드한 JSON 파일을 `firebase-service-account.json`으로 저장

### 3. 환경 변수 설정
```bash
cp .env.example .env
# .env 파일 편집
```

### 4. 서버 실행
```bash
npm start
# 또는 개발 모드 (auto-reload)
npm run dev
```

서버는 `http://localhost:3002`에서 실행됩니다.

## 📡 API 엔드포인트

### 인증 (Authentication)
```
POST   /api/auth/register        # 회원가입
POST   /api/auth/login           # 로그인
POST   /api/auth/fcm-token       # FCM 토큰 업데이트
```

### 채널 (Channels)
```
POST   /api/channels/create              # 채널 생성
GET    /api/channels/my-channels         # 내 채널 목록
GET    /api/channels/:channelId          # 채널 상세 정보
POST   /api/channels/:channelId/add-member  # 멤버 추가
DELETE /api/channels/:channelId/leave    # 채널 나가기
```

### 알림 (Alerts)
```
POST   /api/alerts/send                        # 긴급 알림 발송
POST   /api/alerts/respond                     # 알림 응답 (수락/거절)
GET    /api/alerts/:alertId                    # 알림 상세 조회
GET    /api/alerts/channel/:channelId/history  # 채널 알림 히스토리
```

### 미디어 (Media)
```
POST   /api/media/upload       # 미디어 파일 업로드
GET    /api/media/:mediaId     # 미디어 정보 조회
GET    /api/media/my/uploads   # 내 업로드 목록
DELETE /api/media/:mediaId     # 미디어 삭제
```

## 🔌 Socket.io 이벤트

### Client → Server
```javascript
socket.emit('user-online', userId);
socket.emit('join-channel', channelId);
socket.emit('leave-channel', channelId);
socket.emit('alert-response', { alertId, channelId, userId, response, nickname });
```

### Server → Client
```javascript
socket.on('alert-response-update', (data) => {
  // { alertId, userId, response, nickname, timestamp }
});
```

## 📊 데이터베이스 스키마

### users
- id, email, password, nickname, fcm_token, created_at

### channels
- id, name, description, creator_id, created_at

### channel_members
- id, channel_id, user_id, role (admin/member), joined_at

### alerts
- id, channel_id, sender_id, title, message
- media_type (audio/short_video/youtube_video)
- media_url, youtube_url, created_at

### alert_responses
- id, alert_id, user_id, response (accepted/rejected/missed)
- responded_at

### media_files
- id, uploader_id, filename, original_filename
- file_type, file_size, file_path, duration, created_at

## 🔐 인증 방식

모든 API는 JWT 토큰 인증이 필요합니다 (인증/로그인 제외).

**헤더 형식:**
```
Authorization: Bearer <JWT_TOKEN>
```

## 📱 안드로이드 앱과의 통합

### 1. FCM 토큰 등록
앱이 시작되면 FCM 토큰을 서버에 등록:
```javascript
POST /api/auth/fcm-token
{
  "userId": "user-id",
  "fcmToken": "fcm-token-string"
}
```

### 2. 알림 수신
앱에서 FCM Data Message 수신:
```json
{
  "type": "voip_alert",
  "alertId": "alert-id",
  "channelId": "channel-id",
  "channelName": "긴급 채널",
  "title": "긴급 알림",
  "message": "즉시 확인하세요",
  "mediaType": "audio",
  "mediaUrl": "/uploads/audio.mp3",
  "senderId": "sender-id",
  "senderName": "홍길동"
}
```

### 3. ConnectionService 트리거
앱에서 전화 UI 표시 및 응답 처리

### 4. 응답 전송
```javascript
POST /api/alerts/respond
{
  "alertId": "alert-id",
  "response": "accepted" // or "rejected"
}
```

## 🚀 다음 단계

1. ✅ **백엔드 서버 완성** ← 현재 단계
2. 🔄 **안드로이드 앱 개발**
   - React Native 프로젝트 생성
   - FCM 통합
   - ConnectionService 구현
   - 미디어 재생
3. 🔄 **iOS 앱 개발** (선택)
   - CallKit 통합
   - PushKit VoIP Push

## 📝 주의사항

- Firebase 서비스 계정 키는 절대 Git에 커밋하지 마세요
- 프로덕션 환경에서는 환경 변수로 설정 관리
- HTTPS 사용 권장
- Rate limiting 추가 권장

## 🐛 트러블슈팅

### Firebase 초기화 실패
```
⚠️  Firebase 서비스 계정 파일이 없습니다.
```
→ `firebase-service-account.json` 파일을 voip-server 디렉토리에 추가하세요.

### 파일 업로드 실패
→ `uploads` 디렉토리 권한 확인 및 MAX_FILE_SIZE 설정 확인

## 📄 라이선스

MIT

---

**전화처럼 울리는 알림 시스템** 🔔

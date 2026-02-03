# 시큐렛 메신저 - Securet QR Chat

QR 코드 기반 보안 중심 하이브리드 메신저

**📱 Android APK 다운로드**: [여기서 다운로드](./DOWNLOAD.md) | [빌드 가이드](./ANDROID_BUILD.md)

## 🔐 핵심 개념

### 가입 방식
- **이메일**: 로그인 및 그룹 채팅 초대용
- **시큐렛 QR 주소**: 사용자가 직접 생성 (예: SQR-A1B2C3D4)
- **닉네임**: 사용자 표시명

**중요**: 회원가입 시 본인만의 고유한 시큐렛 QR 주소를 생성하여 입력해야 합니다!

### 채팅 방식
1. **1:1 채팅** (시큐릿 QR 기반)
   - QR 코드 스캔으로만 친구 추가 가능
   - QR 없이는 연락 불가능 (프라이버시 보호)
   - 쪽지, 파일 공유, 음성/영상 통화

2. **그룹 채팅** (이메일 기반)
   - 이메일로 멤버 초대
   - 다중 사용자 채팅방
   - 파일 공유 지원

## ✨ 주요 기능

### 보안 기능
- ✅ 시큐렛 QR 주소 사용자 직접 생성 (완벽한 프라이버시)
- ✅ QR 코드 기반 친구 추가 (QR 없이는 연락 불가)
- ✅ 중복 방지 검증
- ✅ JWT 기반 인증
- ✅ 비밀번호 암호화 (bcrypt)

### 채팅 기능
- ✅ 실시간 1:1 채팅 (WebSocket)
- ✅ 이메일 기반 그룹 채팅
- ✅ 파일 공유 (최대 10MB)
- ✅ 읽음 표시
- ✅ 온라인 상태 표시
- 🔄 음성/영상 통화 (WebRTC) - 구현 중

### UI/UX
- ✅ 모던한 그라데이션 디자인
- ✅ 반응형 레이아웃
- ✅ 직관적인 탭 네비게이션
- ✅ QR 코드 스캔 기능

## 🛠 기술 스택

### Backend
- **Node.js + Express**: REST API 서버
- **Socket.io**: 실시간 통신
- **SQLite**: 데이터베이스
- **Multer**: 파일 업로드
- **bcryptjs**: 비밀번호 암호화
- **jsonwebtoken**: JWT 인증

### Frontend
- **React 18 + TypeScript**: UI 프레임워크
- **Vite**: 빌드 도구
- **Tailwind CSS**: 스타일링
- **Zustand**: 상태 관리
- **Socket.io Client**: 실시간 통신
- **html5-qrcode**: QR 코드 스캔
- **qrcode**: QR 코드 생성
- **date-fns**: 날짜 포맷팅
- **React Router**: 라우팅

## 📦 설치 및 실행

### 1. 의존성 설치
```bash
npm install
```

### 2. 개발 서버 실행
```bash
npm run dev
```

또는 개별 실행:
```bash
# 백엔드만
npm run dev:server

# 프론트엔드만
npm run dev:client
```

### 3. 접속
- Frontend: http://localhost:5173
- Backend: http://localhost:3001

## 📱 사용 방법

### 1. 회원가입
1. 이메일, 닉네임, 비밀번호 입력
2. **본인만의 시큐렛 QR 주소 생성** (SQR-XXXXXXXX 형식)
3. 개인 QR 코드 자동 발급

**시큐렛 QR 주소 생성 방법:**
- 형식: `SQR-` + 8자리 영문 대문자/숫자
- 예시: `SQR-A1B2C3D4`, `SQR-MYCODE99`, `SQR-12345678`
- 본인만 아는 고유한 주소로 완벽한 프라이버시 보장!

### 2. 친구 추가 (1:1 채팅용)
1. "내 QR" 탭에서 자신의 QR 코드 확인
2. QR 코드 공유 (저장 또는 화면 공유)
3. 상대방이 "QR 스캔" 탭에서 스캔
4. 양방향 친구 추가 완료

### 3. 1:1 채팅
1. "친구" 탭에서 친구 선택
2. 실시간 메시지 전송
3. 파일 첨부 가능
4. 음성/영상 통화 버튼 (개발 중)

### 4. 그룹 채팅
1. "그룹" 탭에서 "그룹 만들기" 클릭
2. 그룹명 입력
3. 멤버 이메일 입력 (쉼표로 구분)
4. 생성 후 실시간 채팅

## 🗂 프로젝트 구조

```
secret-qr-chat/
├── server/
│   ├── db/
│   │   └── database.js         # DB 초기화 및 스키마
│   ├── routes/
│   │   ├── auth.js             # 인증 API
│   │   ├── friends.js          # 친구 관리 API
│   │   └── groups.js           # 그룹 관리 API
│   ├── middleware/
│   │   └── auth.js             # JWT 인증 미들웨어
│   └── index.js                # 메인 서버 + Socket.io
├── src/
│   ├── components/
│   │   ├── MyQRCode.tsx        # 내 QR 코드
│   │   ├── QRScanner.tsx       # QR 스캔
│   │   ├── FriendsList.tsx     # 친구 목록
│   │   ├── DirectChat.tsx      # 1:1 채팅
│   │   └── GroupsList.tsx      # 그룹 목록
│   ├── pages/
│   │   ├── Login.tsx           # 로그인
│   │   ├── Register.tsx        # 회원가입
│   │   ├── AddFriend.tsx       # 친구 추가 (QR 처리)
│   │   └── Dashboard.tsx       # 메인 대시보드
│   ├── store/
│   │   └── authStore.ts        # 인증 상태 관리
│   ├── utils/
│   │   ├── api.ts              # Axios 인스턴스
│   │   └── socket.ts           # Socket.io 연결
│   ├── types/
│   │   └── index.ts            # TypeScript 타입 정의
│   ├── App.tsx                 # 라우터 설정
│   ├── main.tsx                # 엔트리 포인트
│   └── index.css               # 전역 스타일
├── public/
│   └── uploads/                # 파일 업로드 저장소
├── data.db                     # SQLite 데이터베이스
└── package.json
```

## 📊 데이터베이스 스키마

### users
- `id`: 사용자 ID (UUID)
- `email`: 이메일 (unique)
- `password`: 암호화된 비밀번호
- `nickname`: 닉네임
- `secret_qr_address`: 시큐릿 QR 주소 (unique)
- `qr_code`: QR 코드 이미지 (base64)

### friends
- `id`: 관계 ID
- `user_id`: 사용자 ID
- `friend_id`: 친구 ID
- `friend_nickname`: 친구 닉네임
- 양방향 관계 (A-B, B-A 모두 저장)

### direct_messages
- `id`: 메시지 ID
- `sender_id`: 발신자 ID
- `receiver_id`: 수신자 ID
- `message`: 메시지 내용
- `file_url`, `file_name`, `file_type`: 파일 정보
- `is_read`: 읽음 여부

### group_rooms
- `id`: 그룹 ID
- `name`: 그룹명
- `creator_id`: 생성자 ID

### group_members
- `id`: 멤버십 ID
- `room_id`: 그룹 ID
- `user_id`: 사용자 ID

### group_messages
- `id`: 메시지 ID
- `room_id`: 그룹 ID
- `sender_id`: 발신자 ID
- `message`: 메시지 내용
- `file_url`, `file_name`, `file_type`: 파일 정보

## 🔌 API 엔드포인트

### 인증
- `POST /api/auth/register` - 회원가입
- `POST /api/auth/login` - 로그인
- `GET /api/auth/me` - 내 정보 조회

### 친구
- `GET /api/friends/by-sqr/:sqrAddress` - QR 주소로 사용자 조회
- `POST /api/friends/add-friend` - 친구 추가
- `GET /api/friends/friends` - 내 친구 목록
- `DELETE /api/friends/friends/:friendId` - 친구 삭제

### 그룹
- `POST /api/groups/create` - 그룹 생성
- `GET /api/groups/my-rooms` - 내 그룹 목록
- `GET /api/groups/:roomId` - 그룹 정보
- `GET /api/groups/:roomId/messages` - 그룹 메시지
- `DELETE /api/groups/:roomId/leave` - 그룹 나가기

### 파일
- `POST /api/upload` - 파일 업로드

## 🔄 Socket.io 이벤트

### Client → Server
- `join-direct-chat` - 1:1 채팅방 입장
- `send-direct-message` - 1:1 메시지 전송
- `join-group` - 그룹 채팅방 입장
- `send-group-message` - 그룹 메시지 전송
- `mark-as-read` - 메시지 읽음 처리
- `call-user`, `call-answer`, `ice-candidate`, `end-call` - WebRTC

### Server → Client
- `direct-message` - 1:1 메시지 수신
- `group-message` - 그룹 메시지 수신
- `new-message-notification` - 새 메시지 알림
- `user-online`, `user-offline` - 온라인 상태
- `messages-read` - 메시지 읽음 확인
- `incoming-call`, `call-answered`, `call-ended` - WebRTC

## 🔒 보안 고려사항

### 현재 구현
- ✅ JWT 토큰 기반 인증
- ✅ bcrypt 비밀번호 암호화
- ✅ CORS 설정
- ✅ 파일 크기 제한 (10MB)
- ✅ 친구 관계 검증

### 프로덕션 권장사항
- 🔄 HTTPS 적용
- 🔄 환경 변수로 민감 정보 관리
- 🔄 Rate limiting
- 🔄 Input validation 강화
- 🔄 XSS/CSRF 방어
- 🔄 메시지 End-to-End 암호화
- 🔄 PostgreSQL/MongoDB 등 production DB 사용

## 📝 TODO

- [ ] WebRTC 음성/영상 통화 구현
- [ ] 그룹 채팅 UI 개선
- [ ] 메시지 검색 기능
- [ ] 푸시 알림
- [ ] 이미지 미리보기
- [ ] 이모지 지원
- [ ] 다크 모드
- [ ] PWA 지원
- [ ] E2E 암호화

## 📄 라이선스

MIT

## 👨‍💻 개발자

시큐릿 메신저 개발팀

---

**보안 메신저의 새로운 패러다임**
QR 코드로 프라이버시를 지키세요!

# 큐알쳇 (QR Chat)

QR 코드 기반 실시간 채팅 애플리케이션입니다.

## 주요 기능

- 🔲 **QR 코드 생성**: 채팅방을 만들고 QR 코드로 공유
- 📱 **QR 코드 스캔**: 카메라로 QR을 스캔하여 채팅방 입장
- 💬 **실시간 채팅**: WebSocket 기반 실시간 메시징
- 👥 **다중 사용자**: 여러 사용자가 동시에 채팅 가능
- 🎨 **모던한 UI**: Tailwind CSS를 활용한 아름다운 디자인

## 기술 스택

### Frontend
- React 18
- TypeScript
- Vite
- Tailwind CSS
- Socket.io Client
- html5-qrcode
- qrcode
- lucide-react (아이콘)

### Backend
- Node.js
- Express
- Socket.io
- CORS

## 설치 및 실행

### 1. 의존성 설치
```bash
npm install
```

### 2. 개발 서버 실행
```bash
npm run dev
```

이 명령어는 다음 두 서버를 동시에 실행합니다:
- Frontend (Vite): http://localhost:5173
- Backend (Express + Socket.io): http://localhost:3001

### 3. 프로덕션 빌드
```bash
npm run build
npm run preview
```

## 사용 방법

### 채팅방 만들기
1. 닉네임 입력
2. 채팅방 이름 입력 (선택사항)
3. "채팅방 만들기" 버튼 클릭
4. 생성된 QR 코드를 친구들과 공유

### 채팅방 입장하기
1. "QR 코드 스캔하기" 버튼 클릭
2. 카메라 권한 허용
3. 채팅방 QR 코드 스캔
4. 닉네임 입력 후 입장

### 채팅하기
- 메시지 입력 후 Enter 키 또는 전송 버튼 클릭
- 실시간으로 메시지 주고받기
- "나가기" 버튼으로 채팅방 퇴장

## 프로젝트 구조

```
qrchat/
├── server/
│   └── index.js          # Express + Socket.io 서버
├── src/
│   ├── components/
│   │   ├── Home.tsx      # 메인 화면
│   │   ├── ChatRoom.tsx  # 채팅방 화면
│   │   ├── QRGenerator.tsx  # QR 코드 생성
│   │   └── QRScanner.tsx    # QR 코드 스캔
│   ├── App.tsx           # 메인 앱 컴포넌트
│   ├── main.tsx          # 엔트리 포인트
│   └── index.css         # 전역 스타일
├── index.html
├── package.json
├── vite.config.ts
├── tailwind.config.js
└── tsconfig.json
```

## API 엔드포인트

### REST API
- `POST /api/rooms` - 채팅방 생성
- `GET /api/rooms/:roomId` - 채팅방 정보 조회

### WebSocket 이벤트
- `join-room` - 채팅방 입장
- `send-message` - 메시지 전송
- `message` - 메시지 수신
- `previous-messages` - 이전 메시지 로드
- `disconnect` - 연결 해제

## 보안 고려사항

현재 버전은 데모용으로:
- 메모리에 데이터 저장 (서버 재시작시 소실)
- 인증 시스템 미구현
- 메시지 암호화 미구현

프로덕션 환경에서는 다음을 추가 구현하세요:
- 데이터베이스 연동 (MongoDB, PostgreSQL 등)
- 사용자 인증 (JWT, OAuth 등)
- 메시지 암호화
- Rate limiting
- Input validation

## 라이선스

MIT

## 개발자

큐알쳇 개발팀

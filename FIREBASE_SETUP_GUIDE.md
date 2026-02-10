# 🔥 Firebase 설정 완벽 가이드

## 📋 목차
1. [Firebase 프로젝트 생성](#1-firebase-프로젝트-생성)
2. [Android 앱 등록](#2-android-앱-등록)
3. [Google Sign-In 설정](#3-google-sign-in-설정)
4. [Firebase Cloud Messaging 설정](#4-firebase-cloud-messaging-설정)
5. [Backend 설정](#5-backend-설정)
6. [Android 앱 설정](#6-android-앱-설정)
7. [테스트](#7-테스트)

---

## 1. Firebase 프로젝트 생성

### Step 1: Firebase Console 접속
1. 브라우저에서 https://console.firebase.google.com/ 접속
2. Google 계정으로 로그인

### Step 2: 프로젝트 생성
```
1. "프로젝트 추가" 버튼 클릭
2. 프로젝트 이름 입력: "SayToDo" (원하는 이름)
3. "계속" 클릭
4. Google Analytics 설정 (선택사항)
   - 권장: 사용 안 함 (간단한 설정)
   - 또는 기본 계정 선택
5. "프로젝트 만들기" 클릭
6. 프로젝트 준비 완료 대기 (약 30초)
7. "계속" 클릭
```

✅ **완료**: Firebase 프로젝트 생성 완료!

---

## 2. Android 앱 등록

### Step 1: Android 앱 추가
```
1. Firebase 콘솔 → 프로젝트 개요
2. Android 아이콘 클릭 (📱 Android 앱에 Firebase 추가)
3. 앱 등록:
   - Android 패키지 이름: com.saytodo
   - 앱 닉네임: SayToDo (선택사항)
   - 디버그 서명 인증서 SHA-1: (다음 단계에서 추가)
4. "앱 등록" 클릭
```

### Step 2: SHA-1 인증서 얻기 (중요!)

#### Windows:
```bash
cd SayToDo/android
gradlew signingReport
```

#### macOS/Linux:
```bash
cd SayToDo/android
./gradlew signingReport
```

출력 결과에서 **SHA1** 찾기:
```
Variant: debug
Config: debug
Store: /Users/username/.android/debug.keystore
Alias: androiddebugkey
MD5: XX:XX:XX:...
SHA1: AA:BB:CC:DD:EE:FF:11:22:33:44:55:66:77:88:99:00:AA:BB:CC:DD  ← 이것!
SHA-256: ...
```

### Step 3: SHA-1 등록
```
1. Firebase 콘솔 → 프로젝트 설정 (⚙️)
2. 내 앱 → SayToDo 선택
3. 아래로 스크롤 → "SHA 인증서 지문" 섹션
4. "지문 추가" 클릭
5. SHA-1 값 붙여넣기
6. "저장" 클릭
```

### Step 4: google-services.json 다운로드
```
1. Firebase 콘솔 → 프로젝트 설정
2. 내 앱 → SayToDo
3. "google-services.json 다운로드" 버튼 클릭
4. 파일 다운로드 완료
```

✅ **파일 위치**: `~/Downloads/google-services.json`

---

## 3. Google Sign-In 설정

### Step 1: Authentication 활성화
```
1. Firebase 콘솔 → 왼쪽 메뉴 → Authentication
2. "시작하기" 클릭 (처음이면)
3. "Sign-in method" 탭 클릭
4. "Google" 선택
5. 상태 토글을 "사용 설정" 으로 변경
6. 프로젝트 지원 이메일 선택
7. "저장" 클릭
```

### Step 2: Web Client ID 가져오기 (중요!)
```
1. Firebase 콘솔 → 프로젝트 설정 (⚙️)
2. "일반" 탭
3. 아래로 스크롤 → "내 앱" 섹션
4. "Web App" 또는 "웹 API 키" 찾기
5. "웹 클라이언트 ID" 복사

형식: 123456789012-abcdefghijklmnopqrstuvwxyz123456.apps.googleusercontent.com
```

📋 **복사한 Web Client ID 저장해두기!**

---

## 4. Firebase Cloud Messaging 설정

### Step 1: FCM 활성화
```
1. Firebase 콘솔 → 프로젝트 설정 (⚙️)
2. "클라우드 메시징" 탭
3. Firebase Cloud Messaging API (V1) 상태 확인
   - 활성화되어 있으면 OK
   - 비활성화되어 있으면 "관리" → API 활성화
```

### Step 2: 서버 키 확인 (Legacy)
```
1. "클라우드 메시징" 탭에서 아래로 스크롤
2. "Cloud Messaging API (기존)" 섹션
3. "서버 키" 값 확인 (필요 시 복사)

참고: 새 프로젝트는 V1 API 사용 권장
```

---

## 5. Backend 설정

### Step 1: Service Account 키 생성
```
1. Firebase 콘솔 → 프로젝트 설정 (⚙️)
2. "서비스 계정" 탭 클릭
3. "새 비공개 키 생성" 버튼 클릭
4. 경고 다이얼로그 → "키 생성" 클릭
5. JSON 파일 자동 다운로드
```

✅ **파일 이름**: `saytodo-xxxxx-firebase-adminsdk-xxxxx-xxxxxxxxxx.json`

### Step 2: 파일 이름 변경 및 이동
```bash
cd ~/Downloads

# 다운로드한 파일 이름을 확인
ls -la saytodo-*

# 파일 이름 변경
mv saytodo-xxxxx-firebase-adminsdk-xxxxx-xxxxxxxxxx.json firebase-service-account.json

# Backend 프로젝트로 이동
cp firebase-service-account.json /home/user/webapp/voip-server/
```

### Step 3: Backend 환경 변수 설정
```bash
cd /home/user/webapp/voip-server

# .env 파일 수정
nano .env
```

`.env` 파일 내용:
```env
PORT=3002
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
DATABASE_PATH=./voip_alarm.db

# Firebase 설정
FIREBASE_SERVICE_ACCOUNT=./firebase-service-account.json
```

### Step 4: 파일 권한 확인
```bash
cd /home/user/webapp/voip-server

# firebase-service-account.json이 있는지 확인
ls -la firebase-service-account.json

# 파일 내용 확인 (처음 몇 줄만)
head -5 firebase-service-account.json

# 출력 예시:
# {
#   "type": "service_account",
#   "project_id": "saytodo-xxxxx",
#   "private_key_id": "xxxxx",
#   "private_key": "-----BEGIN PRIVATE KEY-----\n..."
```

✅ **완료**: Backend Firebase 설정 완료!

---

## 6. Android 앱 설정

### Step 1: google-services.json 이동
```bash
cd ~/Downloads

# google-services.json 파일 확인
ls -la google-services.json

# Android 앱으로 이동
cp google-services.json /home/user/webapp/SayToDo/android/app/
```

### Step 2: 파일 위치 확인
```bash
cd /home/user/webapp/SayToDo/android/app

# google-services.json이 있는지 확인
ls -la google-services.json

# 파일 내용 확인
cat google-services.json | grep project_id

# 출력 예시:
#   "project_id": "saytodo-xxxxx",
```

### Step 3: Web Client ID 설정
```bash
cd /home/user/webapp/SayToDo

# App.tsx 파일 수정
nano App.tsx
```

`App.tsx`에서 수정할 부분:
```typescript
// Firebase Web Client ID (실제 값으로 교체 필요)
const GOOGLE_WEB_CLIENT_ID = 'YOUR_WEB_CLIENT_ID.apps.googleusercontent.com';
```

**변경 후**:
```typescript
// Firebase Web Client ID
const GOOGLE_WEB_CLIENT_ID = '123456789012-abcdefghijklmnopqrstuvwxyz123456.apps.googleusercontent.com';
```

### Step 4: Android 빌드 설정 확인
```bash
cd /home/user/webapp/SayToDo/android

# build.gradle 확인
cat build.gradle | grep google-services

# 출력 예시:
#     classpath('com.google.gms:google-services:4.3.15')
```

```bash
# app/build.gradle 확인
cat app/build.gradle | tail -5

# 마지막 줄에 다음이 있어야 함:
# apply plugin: "com.google.gms.google-services"
```

✅ **완료**: Android Firebase 설정 완료!

---

## 7. 테스트

### Step 1: Backend 실행
```bash
cd /home/user/webapp/voip-server

# 의존성 설치 (처음만)
npm install

# 서버 실행
npm start
```

**예상 출력**:
```
Firebase Admin SDK initialized successfully! ✅
VoIP Alarm Server started on port 3002
Socket.IO server is running
Database connected: /home/user/webapp/voip_alarm.db
```

❌ **오류 발생 시**:
```
Error: Firebase service account file not found
→ firebase-service-account.json 파일 위치 확인

Error: Invalid service account
→ firebase-service-account.json 파일 내용 확인
```

### Step 2: Android 앱 빌드
```bash
cd /home/user/webapp/SayToDo

# 의존성 설치 (처음만)
npm install

# Android 빌드 및 실행
npm run android
```

**예상 출력**:
```
info Launching emulator...
info Installing the app...
info Starting the app...
```

### Step 3: 구글 로그인 테스트
```
1. 앱 실행
2. "Google 계정으로 시작하기" 버튼 클릭
3. Google 계정 선택 화면 표시 ✅
4. 계정 선택
5. 로그인 성공 → 채널 목록 화면 표시 ✅
```

❌ **로그인 실패 시**:
```
오류: "Sign in failed"
→ Web Client ID 확인
→ SHA-1 인증서 등록 확인

오류: "Network request failed"
→ Backend 서버 실행 확인
→ API_BASE_URL 확인
```

### Step 4: FCM Push 테스트

#### Backend에서 테스트 알림 발송:
```bash
# 테스트용 스크립트 실행
curl -X POST http://localhost:3002/api/alerts/send \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "channelId": "test-channel-id",
    "title": "테스트 알림",
    "message": "Firebase 설정 테스트",
    "mediaType": "none"
  }'
```

**예상 결과**:
```json
{
  "message": "알림 발송 성공",
  "alertId": "alert-xxxxx"
}
```

#### 앱에서 확인:
```
1. 앱이 백그라운드로 이동
2. 알림 수신 ✅
3. 전화벨 스타일 UI 표시 ✅
4. 수락/거절 버튼 표시 ✅
```

---

## 📁 최종 파일 구조

### Backend
```
voip-server/
├── firebase-service-account.json  ✅ 추가됨
├── .env
├── index.js
├── database.js
├── firebase.js
└── ...
```

### Android
```
SayToDo/
├── android/
│   └── app/
│       └── google-services.json   ✅ 추가됨
├── App.tsx                         ✅ Web Client ID 설정
└── ...
```

---

## ✅ 설정 체크리스트

### Firebase Console
- [ ] Firebase 프로젝트 생성
- [ ] Android 앱 등록
- [ ] SHA-1 인증서 등록
- [ ] Google Sign-In 활성화
- [ ] FCM 활성화
- [ ] Service Account 키 생성

### Backend
- [ ] firebase-service-account.json 추가
- [ ] .env 파일 설정
- [ ] npm install 실행
- [ ] 서버 정상 실행 확인

### Android
- [ ] google-services.json 추가
- [ ] Web Client ID 설정
- [ ] npm install 실행
- [ ] 앱 빌드 성공 확인

### 테스트
- [ ] 구글 로그인 성공
- [ ] FCM 토큰 등록 확인
- [ ] 푸시 알림 수신 확인

---

## 🔧 문제 해결

### 문제 1: "google-services.json not found"
```bash
# 파일 위치 확인
cd /home/user/webapp/SayToDo/android/app
ls -la google-services.json

# 파일이 없으면 다시 다운로드하여 복사
cp ~/Downloads/google-services.json .
```

### 문제 2: "Failed to load Firebase Admin SDK"
```bash
# 파일 위치 확인
cd /home/user/webapp/voip-server
ls -la firebase-service-account.json

# 파일 내용 확인
cat firebase-service-account.json | jq .project_id

# 파일이 잘못되었으면 다시 다운로드
```

### 문제 3: "Google Sign-In failed"
```
원인 1: SHA-1 미등록
→ Firebase Console → 프로젝트 설정 → SHA 인증서 지문 추가

원인 2: Web Client ID 오류
→ App.tsx에서 GOOGLE_WEB_CLIENT_ID 확인

원인 3: google-services.json 버전 불일치
→ Firebase Console에서 최신 파일 다시 다운로드
```

### 문제 4: "FCM 푸시 알림 안 옴"
```
원인 1: FCM 토큰 미등록
→ 로그인 후 FCM 토큰 자동 등록 확인

원인 2: 앱이 포그라운드 상태
→ 앱을 백그라운드로 이동 후 테스트

원인 3: 권한 거부
→ Android 설정 → 앱 → SayToDo → 권한 → 알림 허용
```

---

## 🎉 설정 완료!

모든 설정이 완료되었습니다! 이제 다음을 확인하세요:

✅ **Backend 실행**
```bash
cd /home/user/webapp/voip-server
npm start
```

✅ **Android 앱 실행**
```bash
cd /home/user/webapp/SayToDo
npm run android
```

✅ **기능 테스트**
1. 구글 로그인 ✅
2. 채널 생성 ✅
3. 초대 링크 공유 ✅
4. 긴급 알림 발송 ✅
5. 전화벨 알림 수신 ✅

---

## 📞 추가 도움말

### Firebase Console 바로가기
- 프로젝트: https://console.firebase.google.com/
- Authentication: https://console.firebase.google.com/project/YOUR_PROJECT/authentication
- Cloud Messaging: https://console.firebase.google.com/project/YOUR_PROJECT/settings/cloudmessaging

### 공식 문서
- Firebase Android Setup: https://firebase.google.com/docs/android/setup
- Google Sign-In: https://firebase.google.com/docs/auth/android/google-signin
- FCM: https://firebase.google.com/docs/cloud-messaging/android/client

---

**축하합니다! 🎉**  
**Firebase 설정이 완료되었습니다!**  
**이제 SayToDo 앱을 사용할 수 있습니다!** 🚀

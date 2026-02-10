# 🚀 Firebase 빠른 설정 가이드

## 📋 필요한 것
- Google 계정
- 인터넷 연결
- 약 10분

---

## ⚡ 빠른 시작 (3단계)

### 1️⃣ Firebase 프로젝트 생성 (2분)

1. **Firebase Console 접속**: https://console.firebase.google.com/
2. **프로젝트 추가** 클릭
3. 프로젝트 이름: `SayToDo` 입력
4. Google Analytics 비활성화 (빠른 설정)
5. **프로젝트 만들기** 클릭

✅ 완료!

---

### 2️⃣ Android 앱 추가 (3분)

1. **Android 아이콘** 📱 클릭
2. 패키지 이름: `com.saytodo` 입력
3. **앱 등록** 클릭
4. **google-services.json 다운로드** 클릭
5. 다운로드한 파일을 다음 위치에 복사:
   ```bash
   cp ~/Downloads/google-services.json /home/user/webapp/SayToDo/android/app/
   ```

✅ 완료!

---

### 3️⃣ Google Sign-In 활성화 (1분)

1. 왼쪽 메뉴 → **Authentication** 클릭
2. **시작하기** 클릭
3. **Sign-in method** 탭 → **Google** 선택
4. 토글을 **사용 설정**으로 변경
5. 이메일 선택 후 **저장**

✅ 완료!

---

### 4️⃣ Backend 설정 (2분)

1. **프로젝트 설정** ⚙️ 클릭
2. **서비스 계정** 탭 클릭
3. **새 비공개 키 생성** 클릭
4. **키 생성** 확인
5. 다운로드한 JSON 파일을 다음 위치에 복사:
   ```bash
   # 파일 이름을 변경하여 복사
   cp ~/Downloads/saytodo-xxxxx-firebase-adminsdk-xxxxx.json \
      /home/user/webapp/voip-server/firebase-service-account.json
   ```

✅ 완료!

---

### 5️⃣ Web Client ID 설정 (1분)

1. **프로젝트 설정** → **일반** 탭
2. 아래로 스크롤 → **Web Client ID** 복사
   ```
   형식: 123456789012-abcdefghijklmnopqrstuvwxyz123456.apps.googleusercontent.com
   ```
3. App.tsx 파일 수정:
   ```bash
   cd /home/user/webapp/SayToDo
   nano App.tsx
   ```
4. 다음 줄 찾아서 수정:
   ```typescript
   // 변경 전:
   const GOOGLE_WEB_CLIENT_ID = 'YOUR_WEB_CLIENT_ID.apps.googleusercontent.com';
   
   // 변경 후:
   const GOOGLE_WEB_CLIENT_ID = '123456789012-abcdefghijklmnopqrstuvwxyz123456.apps.googleusercontent.com';
   ```

✅ 완료!

---

### 6️⃣ SHA-1 등록 (2분)

1. SHA-1 인증서 확인:
   ```bash
   cd /home/user/webapp/SayToDo/android
   ./gradlew signingReport | grep SHA1
   ```
   
2. 출력에서 SHA1 값 복사:
   ```
   SHA1: AA:BB:CC:DD:EE:FF:11:22:33:44:55:66:77:88:99:00:AA:BB:CC:DD
   ```

3. **Firebase Console** → **프로젝트 설정**
4. **내 앱** → **SayToDo**
5. **SHA 인증서 지문** → **지문 추가**
6. SHA-1 값 붙여넣기 → **저장**

✅ 완료!

---

## 🎉 설정 완료! 이제 실행하세요!

### Backend 실행
```bash
cd /home/user/webapp/voip-server
npm install
npm start
```

**예상 출력**:
```
Firebase Admin SDK initialized successfully! ✅
VoIP Alarm Server started on port 3002
```

### Android 앱 실행
```bash
cd /home/user/webapp/SayToDo
npm install
npm run android
```

---

## ✅ 체크리스트

- [ ] Firebase 프로젝트 생성
- [ ] google-services.json 추가
- [ ] Google Sign-In 활성화
- [ ] firebase-service-account.json 추가
- [ ] Web Client ID 설정
- [ ] SHA-1 등록
- [ ] Backend 실행 성공
- [ ] Android 앱 실행 성공
- [ ] 구글 로그인 성공

---

## 🆘 문제 발생 시

### 자동 설정 스크립트 실행
```bash
cd /home/user/webapp
./setup-firebase.sh
```

### 상세 가이드 확인
```bash
cat /home/user/webapp/FIREBASE_SETUP_GUIDE.md
```

---

## 📞 일반적인 문제

### "google-services.json not found"
```bash
# 파일 위치 확인
ls -la /home/user/webapp/SayToDo/android/app/google-services.json

# 파일이 없으면 다시 복사
cp ~/Downloads/google-services.json /home/user/webapp/SayToDo/android/app/
```

### "Firebase Admin SDK failed"
```bash
# 파일 위치 확인
ls -la /home/user/webapp/voip-server/firebase-service-account.json

# 파일이 없으면 다시 다운로드
```

### "Google Sign-In failed"
```
원인: SHA-1 미등록
해결: Firebase Console에서 SHA-1 등록 확인
```

---

## 🎊 완료!

모든 설정이 끝났습니다! 

**다음 단계**:
1. 앱 실행
2. 구글 로그인
3. 채널 생성
4. 친구 초대
5. 긴급 알림 발송!

**즐거운 개발 되세요!** 🚀

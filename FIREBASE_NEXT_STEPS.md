# ✅ Firebase 프로젝트 생성 완료!

## 🎉 현재 상태: SayToDo 프로젝트 생성 완료

스크린샷 확인:
- ✅ Firebase Console 접속
- ✅ **프로젝트 "SayToDo" 생성 완료!**
- ✅ Gemini 사용 가능 안내 표시
- 🔄 다음: Android 앱 추가

---

## 🚀 다음 단계: Android 앱 추가

### Step 1: Android 앱 추가 버튼 클릭

화면에서 보이는 카드 중 하나를 클릭하세요:

**옵션 1: "웹 앱 추가" 옆의 Android 아이콘**
- Firebase Console 상단 또는 좌측에서
- **Android 아이콘** (📱) 찾기
- 클릭!

**옵션 2: 프로젝트 설정에서**
```
1. 왼쪽 상단 ⚙️ (톱니바퀴) 클릭
2. "프로젝트 설정" 선택
3. "앱 추가" 버튼 찾기
4. Android 선택
```

---

## 📱 Android 앱 등록 정보

다음 정보를 입력하세요:

### 필수 입력
```
Android 패키지 이름: com.saytodo
```

### 선택 입력 (나중에 가능)
```
앱 닉네임: SayToDo (선택사항)
디버그 서명 인증서 SHA-1: (지금은 건너뛰기, 나중에 추가)
```

### 입력 후
```
"앱 등록" 버튼 클릭
```

---

## 📥 google-services.json 다운로드

앱 등록 후 자동으로 다음 화면이 나타납니다:

### Step 2: 구성 파일 다운로드
```
1. "google-services.json 다운로드" 버튼 클릭
2. 파일이 ~/Downloads/ 폴더에 저장됨
```

### Step 3: 파일 복사
다운로드 완료 후 터미널에서 실행:

```bash
# Downloads에서 프로젝트로 복사
cp ~/Downloads/google-services.json /home/user/webapp/SayToDo/android/app/

# 복사 확인
ls -la /home/user/webapp/SayToDo/android/app/google-services.json
```

---

## 🔐 Google Sign-In 활성화

### Step 4: Authentication 설정
```
1. 왼쪽 메뉴에서 "Authentication" 클릭
2. "시작하기" 버튼 클릭 (처음이면)
3. "Sign-in method" 탭 클릭
4. "Google" 선택
5. 토글을 "사용 설정"으로 변경
6. 프로젝트 지원 이메일 선택
7. "저장" 클릭
```

---

## 🔑 Service Account 키 다운로드

### Step 5: 서비스 계정 키 생성
```
1. 왼쪽 상단 ⚙️ (톱니바퀴) → "프로젝트 설정"
2. "서비스 계정" 탭 클릭
3. "새 비공개 키 생성" 버튼 클릭
4. "키 생성" 확인
5. JSON 파일 다운로드 완료
```

### Step 6: 파일 이름 변경 및 복사
터미널에서 실행:

```bash
# Downloads 폴더로 이동
cd ~/Downloads

# 다운로드된 파일 확인 (파일명은 다를 수 있음)
ls -la saytodo-*

# 파일 복사 및 이름 변경
cp saytodo-*-firebase-adminsdk-*.json \
   /home/user/webapp/voip-server/firebase-service-account.json

# 복사 확인
ls -la /home/user/webapp/voip-server/firebase-service-account.json
```

---

## 🌐 Web Client ID 복사

### Step 7: Web Client ID 확인
```
1. 프로젝트 설정 → "일반" 탭
2. 아래로 스크롤
3. "내 앱" 섹션에서 "웹 앱" 찾기
4. "웹 클라이언트 ID" 복사
   형식: 123456789012-abcdefg...xyz.apps.googleusercontent.com
```

### Step 8: App.tsx에 설정
터미널에서:

```bash
# App.tsx 열기
nano /home/user/webapp/SayToDo/App.tsx

# 다음 줄을 찾아서:
const GOOGLE_WEB_CLIENT_ID = 'YOUR_WEB_CLIENT_ID.apps.googleusercontent.com';

# 복사한 Web Client ID로 변경:
const GOOGLE_WEB_CLIENT_ID = '123456789012-abcdefg...xyz.apps.googleusercontent.com';

# 저장: Ctrl+O, Enter, Ctrl+X
```

---

## 🔐 SHA-1 인증서 등록

### Step 9: SHA-1 확인
터미널에서:

```bash
cd /home/user/webapp/SayToDo/android
./gradlew signingReport | grep SHA1
```

출력 예시:
```
SHA1: AA:BB:CC:DD:EE:FF:11:22:33:44:55:66:77:88:99:00:AA:BB:CC:DD
```

### Step 10: Firebase에 등록
```
1. 프로젝트 설정 → "일반" 탭
2. "내 앱" → "SayToDo" (Android) 찾기
3. "SHA 인증서 지문" 섹션
4. "지문 추가" 버튼 클릭
5. SHA-1 값 붙여넣기
6. "저장" 클릭
```

---

## ✅ 설정 완료 확인

모든 단계 완료 후:

```bash
cd /home/user/webapp
./check-firebase.sh
```

**예상 출력**:
```
✅ Backend Firebase 설정 완료
✅ Android Firebase 설정 완료
✅ Google Sign-In 설정 완료

진행률: 3/3 (100%)

🎉 모든 Firebase 설정이 완료되었습니다!
```

---

## 🎯 빠른 체크리스트

- [ ] Android 앱 추가 (패키지: com.saytodo)
- [ ] google-services.json 다운로드 및 복사
- [ ] Google Sign-In 활성화
- [ ] Service Account JSON 다운로드 및 복사
- [ ] Web Client ID 복사 및 App.tsx 설정
- [ ] SHA-1 확인 및 Firebase 등록
- [ ] `./check-firebase.sh` 실행하여 확인

---

## 🚀 설정 완료 후 앱 실행

### Backend 실행
```bash
cd /home/user/webapp/voip-server
npm install
npm start
```

### Android 앱 실행
```bash
cd /home/user/webapp/SayToDo
npm install
npm run android
```

---

## 📞 현재 할 일

**지금 바로:**
1. Firebase Console에서 **Android 앱 추가** 버튼 찾기
2. 패키지 이름 입력: `com.saytodo`
3. 앱 등록 후 `google-services.json` 다운로드

**그 다음:**
- 위 체크리스트 순서대로 진행
- 각 단계마다 터미널 명령어 실행

---

**거의 다 왔습니다!** 🎉  
**Android 앱 추가부터 시작하세요!** 🚀  
**약 10분이면 완료됩니다!** ⏱️

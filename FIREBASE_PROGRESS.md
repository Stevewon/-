# 🔥 Firebase 프로젝트 생성 가이드 (현재 진행 중)

## ✅ 현재 단계: Google 애널리틱스 구성

스크린샷에서 보이는 대로 Google 애널리틱스 계정을 선택하고 계십니다.

### 선택 방법

**권장 옵션 1: 애널리틱스 사용 안 함** (빠른 설정)
- "애널리틱스 사용 안 함" 선택
- 이유: SayToDo 앱은 애널리틱스가 필수가 아닙니다
- 나중에 필요하면 언제든 추가 가능

**옵션 2: 기본 계정 선택**
- "Default Account for Firebase" 선택
- 기본 설정으로 진행

### 다음 단계

1. ✅ 프로젝트 이름: "SayToDo" (이미 입력했을 것으로 추정)
2. ✅ Google 애널리틱스 설정 (현재 단계)
3. ⏳ **"프로젝트 만들기" 버튼 클릭** ← 다음 할 일
4. ⏳ 프로젝트 준비 완료 대기 (약 30초)
5. ⏳ Android 앱 추가

---

## 📋 프로젝트 생성 후 해야 할 일

### 1단계: Android 앱 추가
```
1. Firebase 콘솔에서 Android 아이콘 클릭
2. 패키지 이름: com.saytodo
3. 앱 등록
```

### 2단계: google-services.json 다운로드
```
1. "google-services.json 다운로드" 버튼 클릭
2. 파일 저장
```

### 3단계: 파일 복사
```bash
cp ~/Downloads/google-services.json /home/user/webapp/SayToDo/android/app/
```

### 4단계: Google Sign-In 활성화
```
1. Authentication → Sign-in method
2. Google 활성화
```

### 5단계: Service Account 키 다운로드
```
1. 프로젝트 설정 → 서비스 계정
2. "새 비공개 키 생성" 클릭
3. JSON 다운로드
```

### 6단계: 파일 복사
```bash
cp ~/Downloads/saytodo-xxxxx-firebase-adminsdk-xxxxx.json \
   /home/user/webapp/voip-server/firebase-service-account.json
```

### 7단계: Web Client ID 복사
```
1. 프로젝트 설정 → 일반 탭
2. Web Client ID 복사
3. App.tsx에 입력
```

### 8단계: SHA-1 등록
```bash
cd /home/user/webapp/SayToDo/android
./gradlew signingReport | grep SHA1

# 출력된 SHA-1을 Firebase Console에 등록
```

---

## 🎯 빠른 체크리스트

프로젝트 생성 후 다음 순서로 진행하세요:

- [ ] Android 앱 추가 (패키지: com.saytodo)
- [ ] google-services.json 다운로드 및 복사
- [ ] Google Sign-In 활성화
- [ ] Service Account JSON 다운로드 및 복사
- [ ] Web Client ID 복사 및 설정
- [ ] SHA-1 등록
- [ ] 설정 확인: `./check-firebase.sh`

---

## 🚀 다음 할 일

**지금 바로:**
1. "프로젝트 만들기" 버튼 클릭
2. 30초 대기
3. Android 앱 추가 시작

**설정 완료 후:**
```bash
cd /home/user/webapp
./check-firebase.sh
```

---

## 📞 진행 중 궁금한 점이 있으면

각 단계별 상세 가이드:
- **FIREBASE_QUICK_START.md** - 빠른 가이드
- **FIREBASE_SETUP_GUIDE.md** - 상세 가이드

현재 상태 확인:
```bash
./check-firebase.sh
```

---

**프로젝트 생성을 계속 진행하세요!** 🚀  
**거의 다 왔습니다!** 💪

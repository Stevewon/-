# ✅ Step 1/3 완료! google-services.json 설정 성공!

## 🎉 현재 진행 상황

```
진행률: 1/3 (33%)

✅ Android Firebase 설정 완료
❌ Backend Firebase 설정 필요
❌ Google Sign-In 설정 필요
```

### ✅ 완료된 작업
- ✅ google-services.json 파일 복사 완료
- ✅ 프로젝트 ID: saytodo-3bbc6
- ✅ 패키지: com.saytodo
- ✅ 파일 위치: `/home/user/webapp/SayToDo/android/app/google-services.json`

---

## 🚀 다음 단계 2/3: Backend Firebase 설정

### Step 2-1: Service Account 키 다운로드

**Firebase Console에서:**
```
1. https://console.firebase.google.com 접속
2. SayToDo 프로젝트 선택
3. 왼쪽 상단 ⚙️ (톱니바퀴) 클릭
4. "프로젝트 설정" 선택
5. "서비스 계정" 탭 클릭
6. "새 비공개 키 생성" 버튼 클릭
7. "키 생성" 확인 클릭
8. JSON 파일 자동 다운로드
```

### Step 2-2: 다운로드한 파일 업로드

**방법 1: 파일 업로드 (권장)**
- 다운로드한 JSON 파일을 여기에 드래그 앤 드롭하거나
- 파일 내용을 복사해서 보내주세요

**방법 2: 터미널 명령어**
```bash
# Downloads 폴더에서
cp ~/Downloads/saytodo-3bbc6-firebase-adminsdk-*.json \
   /home/user/webapp/voip-server/firebase-service-account.json
```

---

## 🎯 다음 단계 3/3: Google Sign-In 설정

### Step 3-1: Google Sign-In 활성화

**Firebase Console에서:**
```
1. 왼쪽 메뉴에서 "Authentication" 클릭
2. "시작하기" 버튼 클릭
3. "Sign-in method" 탭 클릭
4. "Google" 선택
5. 토글을 "사용 설정"으로 변경
6. 이메일 선택
7. "저장" 클릭
```

### Step 3-2: Web Client ID 복사

**Firebase Console에서:**
```
1. 프로젝트 설정 → "일반" 탭
2. 아래로 스크롤
3. "웹 클라이언트 ID" 찾기
   형식: 1068989331005-xxxxx...xxxxx.apps.googleusercontent.com
4. 복사!
```

### Step 3-3: App.tsx에 설정

복사한 Web Client ID를 알려주시면 제가 바로 설정해드리겠습니다!

또는:
```bash
nano /home/user/webapp/SayToDo/App.tsx

# 이 줄을 찾아서:
const GOOGLE_WEB_CLIENT_ID = 'YOUR_WEB_CLIENT_ID.apps.googleusercontent.com';

# Web Client ID로 변경
```

---

## 📊 체크리스트

- [x] 1. google-services.json 설정 ✅
- [ ] 2. firebase-service-account.json 설정
- [ ] 3. Web Client ID 설정
- [ ] 4. SHA-1 등록 (선택, 나중에 가능)
- [ ] 5. 최종 확인

---

## 🎯 지금 할 일

**Firebase Console로 돌아가서:**

1. **⚙️ 프로젝트 설정** 클릭
2. **"서비스 계정"** 탭 클릭
3. **"새 비공개 키 생성"** 버튼 클릭
4. JSON 파일 다운로드
5. **이 채팅에 파일 업로드** 또는 내용 복사해서 보내주기

---

**정말 잘하고 계십니다!** 🎉  
**이미 33% 완료했습니다!** 💪  
**다음 두 단계만 하면 끝입니다!** 🚀

Service Account JSON 파일을 다운로드하여 업로드해주세요!

# Firebase Step 3/3: Google Sign-In Web Client ID 설정

## 📋 체크리스트
- [x] Step 1: google-services.json 설정 완료
- [x] Step 2: firebase-service-account.json 설정 완료
- [ ] Step 3: Web Client ID 설정 (현재 단계)

## 🎯 목표
App.tsx에 Google Sign-In Web Client ID를 설정합니다.

## 📍 Web Client ID 찾는 방법

### 방법 1: Firebase Console에서 직접 확인 (추천)
1. Firebase Console 접속: https://console.firebase.google.com
2. SayToDo 프로젝트 선택
3. 왼쪽 상단 **⚙️ → 프로젝트 설정**
4. **일반** 탭 선택
5. 아래로 스크롤하여 **내 앱** 섹션에서 **Android 앱 (com.saytodo)** 찾기
6. **웹 API 키** 또는 **웹 클라이언트 ID** 확인
   - 형식: `XXXXXXXXXX-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX.apps.googleusercontent.com`

### 방법 2: google-services.json에서 확인
```bash
cat /home/user/webapp/SayToDo/android/app/google-services.json
```

출력 예시:
```json
{
  "project_info": {
    "project_number": "123456789",
    "project_id": "saytodo-3bbc6"
  },
  "client": [
    {
      "client_info": {
        "mobilesdk_app_id": "...",
        "android_client_info": {
          "package_name": "com.saytodo"
        }
      },
      "oauth_client": [
        {
          "client_id": "여기에 Web Client ID가 있습니다!",
          "client_type": 3
        }
      ]
    }
  ]
}
```

## 📝 설정 방법

### 1단계: Web Client ID 확인
위 방법으로 Web Client ID를 찾습니다.
형식: `XXXXXXXXXX-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX.apps.googleusercontent.com`

### 2단계: App.tsx 수정
```bash
# App.tsx 열기
nano /home/user/webapp/SayToDo/App.tsx
```

다음 라인을 찾아서:
```typescript
const GOOGLE_WEB_CLIENT_ID = 'YOUR_WEB_CLIENT_ID.apps.googleusercontent.com';
```

실제 Web Client ID로 변경:
```typescript
const GOOGLE_WEB_CLIENT_ID = '123456789-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com';
```

### 3단계: 저장 및 확인
```bash
# 변경사항 확인
cd /home/user/webapp && ./check-firebase.sh
```

## 🎉 완료 시 예상 출력
```
===========================================
    Firebase 설정 상태 점검
===========================================

필요한 Firebase 설정 파일 및 설정:

1) firebase-service-account.json
   위치: /home/user/webapp/voip-server/
   용도: Backend FCM 푸시 발송

2) google-services.json
   위치: /home/user/webapp/SayToDo/android/app/
   용도: Android FCM 수신

3) Web Client ID
   위치: /home/user/webapp/SayToDo/App.tsx
   용도: Google Sign-In

===========================================

[Step 1] firebase-service-account.json 확인
✅ 파일이 존재합니다!
   프로젝트 ID: saytodo-3bbc6

[Step 2] google-services.json 확인
✅ 파일이 존재합니다!
   패키지 이름: com.saytodo

[Step 3] Web Client ID 확인
✅ Web Client ID가 설정되었습니다!
   Client ID: 123456789-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com

===========================================

✅ Backend Firebase 설정 완료
✅ Android Firebase 설정 완료
✅ Google Sign-In 설정 완료

진행률: 3/3 (100%)

===========================================
    🎉 모든 Firebase 설정이 완료되었습니다!
===========================================
```

## 📚 다음 단계
Firebase 설정이 완료되면:
1. SHA-1 인증서 등록 (선택사항, 구글 로그인 작동에 필요)
2. Backend 서버 실행
3. Android 앱 빌드 및 실행

## 🔗 관련 문서
- FIREBASE_QUICK_START.md
- FIREBASE_SETUP_GUIDE.md
- FIREBASE_SETUP_COMPLETE.md

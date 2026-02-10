# 🔐 Google Sign-In 활성화 필수!

## ⚠️ 현재 문제
`google-services.json` 파일에 `oauth_client` 정보가 없습니다.
이는 Firebase Console에서 **Google Sign-In을 활성화하지 않았기 때문**입니다.

## 🎯 해결 방법

### 1단계: Firebase Console에서 Google Sign-In 활성화

1. **Firebase Console 접속**
   - URL: https://console.firebase.google.com
   - SayToDo 프로젝트 선택

2. **Authentication 메뉴 진입**
   - 왼쪽 메뉴에서 **빌드 (Build)** 섹션 찾기
   - **Authentication** 클릭
   - 처음이면 **시작하기** 버튼 클릭

3. **Sign-in method 탭**
   - 상단 탭 중 **Sign-in method** 선택
   - 또는 **로그인 제공업체** 섹션 찾기

4. **Google 활성화**
   - 제공업체 목록에서 **Google** 찾기
   - **Google** 행 클릭
   - **사용 설정** 토글 켜기 (ON)
   - **프로젝트 지원 이메일** 선택 (본인 이메일)
   - **저장** 버튼 클릭

### 2단계: google-services.json 다시 다운로드

Google Sign-In을 활성화한 후 **반드시** google-services.json을 다시 다운로드해야 합니다!

1. **프로젝트 설정**
   - 왼쪽 상단 ⚙️ → 프로젝트 설정
   - **일반** 탭 선택

2. **google-services.json 다시 다운로드**
   - 아래로 스크롤하여 **내 앱** 섹션 찾기
   - **Android 앱 (com.saytodo)** 찾기
   - **google-services.json** 다운로드 버튼 클릭
   - 새로운 google-services.json 파일 다운로드

3. **이 채팅에 업로드**
   - 다운로드한 새 google-services.json 파일을 이 채팅에 업로드

### 3단계: 자동으로 처리됩니다
새 google-services.json을 업로드하면:
- ✅ 올바른 위치에 복사
- ✅ Web Client ID 자동 추출
- ✅ App.tsx 자동 업데이트
- ✅ Firebase 설정 자동 확인

## 📸 스크린샷 가이드

### 1. Authentication 메뉴
```
좌측 메뉴:
├── 빌드 (Build)
│   ├── Authentication  ← 여기 클릭!
│   ├── Firestore Database
│   ├── Realtime Database
│   └── Storage
```

### 2. Sign-in method 탭
```
상단 탭:
[Users] [Sign-in method] [Templates] [Settings]
           ↑
        여기 클릭!
```

### 3. Google 활성화
```
제공업체 목록:
┌─────────────────────────────────────┐
│ Google                    [사용 중지] │ ← 이 행 클릭
├─────────────────────────────────────┤
│ 이메일/비밀번호           [사용 중지] │
└─────────────────────────────────────┘

클릭 후:
┌─────────────────────────────────────┐
│ Google 로그인 구성                   │
│                                     │
│ [ON] 사용 설정                      │
│                                     │
│ 프로젝트 지원 이메일:               │
│ [your-email@example.com ▼]         │
│                                     │
│              [취소]  [저장]         │ ← 저장 클릭
└─────────────────────────────────────┘
```

### 4. google-services.json 다시 다운로드
```
프로젝트 설정 → 일반 탭 → 내 앱:

┌─────────────────────────────────────┐
│ Android 앱                          │
│ com.saytodo                         │
│                                     │
│ [google-services.json 다운로드]     │ ← 클릭!
└─────────────────────────────────────┘
```

## ✅ 성공 확인

새 google-services.json에는 다음과 같은 내용이 포함됩니다:

```json
{
  "oauth_client": [
    {
      "client_id": "1068989331005-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com",
      "client_type": 3
    }
  ]
}
```

`oauth_client` 배열에 **Web Client ID**가 포함되어 있어야 합니다!

## 🚀 다음 단계

1. **지금 할 일:**
   - Firebase Console → Authentication → Sign-in method
   - Google 활성화
   - google-services.json 다시 다운로드
   - 이 채팅에 업로드

2. **완료 후:**
   - 자동으로 App.tsx 업데이트
   - Firebase 설정 3/3 완료
   - 앱 빌드 및 실행 준비 완료

## 📚 관련 문서
- FIREBASE_STEP_3.md
- FIREBASE_QUICK_START.md
- FIREBASE_SETUP_GUIDE.md

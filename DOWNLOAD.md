# 📱 시큐렛 메신저 APK 다운로드

## 🚀 빠른 다운로드

### 방법 1: GitHub Releases (가장 쉬움)

[![Download APK](https://img.shields.io/badge/Download-APK-blue?style=for-the-badge&logo=android)](../../releases/latest)

1. 위 버튼 클릭 또는 저장소의 **[Releases](../../releases)** 페이지 이동
2. 최신 릴리스에서 **app-debug.apk** 다운로드
3. Android 기기에 설치

### 방법 2: GitHub Actions Artifacts

1. 저장소의 **[Actions](../../actions)** 탭 이동
2. 최신 "Build Android APK" 워크플로우 클릭
3. 하단 "Artifacts" 섹션에서 **securet-messenger-debug** 다운로드
4. ZIP 압축 해제 후 APK 설치

## 📲 설치 방법

### 1단계: 보안 설정
- **설정** → **보안** → **알 수 없는 출처** 허용
- 또는 **설정** → **앱** → **특별한 앱 액세스** → **알 수 없는 앱 설치** 허용

### 2단계: APK 설치
1. 다운로드한 APK 파일 찾기
2. 파일 탭하여 실행
3. **설치** 버튼 클릭
4. 완료!

## 🔐 권한 요청

앱 실행 시 다음 권한을 요청합니다:
- 📷 **카메라**: QR 코드 스캔용
- 📁 **파일**: 파일 공유용
- 🔔 **알림**: 메시지 알림용
- 🎤 **마이크**: 음성/영상 통화용 (향후 지원)

## ✅ 앱 정보

| 항목 | 내용 |
|------|------|
| 앱 이름 | Securet Messenger |
| 패키지명 | com.securet.messenger |
| 최소 Android | 5.1 (API 22) |
| 타겟 Android | 14 (API 34) |
| 앱 크기 | ~15MB |

## 🎯 주요 기능

### 🔐 보안 중심
- 시큐렛 QR 주소로만 친구 추가 가능
- QR 코드 스캔 방식
- URL 형식 호환 (안드로이드 시큐렛 앱)

### 💬 채팅
- **1:1 채팅**: QR 기반 친구와 대화
- **그룹 채팅**: 이메일로 멤버 초대
- **실시간 메시징**: WebSocket
- **읽음 표시**: 메시지 확인 상태

### 📎 파일 공유
- 최대 10MB 파일 전송
- 이미지, 문서, 동영상 등

### 📱 QR 기능
- QR 코드 생성: 내 시큐렛 주소
- QR 코드 스캔: 친구 추가
- QR 코드 저장: 이미지로 저장

## 🔄 업데이트

### 자동 빌드
- **main** 브랜치에 푸시할 때마다 자동으로 새 APK 생성
- [Releases](../../releases) 페이지에서 최신 버전 확인

### 버전 확인
- 앱 설정에서 현재 버전 확인 가능
- 새 버전 알림 (향후 추가 예정)

## ❓ 문제 해결

### "파일을 열 수 없음" 오류
- 파일이 완전히 다운로드되었는지 확인
- Chrome이 아닌 다른 브라우저로 다운로드 시도
- 다운로드 폴더 확인

### "앱이 설치되지 않음" 오류
- "알 수 없는 출처" 허용 확인
- 저장 공간 충분한지 확인
- 기존 앱 삭제 후 재설치

### 앱이 실행되지 않음
- Android 버전 5.1 이상인지 확인
- 앱 재설치
- 기기 재부팅

### QR 스캔이 안됨
- 카메라 권한 허용 확인
- 조명이 충분한 곳에서 스캔
- QR 코드가 선명한지 확인

## 🛠 개발자용

### 직접 빌드하기

```bash
# 저장소 클론
git clone [repository-url]
cd webapp

# 의존성 설치
npm install

# APK 빌드
./build-apk.sh
```

상세한 빌드 방법은 [ANDROID_BUILD.md](./ANDROID_BUILD.md) 참조

### ADB로 설치

```bash
# USB 디버깅 활성화 필요
adb install app-debug.apk

# 무선 설치
adb connect [IP주소]:5555
adb install app-debug.apk
```

## 📞 지원

- 🐛 **버그 제보**: [Issues](../../issues)
- 💡 **기능 요청**: [Issues](../../issues)
- 📖 **문서**: [README.md](./README.md)
- 🔧 **빌드 가이드**: [ANDROID_BUILD.md](./ANDROID_BUILD.md)

## 🎉 시작하기

1. **[여기서 APK 다운로드](../../releases/latest)** 👈
2. Android 기기에 설치
3. 회원가입 (이메일 + 닉네임 + 시큐렛 QR 주소)
4. 친구와 QR 코드 공유
5. 안전한 채팅 시작!

---

**시큐렛 메신저로 프라이버시를 지키며 소통하세요!** 🔐💬

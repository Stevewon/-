# 🚀 시큐렛 메신저 APK 즉시 다운로드

## 📱 APK 파일 바로 받기

### 방법 1: GitHub Releases에서 다운로드 (추천)

저장소를 GitHub에 푸시한 후:

1. **GitHub Actions 자동 빌드 설정**
2. **Releases에서 APK 다운로드**

아래 설정으로 자동으로 APK가 생성됩니다!

---

## ⚡ GitHub Actions 자동 빌드 설정

### 1. 워크플로우 파일 생성

프로젝트에 `.github/workflows/build-apk.yml` 생성:

```yaml
name: Build Android APK

on:
  push:
    branches: [ main ]
    tags:
      - 'v*'
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest
    
    steps:
    - name: Checkout code
      uses: actions/checkout@v4
    
    - name: Setup Java 17
      uses: actions/setup-java@v4
      with:
        java-version: '17'
        distribution: 'temurin'
    
    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: '18'
        cache: 'npm'
    
    - name: Install dependencies
      run: npm ci
    
    - name: Build web app
      run: npm run build
    
    - name: Sync Capacitor
      run: npx cap sync android
    
    - name: Make gradlew executable
      run: chmod +x android/gradlew
    
    - name: Build Debug APK
      run: |
        cd android
        ./gradlew assembleDebug --no-daemon
    
    - name: Upload APK Artifact
      uses: actions/upload-artifact@v4
      with:
        name: securet-messenger-debug
        path: android/app/build/outputs/apk/debug/app-debug.apk
        retention-days: 30
    
    - name: Create Release (on tag)
      if: startsWith(github.ref, 'refs/tags/')
      uses: softprops/action-gh-release@v1
      with:
        files: android/app/build/outputs/apk/debug/app-debug.apk
        body: |
          ## 시큐렛 메신저 Android APK
          
          ### 다운로드
          - app-debug.apk 다운로드
          
          ### 설치 방법
          1. APK 파일 다운로드
          2. Android 기기로 전송
          3. "알 수 없는 출처" 허용
          4. APK 파일 탭하여 설치
          
          ### 주의사항
          - 최소 Android 5.1 (API 22) 이상 필요
          - 카메라 권한 필요 (QR 스캔용)
      env:
        GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### 2. GitHub에 푸시

```bash
git add .github/workflows/build-apk.yml
git commit -m "chore: GitHub Actions APK 자동 빌드 설정"
git push origin main
```

### 3. APK 다운로드

#### Actions에서 다운로드 (매 푸시마다)
1. GitHub 저장소 → **Actions** 탭
2. 최신 워크플로우 실행 클릭
3. **Artifacts** 섹션에서 `securet-messenger-debug` 다운로드
4. ZIP 압축 해제 → `app-debug.apk` 파일 사용

#### Releases에서 다운로드 (태그 생성 시)
```bash
# 릴리스 태그 생성
git tag v1.0.0
git push origin v1.0.0
```

1. GitHub 저장소 → **Releases** 탭
2. 최신 릴리스 클릭
3. **Assets**에서 `app-debug.apk` 직접 다운로드

---

## 🖥️ 로컬에서 직접 빌드 (빠른 방법)

### 사전 준비
```bash
# Java 17 설치 확인
java -version

# 없으면 설치
# Ubuntu/Debian
sudo apt install openjdk-17-jdk

# macOS
brew install openjdk@17

# Windows
# https://adoptium.net/ 에서 다운로드
```

### 빌드 명령어
```bash
# 1. 저장소 클론
git clone [your-repo-url]
cd webapp

# 2. 의존성 설치
npm install

# 3. 웹 빌드
npm run build

# 4. Capacitor 동기화
npx cap sync android

# 5. APK 빌드
cd android
chmod +x gradlew
./gradlew assembleDebug

# APK 위치
# android/app/build/outputs/apk/debug/app-debug.apk
```

또는 간단하게:
```bash
./build-apk.sh
```

---

## 📲 APK 설치 방법

### Android 기기에 설치

1. **보안 설정 변경**
   - 설정 → 보안 → "알 수 없는 출처" 허용
   - 또는: 설정 → 앱 → 특수 앱 접근 → 알 수 없는 앱 설치

2. **APK 파일 전송**
   - USB 케이블로 전송
   - 또는 이메일/클라우드로 다운로드

3. **설치**
   - 파일 관리자에서 APK 파일 탭
   - "설치" 버튼 클릭
   - 권한 허용

### ADB로 설치 (개발자)
```bash
# USB 디버깅 활성화 필요
adb install app-debug.apk

# 또는 무선으로
adb connect [IP주소]:5555
adb install app-debug.apk
```

---

## 🌐 현재 설정된 서버

**백엔드 서버**: https://3001-i9hxkysto1zzwy5b3ntbw-2e77fc33.sandbox.novita.ai

### 자신의 서버로 변경하려면

`.env.production` 파일 수정:
```bash
VITE_API_URL=https://your-server.com
```

재빌드 필요:
```bash
npm run build
npx cap sync android
```

---

## 🎯 즉시 테스트하기 (가장 빠른 방법)

### CloudFlare Pages + GitHub Actions 사용

1. **GitHub에 코드 푸시**
2. **Actions가 자동으로 APK 빌드** (약 5분 소요)
3. **Actions → Artifacts에서 즉시 다운로드**
4. **핸드폰에 설치하여 테스트**

이 방법이 **가장 쉽고 빠릅니다**! 🚀

---

## 📦 현재 제공 가능한 파일

### 소스코드 압축 파일
`/home/user/securet-source.tar.gz` (약 2MB)

이 파일을 다운로드하여 로컬에서 빌드하시면 됩니다!

### 포함된 내용
- ✅ 완전한 소스코드
- ✅ Android 프로젝트 설정
- ✅ Capacitor 설정
- ✅ 빌드 스크립트
- ✅ 상세 문서

---

## 🚨 중요 안내

**샌드박스 환경**에서는 Java 17이 없어 APK를 직접 빌드할 수 없습니다.

다음 중 하나를 선택하세요:

1. ✅ **GitHub Actions 사용** (가장 추천! 자동화)
2. ✅ **로컬에서 빌드** (Java 17 설치 필요)
3. ✅ **Docker 사용** (격리된 환경)

---

## 🎉 다음 단계

1. **GitHub에 푸시**
2. **Actions 설정**
3. **APK 자동 빌드**
4. **핸드폰에 설치**
5. **테스트!**

질문이나 문제가 있으시면 Issues에 남겨주세요! 📱✨

# 🚀 시큐렛 메신저 - 빠른 APK 다운로드 가이드

## 📱 APK 받는 방법 (3가지)

### 방법 1: 직접 빌드 (권장)

#### 사전 준비
- Java 17+ 설치
- Android Studio 설치 (선택)

#### 빌드 명령어
```bash
# 1. 저장소 클론
git clone [repository-url]
cd webapp

# 2. 의존성 설치
npm install

# 3. APK 빌드
./build-apk.sh
```

#### APK 위치
```
android/app/build/outputs/apk/debug/app-debug.apk
```

### 방법 2: GitHub Actions로 자동 빌드

#### 1. GitHub Actions 워크플로우 설정

`.github/workflows/build-apk.yml` 생성:

```yaml
name: Build Android APK

on:
  push:
    branches: [ main ]
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Set up JDK 17
      uses: actions/setup-java@v3
      with:
        java-version: '17'
        distribution: 'temurin'
    
    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '18'
    
    - name: Install dependencies
      run: npm install
    
    - name: Build web app
      run: npm run build
    
    - name: Sync Capacitor
      run: npx cap sync android
    
    - name: Build APK
      run: |
        cd android
        chmod +x gradlew
        ./gradlew assembleDebug
    
    - name: Upload APK
      uses: actions/upload-artifact@v3
      with:
        name: app-debug
        path: android/app/build/outputs/apk/debug/app-debug.apk
```

#### 2. APK 다운로드
1. GitHub 저장소의 "Actions" 탭 이동
2. 최신 워크플로우 실행 클릭
3. "Artifacts" 섹션에서 `app-debug` 다운로드

### 방법 3: Docker를 사용한 빌드

#### Dockerfile 생성
```dockerfile
FROM eclipse-temurin:17-jdk

# Android SDK 설치
ENV ANDROID_SDK_ROOT=/opt/android-sdk
RUN mkdir -p ${ANDROID_SDK_ROOT}/cmdline-tools

# Android SDK Command Line Tools 다운로드
RUN wget https://dl.google.com/android/repository/commandlinetools-linux-9477386_latest.zip -O /tmp/cmdline-tools.zip && \
    unzip /tmp/cmdline-tools.zip -d ${ANDROID_SDK_ROOT}/cmdline-tools && \
    mv ${ANDROID_SDK_ROOT}/cmdline-tools/cmdline-tools ${ANDROID_SDK_ROOT}/cmdline-tools/latest

ENV PATH=${PATH}:${ANDROID_SDK_ROOT}/cmdline-tools/latest/bin:${ANDROID_SDK_ROOT}/platform-tools

# SDK 라이선스 동의
RUN yes | sdkmanager --licenses

# Node.js 설치
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && \
    apt-get install -y nodejs

WORKDIR /app
COPY . .

RUN npm install && \
    npm run build && \
    npx cap sync android

WORKDIR /app/android
RUN ./gradlew assembleDebug

# APK를 /output으로 복사
RUN mkdir -p /output && \
    cp app/build/outputs/apk/debug/app-debug.apk /output/
```

#### 빌드 및 추출
```bash
# 이미지 빌드
docker build -t securet-builder .

# APK 추출
docker run --rm -v $(pwd)/output:/output securet-builder cp /output/app-debug.apk /output/
```

## 📲 APK 설치 방법

### Android 기기에서

#### 1. 보안 설정 변경
- 설정 → 보안 → "알 수 없는 출처" 허용

#### 2. APK 설치
- APK 파일을 기기로 전송
- 파일 관리자에서 APK 파일 탭
- "설치" 버튼 클릭

### ADB 사용 (개발자용)

```bash
# USB 디버깅 활성화 필요
adb install app-debug.apk

# 또는 무선으로
adb connect [IP주소]:5555
adb install app-debug.apk
```

## 🔐 서명된 Release APK 만들기

### 1. Keystore 생성
```bash
keytool -genkey -v -keystore securet-release-key.jks \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias securet-key
```

### 2. GitHub Secrets 설정
- `KEYSTORE_PASSWORD`: Keystore 비밀번호
- `KEY_ALIAS`: 키 별칭
- `KEY_PASSWORD`: 키 비밀번호
- `KEYSTORE_FILE`: Base64 인코딩된 keystore 파일

```bash
# Keystore를 Base64로 인코딩
cat securet-release-key.jks | base64
```

### 3. GitHub Actions 워크플로우 수정

```yaml
- name: Decode Keystore
  run: |
    echo "${{ secrets.KEYSTORE_FILE }}" | base64 -d > android/app/securet-release-key.jks

- name: Build Release APK
  run: |
    cd android
    ./gradlew assembleRelease
  env:
    KEYSTORE_PASSWORD: ${{ secrets.KEYSTORE_PASSWORD }}
    KEY_ALIAS: ${{ secrets.KEY_ALIAS }}
    KEY_PASSWORD: ${{ secrets.KEY_PASSWORD }}
```

## 📦 APK 크기 최적화

### build.gradle 설정
```gradle
android {
    buildTypes {
        release {
            minifyEnabled true
            shrinkResources true
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
        }
    }
}
```

### App Bundle (AAB) 생성
```bash
cd android
./gradlew bundleRelease
```

## 🎯 빠른 테스트용 APK 다운로드

### Pre-built APK 다운로드 (GitHub Releases)

1. 저장소의 "Releases" 탭 이동
2. 최신 릴리스 선택
3. Assets에서 `app-debug.apk` 다운로드

## ⚙️ 서버 URL 변경

프로덕션 서버로 변경하려면:

```bash
# .env.production 파일 수정
echo "VITE_API_URL=https://your-production-server.com" > .env.production

# 재빌드
npm run build
npx cap sync android
```

## 🐛 문제 해결

### "Java 17 필요" 오류
```bash
# Ubuntu/Debian
sudo apt install openjdk-17-jdk

# macOS
brew install openjdk@17
```

### Gradle 빌드 실패
```bash
cd android
./gradlew clean
./gradlew assembleDebug --stacktrace
```

### Capacitor 동기화 문제
```bash
npx cap sync android --force
```

## 📞 도움말

- 상세 가이드: [ANDROID_BUILD.md](./ANDROID_BUILD.md)
- Capacitor 문서: https://capacitorjs.com/docs
- 이슈 제보: GitHub Issues

---

**빠르게 APK를 받아서 시큐렛 메신저를 테스트해보세요!** 📱✨

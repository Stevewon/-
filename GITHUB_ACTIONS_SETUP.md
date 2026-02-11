# 🚀 GitHub Actions 자동 APK 빌드 설정 가이드

## 📦 자동으로 APK가 생성됩니다!

코드를 GitHub에 푸시하면 **자동으로 APK가 빌드**됩니다!

---

## 🔧 설정 방법 (5분)

### 1️⃣ GitHub 저장소 생성

1. GitHub에 로그인
2. New repository 클릭
3. 저장소 이름: `saytodo` (또는 원하는 이름)
4. Public 또는 Private 선택
5. Create repository

---

### 2️⃣ Secrets 설정

1. GitHub 저장소 → **Settings** → **Secrets and variables** → **Actions**
2. **New repository secret** 클릭
3. 아래 Secret 추가:

#### Secret: `GOOGLE_SERVICES_JSON`
```bash
# 터미널에서 실행하여 내용 복사:
cat /home/user/webapp/SayToDo/android/app/google-services.json
```
- Name: `GOOGLE_SERVICES_JSON`
- Value: 위 명령어로 출력된 전체 JSON 내용을 복사해서 붙여넣기

---

### 3️⃣ 코드 푸시

```bash
cd /home/user/webapp

# Git remote 추가 (저장소 URL을 본인 것으로 변경)
git remote add origin https://github.com/YOUR_USERNAME/saytodo.git

# 또는 기존 remote 변경
git remote set-url origin https://github.com/YOUR_USERNAME/saytodo.git

# 푸시
git add .
git commit -m "Add GitHub Actions for APK build"
git push -u origin main
```

---

## 📱 APK 다운로드 방법

### 푸시 직후:

1. **GitHub 저장소** → **Actions** 탭
2. **Build Android APK** 워크플로우 클릭
3. 실행 중인 빌드 확인 (⏳ 노란색)
4. **10-15분 후** 빌드 완료 (✅ 초록색)
5. **Artifacts** 섹션에서 `SayToDo-APK` 클릭
6. **ZIP 파일 다운로드** → 압축 해제 → `app-release.apk` 확인!

### 또는 Release에서:

1. **GitHub 저장소** → **Releases** 탭
2. 최신 Release 클릭
3. **Assets** 섹션에서 `app-release.apk` 다운로드

---

## 📱 APK 설치 (모바일)

### 방법 1: 직접 다운로드
1. GitHub Release 페이지를 모바일에서 열기
2. `app-release.apk` 다운로드
3. "출처 모르는 앱 허용" 설정
4. APK 설치

### 방법 2: PC → 모바일 전송
1. PC에서 APK 다운로드
2. USB, 이메일, 클라우드 등으로 모바일에 전송
3. 모바일에서 APK 설치

---

## 🔄 자동 빌드 트리거

### 언제 자동으로 APK가 빌드되나요?

1. **main 브랜치에 푸시할 때**
   ```bash
   git add .
   git commit -m "Update app"
   git push
   ```
   → 자동으로 APK 빌드 시작!

2. **Pull Request 생성할 때**
   → PR마다 APK 빌드 확인 가능

3. **수동 실행**
   - GitHub → Actions → Build Android APK
   - "Run workflow" 버튼 클릭

---

## ⏱️ 빌드 시간

- **첫 빌드**: 10-15분
- **이후 빌드**: 5-10분 (캐시 사용)

---

## 📋 빌드 로그 확인

1. GitHub → Actions
2. 실행 중인/완료된 워크플로우 클릭
3. 각 단계별 로그 확인 가능

---

## 🎯 테스트 워크플로우

### 1. 코드 수정
```bash
cd /home/user/webapp/SayToDo
# 앱 코드 수정...
```

### 2. 커밋 & 푸시
```bash
git add .
git commit -m "Update feature"
git push
```

### 3. APK 다운로드
- 10분 후 GitHub Actions에서 APK 다운로드
- 모바일에 설치하여 테스트

### 4. 반복
- 수정 → 푸시 → 자동 빌드 → 다운로드 → 테스트

---

## 🔐 보안

- ✅ `google-services.json`은 Secrets로 안전하게 보관
- ✅ 빌드 중에만 파일 생성
- ✅ 빌드 후 자동 삭제

---

## 💡 추가 팁

### APK를 매번 다운로드하지 않으려면?

Release 페이지의 URL을 북마크하세요:
```
https://github.com/YOUR_USERNAME/saytodo/releases/latest
```
→ 항상 최신 APK 다운로드 가능!

### 모바일에서 빠르게 설치하려면?

1. Release 페이지 URL을 QR 코드로 생성
2. 모바일에서 QR 스캔 → 바로 APK 다운로드

---

## 📊 현재 상태

✅ GitHub Actions 워크플로우 생성 완료
✅ 자동 APK 빌드 설정 완료
✅ Release 자동 생성 설정 완료
⏳ GitHub에 푸시 대기 중

---

## 🚀 시작하기

```bash
# 1. GitHub 저장소 생성
# 2. Secrets 설정 (GOOGLE_SERVICES_JSON)
# 3. 푸시
cd /home/user/webapp
git remote add origin https://github.com/YOUR_USERNAME/saytodo.git
git add .
git commit -m "Add GitHub Actions for APK build"
git push -u origin main

# 4. GitHub Actions 확인
# 5. APK 다운로드!
```

---

**10분 후 모바일에서 테스트하세요!** 🎉

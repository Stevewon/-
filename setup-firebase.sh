#!/bin/bash

# SayToDo Firebase Setup Script
# 이 스크립트는 Firebase 설정 파일을 올바른 위치에 복사합니다

echo "🔥 SayToDo Firebase 설정 스크립트"
echo "=================================="
echo ""

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 프로젝트 루트 디렉토리
PROJECT_ROOT="/home/user/webapp"
BACKEND_DIR="$PROJECT_ROOT/voip-server"
ANDROID_DIR="$PROJECT_ROOT/SayToDo/android/app"

# 1. firebase-service-account.json 설정
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📱 Step 1: Backend Firebase 설정"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ -f "$BACKEND_DIR/firebase-service-account.json" ]; then
    echo -e "${GREEN}✅ firebase-service-account.json이 이미 존재합니다${NC}"
    echo "   위치: $BACKEND_DIR/firebase-service-account.json"
else
    echo -e "${YELLOW}⚠️  firebase-service-account.json을 찾을 수 없습니다${NC}"
    echo ""
    echo "다음 단계를 따라주세요:"
    echo "1. Firebase Console (https://console.firebase.google.com)"
    echo "2. 프로젝트 설정 → 서비스 계정"
    echo "3. '새 비공개 키 생성' 클릭"
    echo "4. 다운로드한 JSON 파일을 다음 위치에 복사:"
    echo "   $BACKEND_DIR/firebase-service-account.json"
    echo ""
    read -p "파일을 복사했으면 Enter를 누르세요..."
    
    if [ -f "$BACKEND_DIR/firebase-service-account.json" ]; then
        echo -e "${GREEN}✅ 파일이 확인되었습니다!${NC}"
    else
        echo -e "${RED}❌ 파일을 찾을 수 없습니다. 다시 확인해주세요.${NC}"
        exit 1
    fi
fi

echo ""

# 2. google-services.json 설정
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📲 Step 2: Android Firebase 설정"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ -f "$ANDROID_DIR/google-services.json" ]; then
    echo -e "${GREEN}✅ google-services.json이 이미 존재합니다${NC}"
    echo "   위치: $ANDROID_DIR/google-services.json"
else
    echo -e "${YELLOW}⚠️  google-services.json을 찾을 수 없습니다${NC}"
    echo ""
    echo "다음 단계를 따라주세요:"
    echo "1. Firebase Console (https://console.firebase.google.com)"
    echo "2. 프로젝트 설정 → 일반"
    echo "3. 내 앱 → SayToDo (Android)"
    echo "4. 'google-services.json 다운로드' 클릭"
    echo "5. 다운로드한 파일을 다음 위치에 복사:"
    echo "   $ANDROID_DIR/google-services.json"
    echo ""
    read -p "파일을 복사했으면 Enter를 누르세요..."
    
    if [ -f "$ANDROID_DIR/google-services.json" ]; then
        echo -e "${GREEN}✅ 파일이 확인되었습니다!${NC}"
    else
        echo -e "${RED}❌ 파일을 찾을 수 없습니다. 다시 확인해주세요.${NC}"
        exit 1
    fi
fi

echo ""

# 3. Web Client ID 설정
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔑 Step 3: Google Sign-In 설정"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

APP_TSX="$PROJECT_ROOT/SayToDo/App.tsx"

# Web Client ID 체크
if grep -q "YOUR_WEB_CLIENT_ID" "$APP_TSX"; then
    echo -e "${YELLOW}⚠️  Web Client ID가 아직 설정되지 않았습니다${NC}"
    echo ""
    echo "다음 단계를 따라주세요:"
    echo "1. Firebase Console → 프로젝트 설정"
    echo "2. 일반 탭에서 '웹 API 키' 또는 OAuth 클라이언트 ID 확인"
    echo "3. Web Client ID 복사 (형식: xxxxx.apps.googleusercontent.com)"
    echo ""
    read -p "Web Client ID를 입력하세요: " WEB_CLIENT_ID
    
    if [ -n "$WEB_CLIENT_ID" ]; then
        # App.tsx 수정
        sed -i "s/YOUR_WEB_CLIENT_ID.apps.googleusercontent.com/$WEB_CLIENT_ID/g" "$APP_TSX"
        echo -e "${GREEN}✅ Web Client ID가 설정되었습니다!${NC}"
    else
        echo -e "${RED}❌ Web Client ID가 입력되지 않았습니다.${NC}"
    fi
else
    echo -e "${GREEN}✅ Web Client ID가 이미 설정되어 있습니다${NC}"
fi

echo ""

# 4. SHA-1 인증서 확인
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔐 Step 4: SHA-1 인증서 확인"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

echo "SHA-1 인증서를 Firebase에 등록해야 합니다."
echo ""
echo "SHA-1 확인 방법:"
echo "  cd $PROJECT_ROOT/SayToDo/android"
echo "  ./gradlew signingReport"
echo ""
read -p "SHA-1을 Firebase에 등록했습니까? (y/n): " SHA_CONFIRM

if [ "$SHA_CONFIRM" != "y" ]; then
    echo -e "${YELLOW}⚠️  SHA-1 등록 후 다시 실행해주세요${NC}"
    echo ""
    echo "등록 방법:"
    echo "1. Firebase Console → 프로젝트 설정"
    echo "2. 내 앱 → SayToDo"
    echo "3. SHA 인증서 지문 → 지문 추가"
    echo "4. SHA-1 값 입력 후 저장"
fi

echo ""

# 5. 설정 완료 확인
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ 설정 완료 확인"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

ISSUES=0

# Backend 설정 확인
if [ -f "$BACKEND_DIR/firebase-service-account.json" ]; then
    echo -e "${GREEN}✅ Backend Firebase 설정 완료${NC}"
else
    echo -e "${RED}❌ Backend Firebase 설정 필요${NC}"
    ISSUES=$((ISSUES+1))
fi

# Android 설정 확인
if [ -f "$ANDROID_DIR/google-services.json" ]; then
    echo -e "${GREEN}✅ Android Firebase 설정 완료${NC}"
else
    echo -e "${RED}❌ Android Firebase 설정 필요${NC}"
    ISSUES=$((ISSUES+1))
fi

# Web Client ID 확인
if ! grep -q "YOUR_WEB_CLIENT_ID" "$APP_TSX"; then
    echo -e "${GREEN}✅ Google Sign-In 설정 완료${NC}"
else
    echo -e "${RED}❌ Google Sign-In 설정 필요${NC}"
    ISSUES=$((ISSUES+1))
fi

echo ""

if [ $ISSUES -eq 0 ]; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "${GREEN}🎉 모든 Firebase 설정이 완료되었습니다!${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "다음 단계:"
    echo "1. Backend 실행:"
    echo "   cd $BACKEND_DIR"
    echo "   npm start"
    echo ""
    echo "2. Android 앱 실행:"
    echo "   cd $PROJECT_ROOT/SayToDo"
    echo "   npm run android"
    echo ""
else
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "${YELLOW}⚠️  아직 $ISSUES개의 설정이 필요합니다${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "자세한 가이드: $PROJECT_ROOT/FIREBASE_SETUP_GUIDE.md"
fi

echo ""

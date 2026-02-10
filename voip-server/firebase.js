import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let firebaseApp = null;

// Firebase Admin SDK 초기화
export function initializeFirebase() {
  try {
    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || 
                                path.join(__dirname, 'firebase-service-account.json');
    
    if (!fs.existsSync(serviceAccountPath)) {
      console.warn('⚠️  Firebase 서비스 계정 파일이 없습니다.');
      console.warn('   Firebase Console에서 서비스 계정 키를 생성하여 다음 경로에 저장하세요:');
      console.warn(`   ${serviceAccountPath}`);
      console.warn('   FCM Push 알림이 비활성화됩니다.');
      return null;
    }

    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });

    console.log('✅ Firebase Admin SDK 초기화 완료');
    return firebaseApp;
  } catch (error) {
    console.error('❌ Firebase 초기화 실패:', error.message);
    return null;
  }
}

/**
 * 단일 기기에 VoIP 스타일 푸시 알림 전송
 * Android: FCM High Priority Data Message
 */
export async function sendVoipPush(fcmToken, alertData) {
  if (!firebaseApp) {
    console.error('❌ Firebase가 초기화되지 않았습니다.');
    return { success: false, error: 'Firebase not initialized' };
  }

  try {
    const message = {
      token: fcmToken,
      data: {
        type: 'voip_alert',
        alertId: alertData.alertId,
        channelId: alertData.channelId,
        channelName: alertData.channelName,
        title: alertData.title,
        message: alertData.message || '',
        mediaType: alertData.mediaType || '',
        mediaUrl: alertData.mediaUrl || '',
        youtubeUrl: alertData.youtubeUrl || '',
        senderId: alertData.senderId,
        senderName: alertData.senderName,
        timestamp: Date.now().toString()
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'voip_alerts',
          priority: 'max',
          sound: 'default',
          tag: alertData.alertId,
          visibility: 'public'
        }
      }
    };

    const response = await admin.messaging().send(message);
    console.log('✅ FCM 푸시 전송 성공:', response);
    return { success: true, messageId: response };
  } catch (error) {
    console.error('❌ FCM 푸시 전송 실패:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 여러 기기에 동시 푸시 알림 전송
 */
export async function sendVoipPushToMultiple(fcmTokens, alertData) {
  if (!firebaseApp) {
    console.error('❌ Firebase가 초기화되지 않았습니다.');
    return { success: false, error: 'Firebase not initialized' };
  }

  try {
    const messages = fcmTokens.map(token => ({
      token: token,
      data: {
        type: 'voip_alert',
        alertId: alertData.alertId,
        channelId: alertData.channelId,
        channelName: alertData.channelName,
        title: alertData.title,
        message: alertData.message || '',
        mediaType: alertData.mediaType || '',
        mediaUrl: alertData.mediaUrl || '',
        youtubeUrl: alertData.youtubeUrl || '',
        senderId: alertData.senderId,
        senderName: alertData.senderName,
        timestamp: Date.now().toString()
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'voip_alerts',
          priority: 'max',
          sound: 'default',
          tag: alertData.alertId,
          visibility: 'public'
        }
      }
    }));

    const response = await admin.messaging().sendEach(messages);
    console.log(`✅ FCM 배치 푸시 전송 완료: ${response.successCount}/${fcmTokens.length} 성공`);
    
    return {
      success: true,
      successCount: response.successCount,
      failureCount: response.failureCount,
      responses: response.responses
    };
  } catch (error) {
    console.error('❌ FCM 배치 푸시 전송 실패:', error);
    return { success: false, error: error.message };
  }
}

export default { initializeFirebase, sendVoipPush, sendVoipPushToMultiple };

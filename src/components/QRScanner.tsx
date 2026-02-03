import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Camera, AlertCircle } from 'lucide-react';

interface QRScannerProps {
  onScanSuccess: (roomId: string) => void;
}

function QRScanner({ onScanSuccess }: QRScannerProps) {
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState('');
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const elementId = 'qr-reader';

  const startScanning = async () => {
    try {
      setError('');
      const scanner = new Html5Qrcode(elementId);
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
        },
        (decodedText) => {
          // QR 코드에서 roomId 추출
          try {
            const url = new URL(decodedText);
            const roomId = url.searchParams.get('room');
            
            if (roomId) {
              scanner.stop().then(() => {
                setIsScanning(false);
                onScanSuccess(roomId);
              });
            } else {
              setError('유효하지 않은 QR 코드입니다');
            }
          } catch (e) {
            setError('QR 코드 형식이 올바르지 않습니다');
          }
        },
        (errorMessage) => {
          // 스캔 중 오류는 무시 (계속 스캔)
        }
      );

      setIsScanning(true);
    } catch (err) {
      console.error('Scanner start error:', err);
      setError('카메라 권한을 허용해주세요');
      setIsScanning(false);
    }
  };

  const stopScanning = () => {
    if (scannerRef.current) {
      scannerRef.current.stop().then(() => {
        setIsScanning(false);
        scannerRef.current = null;
      }).catch(err => {
        console.error('Scanner stop error:', err);
      });
    }
  };

  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(err => {
          console.error('Cleanup error:', err);
        });
      }
    };
  }, []);

  return (
    <div className="flex flex-col items-center">
      <div 
        id={elementId} 
        className="w-full rounded-lg overflow-hidden mb-4"
        style={{ minHeight: isScanning ? '300px' : '0' }}
      />
      
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700 w-full">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span className="text-sm">{error}</span>
        </div>
      )}
      
      {!isScanning ? (
        <button
          onClick={startScanning}
          className="w-full bg-gradient-to-r from-indigo-500 to-purple-600 text-white px-6 py-3 rounded-lg font-semibold hover:from-indigo-600 hover:to-purple-700 transition-all duration-200 shadow-lg flex items-center justify-center gap-2"
        >
          <Camera className="w-5 h-5" />
          스캔 시작
        </button>
      ) : (
        <button
          onClick={stopScanning}
          className="w-full bg-red-500 text-white px-6 py-3 rounded-lg font-semibold hover:bg-red-600 transition-all duration-200 shadow-lg"
        >
          스캔 중지
        </button>
      )}
      
      <p className="mt-4 text-sm text-gray-600 text-center">
        QR 코드를 카메라에 비춰주세요
      </p>
    </div>
  );
}

export default QRScanner;

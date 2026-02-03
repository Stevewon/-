import { useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { Download } from 'lucide-react';

interface QRGeneratorProps {
  roomId: string;
}

function QRGenerator({ roomId }: QRGeneratorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const roomUrl = `${window.location.origin}?room=${roomId}`;

  useEffect(() => {
    if (canvasRef.current && roomId) {
      QRCode.toCanvas(
        canvasRef.current,
        roomUrl,
        {
          width: 300,
          margin: 2,
          color: {
            dark: '#4f46e5',
            light: '#ffffff',
          },
        },
        (error) => {
          if (error) console.error('QR Code generation error:', error);
        }
      );
    }
  }, [roomId, roomUrl]);

  const handleDownload = () => {
    if (canvasRef.current) {
      const url = canvasRef.current.toDataURL('image/png');
      const link = document.createElement('a');
      link.download = `qrchat-${roomId}.png`;
      link.href = url;
      link.click();
    }
  };

  return (
    <div className="flex flex-col items-center">
      <div className="bg-white p-4 rounded-xl shadow-lg mb-4">
        <canvas ref={canvasRef} />
      </div>
      
      <button
        onClick={handleDownload}
        className="flex items-center gap-2 bg-indigo-100 text-indigo-700 px-4 py-2 rounded-lg hover:bg-indigo-200 transition-all duration-200 font-medium"
      >
        <Download className="w-4 h-4" />
        QR 코드 저장
      </button>
      
      <div className="mt-4 p-3 bg-gray-50 rounded-lg w-full">
        <p className="text-xs text-gray-500 text-center break-all">
          {roomUrl}
        </p>
      </div>
    </div>
  );
}

export default QRGenerator;

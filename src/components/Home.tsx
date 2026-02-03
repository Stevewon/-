import { useState, useRef } from 'react';
import { QrCode, Scan, User, MessageCircle } from 'lucide-react';
import QRScanner from './QRScanner';
import QRGenerator from './QRGenerator';

interface HomeProps {
  onJoinRoom: (roomId: string, roomName: string, username: string) => void;
}

function Home({ onJoinRoom }: HomeProps) {
  const [view, setView] = useState<'main' | 'create' | 'scan'>('main');
  const [username, setUsername] = useState('');
  const [roomName, setRoomName] = useState('');
  const [createdRoomId, setCreatedRoomId] = useState('');
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [pendingRoomId, setPendingRoomId] = useState('');
  const [pendingRoomName, setPendingRoomName] = useState('');

  const handleCreateRoom = async () => {
    if (!username.trim()) {
      alert('닉네임을 입력해주세요');
      return;
    }

    try {
      const response = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          roomName: roomName || '익명 채팅방',
          creatorName: username 
        })
      });
      
      const data = await response.json();
      setCreatedRoomId(data.roomId);
      setView('create');
    } catch (error) {
      console.error('Failed to create room:', error);
      alert('채팅방 생성에 실패했습니다');
    }
  };

  const handleScanSuccess = async (roomId: string) => {
    try {
      const response = await fetch(`/api/rooms/${roomId}`);
      
      if (!response.ok) {
        alert('유효하지 않은 QR 코드입니다');
        return;
      }
      
      const data = await response.json();
      setPendingRoomId(roomId);
      setPendingRoomName(data.name);
      setShowUsernameModal(true);
      setView('main');
    } catch (error) {
      console.error('Failed to verify room:', error);
      alert('채팅방 확인에 실패했습니다');
    }
  };

  const handleJoinWithUsername = () => {
    if (!username.trim()) {
      alert('닉네임을 입력해주세요');
      return;
    }
    
    onJoinRoom(pendingRoomId, pendingRoomName, username);
  };

  const handleEnterCreatedRoom = () => {
    onJoinRoom(createdRoomId, roomName || '익명 채팅방', username);
  };

  if (view === 'create' && createdRoomId) {
    return (
      <div className="w-full h-full flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full">
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-full mb-4">
              <QrCode className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">채팅방이 생성되었습니다!</h2>
            <p className="text-gray-600">QR 코드를 공유하여 친구를 초대하세요</p>
          </div>
          
          <QRGenerator roomId={createdRoomId} />
          
          <div className="mt-6 space-y-3">
            <button
              onClick={handleEnterCreatedRoom}
              className="w-full bg-gradient-to-r from-indigo-500 to-purple-600 text-white px-6 py-3 rounded-lg font-semibold hover:from-indigo-600 hover:to-purple-700 transition-all duration-200 shadow-lg"
            >
              채팅방 입장하기
            </button>
            <button
              onClick={() => {
                setView('main');
                setCreatedRoomId('');
                setRoomName('');
              }}
              className="w-full bg-gray-200 text-gray-700 px-6 py-3 rounded-lg font-semibold hover:bg-gray-300 transition-all duration-200"
            >
              돌아가기
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'scan') {
    return (
      <div className="w-full h-full flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full">
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-full mb-4">
              <Scan className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">QR 코드 스캔</h2>
            <p className="text-gray-600">채팅방 QR 코드를 스캔해주세요</p>
          </div>
          
          <QRScanner onScanSuccess={handleScanSuccess} />
          
          <button
            onClick={() => setView('main')}
            className="w-full mt-6 bg-gray-200 text-gray-700 px-6 py-3 rounded-lg font-semibold hover:bg-gray-300 transition-all duration-200"
          >
            돌아가기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full">
        {/* 헤더 */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-full mb-4">
            <MessageCircle className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-gray-800 mb-2">큐알쳇</h1>
          <p className="text-gray-600">QR 코드로 간편하게 채팅하세요</p>
        </div>

        {/* 닉네임 입력 */}
        <div className="mb-6">
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            <User className="inline w-4 h-4 mr-1" />
            닉네임
          </label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="닉네임을 입력하세요"
            className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none transition-colors"
            maxLength={20}
          />
        </div>

        {/* 채팅방 이름 입력 */}
        <div className="mb-6">
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            <MessageCircle className="inline w-4 h-4 mr-1" />
            채팅방 이름 (선택)
          </label>
          <input
            type="text"
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            placeholder="채팅방 이름을 입력하세요"
            className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none transition-colors"
            maxLength={30}
          />
        </div>

        {/* 액션 버튼 */}
        <div className="space-y-3">
          <button
            onClick={handleCreateRoom}
            className="w-full bg-gradient-to-r from-indigo-500 to-purple-600 text-white px-6 py-4 rounded-lg font-semibold hover:from-indigo-600 hover:to-purple-700 transition-all duration-200 shadow-lg flex items-center justify-center gap-2"
          >
            <QrCode className="w-5 h-5" />
            채팅방 만들기
          </button>
          
          <button
            onClick={() => setView('scan')}
            className="w-full bg-white border-2 border-indigo-500 text-indigo-600 px-6 py-4 rounded-lg font-semibold hover:bg-indigo-50 transition-all duration-200 flex items-center justify-center gap-2"
          >
            <Scan className="w-5 h-5" />
            QR 코드 스캔하기
          </button>
        </div>
      </div>

      {/* 닉네임 입력 모달 */}
      {showUsernameModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-sm w-full">
            <h3 className="text-xl font-bold text-gray-800 mb-4">채팅방 입장</h3>
            <p className="text-gray-600 mb-4">
              <span className="font-semibold">{pendingRoomName}</span>에 입장합니다
            </p>
            <div className="mb-6">
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                닉네임
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="닉네임을 입력하세요"
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none transition-colors"
                maxLength={20}
                onKeyPress={(e) => e.key === 'Enter' && handleJoinWithUsername()}
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowUsernameModal(false);
                  setPendingRoomId('');
                  setPendingRoomName('');
                }}
                className="flex-1 bg-gray-200 text-gray-700 px-6 py-3 rounded-lg font-semibold hover:bg-gray-300 transition-all duration-200"
              >
                취소
              </button>
              <button
                onClick={handleJoinWithUsername}
                className="flex-1 bg-gradient-to-r from-indigo-500 to-purple-600 text-white px-6 py-3 rounded-lg font-semibold hover:from-indigo-600 hover:to-purple-700 transition-all duration-200"
              >
                입장
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Home;

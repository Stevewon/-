import { useEffect, useState, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { Send, LogOut, Users } from 'lucide-react';

interface Message {
  id: string;
  type: 'user' | 'system';
  username?: string;
  content: string;
  timestamp: Date;
}

interface ChatRoomProps {
  roomId: string;
  username: string;
  roomName: string;
  onLeave: () => void;
}

function ChatRoom({ roomId, username, roomName, onLeave }: ChatRoomProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [socket, setSocket] = useState<Socket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Socket.io 연결
    const newSocket = io('/', {
      transports: ['websocket', 'polling']
    });
    
    setSocket(newSocket);

    // 채팅방 입장
    newSocket.emit('join-room', { roomId, username });

    // 이전 메시지 받기
    newSocket.on('previous-messages', (previousMessages: Message[]) => {
      setMessages(previousMessages);
    });

    // 새 메시지 받기
    newSocket.on('message', (message: Message) => {
      setMessages((prev) => [...prev, message]);
    });

    // 에러 처리
    newSocket.on('error', (error: { message: string }) => {
      alert(error.message);
      onLeave();
    });

    return () => {
      newSocket.disconnect();
    };
  }, [roomId, username, onLeave]);

  useEffect(() => {
    // 메시지 추가될 때마다 스크롤 하단으로
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = () => {
    if (!inputMessage.trim() || !socket) return;

    socket.emit('send-message', {
      roomId,
      message: inputMessage.trim()
    });

    setInputMessage('');
    inputRef.current?.focus();
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const formatTime = (timestamp: Date) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('ko-KR', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  return (
    <div className="w-full h-screen flex flex-col bg-white">
      {/* 헤더 */}
      <div className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white px-4 py-4 shadow-lg">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white bg-opacity-20 rounded-full flex items-center justify-center">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold">{roomName}</h2>
              <p className="text-sm text-indigo-100">{username}</p>
            </div>
          </div>
          <button
            onClick={onLeave}
            className="flex items-center gap-2 bg-white bg-opacity-20 hover:bg-opacity-30 px-4 py-2 rounded-lg transition-all duration-200 font-medium"
          >
            <LogOut className="w-4 h-4" />
            나가기
          </button>
        </div>
      </div>

      {/* 메시지 영역 */}
      <div className="flex-1 overflow-y-auto bg-gray-50 p-4">
        <div className="max-w-4xl mx-auto space-y-3">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${
                message.type === 'system'
                  ? 'justify-center'
                  : message.username === username
                  ? 'justify-end'
                  : 'justify-start'
              }`}
            >
              {message.type === 'system' ? (
                <div className="bg-gray-300 text-gray-700 text-sm px-4 py-2 rounded-full">
                  {message.content}
                </div>
              ) : (
                <div
                  className={`max-w-[70%] ${
                    message.username === username
                      ? 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white'
                      : 'bg-white text-gray-800 shadow-md'
                  } rounded-2xl px-4 py-3`}
                >
                  {message.username !== username && (
                    <div className="text-xs font-semibold mb-1 text-indigo-600">
                      {message.username}
                    </div>
                  )}
                  <div className="break-words whitespace-pre-wrap">
                    {message.content}
                  </div>
                  <div
                    className={`text-xs mt-1 ${
                      message.username === username
                        ? 'text-indigo-100'
                        : 'text-gray-500'
                    }`}
                  >
                    {formatTime(message.timestamp)}
                  </div>
                </div>
              )}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* 입력 영역 */}
      <div className="bg-white border-t border-gray-200 p-4 shadow-lg">
        <div className="max-w-4xl mx-auto flex gap-3">
          <input
            ref={inputRef}
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="메시지를 입력하세요..."
            className="flex-1 px-4 py-3 border-2 border-gray-200 rounded-full focus:border-indigo-500 focus:outline-none transition-colors"
            maxLength={500}
          />
          <button
            onClick={handleSendMessage}
            disabled={!inputMessage.trim()}
            className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white p-3 rounded-full hover:from-indigo-600 hover:to-purple-700 transition-all duration-200 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send className="w-6 h-6" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default ChatRoom;

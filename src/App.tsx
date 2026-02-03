import { useState } from 'react';
import Home from './components/Home';
import ChatRoom from './components/ChatRoom';

function App() {
  const [currentView, setCurrentView] = useState<'home' | 'chat'>('home');
  const [roomId, setRoomId] = useState<string>('');
  const [username, setUsername] = useState<string>('');
  const [roomName, setRoomName] = useState<string>('');

  const handleJoinRoom = (id: string, name: string, user: string) => {
    setRoomId(id);
    setRoomName(name);
    setUsername(user);
    setCurrentView('chat');
  };

  const handleLeaveRoom = () => {
    setCurrentView('home');
    setRoomId('');
    setUsername('');
    setRoomName('');
  };

  return (
    <div className="w-full h-screen bg-gradient-to-br from-indigo-50 to-purple-50">
      {currentView === 'home' ? (
        <Home onJoinRoom={handleJoinRoom} />
      ) : (
        <ChatRoom 
          roomId={roomId} 
          username={username}
          roomName={roomName}
          onLeave={handleLeaveRoom} 
        />
      )}
    </div>
  );
}

export default App;

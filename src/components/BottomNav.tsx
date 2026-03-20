import React from 'react';
import { MessageCircle, Flame, Compass, User, Camera } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import type { Screen } from '@/types';

const items: { id: Screen; icon: React.ElementType; label: string }[] = [
  { id: 'chat', icon: MessageCircle, label: 'Chat' },
  { id: 'stories', icon: Flame, label: 'Stories' },
  { id: 'camera', icon: Camera, label: 'Camera' },
  { id: 'explore', icon: Compass, label: 'Explore' },
  { id: 'profile', icon: User, label: 'Me' },
];

export const BottomNav: React.FC = () => {
  const { screen, setScreen } = useAppStore();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 safe-bottom">
      <div className="flex items-end justify-around px-2 pt-2 pb-1"
        style={{ background: 'linear-gradient(to top, rgba(5,5,7,0.98) 70%, transparent)' }}>
        {items.map(({ id, icon: Icon, label }) => {
          const active = screen === id;
          const isCenter = id === 'camera';

          if (isCenter) {
            return (
              <button
                key={id}
                onClick={() => setScreen(id)}
                className="relative -top-3 flex items-center justify-center rounded-full flare-glow transition-transform active:scale-95"
                style={{
                  width: 58, height: 58,
                  background: 'linear-gradient(135deg, #f97316, #fb923c)',
                  boxShadow: active ? '0 0 24px rgba(249,115,22,0.6)' : '0 0 16px rgba(249,115,22,0.3)',
                }}
              >
                <Icon size={26} className="text-white" />
              </button>
            );
          }

          return (
            <button
              key={id}
              onClick={() => setScreen(id)}
              className={`flex flex-col items-center gap-0.5 py-1 px-3 transition-all ${active ? 'nav-active' : 'text-gray-600'}`}
            >
              <Icon size={22} strokeWidth={active ? 2.2 : 1.8} />
              <span className="text-[10px] font-medium tracking-wide">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};

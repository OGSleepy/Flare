import React from 'react';
import { useAppStore } from '@/store/appStore';

interface AvatarProps {
  pubkey: string;
  size?: number;
  hasStory?: boolean;
  storySeen?: boolean;
  onClick?: () => void;
}

export const Avatar: React.FC<AvatarProps> = ({ pubkey, size = 44, hasStory = false, storySeen = false, onClick }) => {
  const profiles = useAppStore(s => s.profiles);
  const profile = profiles.get(pubkey);
  const name = profile?.display_name || profile?.name || pubkey.slice(0, 8);
  const initial = name[0]?.toUpperCase() ?? '?';
  const wrapperSize = hasStory ? size + 6 : size;

  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1 focus:outline-none" style={{ width: wrapperSize }}>
      <div
        className={hasStory ? (storySeen ? 'story-ring-seen' : 'story-ring') : ''}
        style={{ width: wrapperSize, height: wrapperSize, borderRadius: '50%' }}
      >
        <div className="rounded-full overflow-hidden bg-surface-raised flex items-center justify-center" style={{ width: size, height: size }}>
          {profile?.picture
            ? <img src={profile.picture} alt={name} className="w-full h-full object-cover" />
            : <span className="font-display font-bold text-flare-500" style={{ fontSize: size * 0.38 }}>{initial}</span>
          }
        </div>
      </div>
    </button>
  );
};

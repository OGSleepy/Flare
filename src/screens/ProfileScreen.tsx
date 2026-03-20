import React, { useState } from 'react';
import { Settings, LogOut, Copy, Check, Edit3, Flame, Camera, Lock, ExternalLink } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { accountManager } from '@/lib/accountManager';
import { StoryViewer } from '@/components/StoryViewer';
import * as nip19 from 'nostr-tools/nip19';

export const ProfileScreen: React.FC = () => {
  const pubkey = useAppStore(s => s.pubkey);
  const profile = useAppStore(s => s.profile);
  const allStories = useAppStore(s => s.stories);
  const logout = useAppStore(s => s.logout);
  const setScreen = useAppStore(s => s.setScreen);

  // Compute derived values outside selector
  const stories = allStories.filter(x => x.pubkey === pubkey);

  const [copied, setCopied] = useState(false);
  const [viewingStory, setViewingStory] = useState(false);

  const npub = pubkey ? nip19.npubEncode(pubkey) : '';
  const shortNpub = npub ? `${npub.slice(0, 12)}…${npub.slice(-6)}` : '';
  const name = profile?.display_name || profile?.name || shortNpub;

  const handleCopy = () => { navigator.clipboard.writeText(npub); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  const handleLogout = () => { const active = accountManager.active; if (active) accountManager.removeAccount(active.id); logout(); };

  return (
    <div className="flex flex-col h-full bg-[var(--bg)] scrollable">
      <div className="relative">
        {profile?.banner
          ? <img src={profile.banner} alt="banner" className="w-full h-36 object-cover" />
          : <div className="w-full h-36" style={{ background: 'linear-gradient(135deg,#1a0a00,#2d1200,#1a0a00)' }} />
        }
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom,transparent 30%,var(--bg) 100%)' }} />
        <button className="absolute top-12 right-4 safe-top w-9 h-9 rounded-full bg-black/50 backdrop-blur flex items-center justify-center text-white/70 border border-white/10">
          <Settings size={16} />
        </button>
      </div>

      <div className="px-5 -mt-12 relative z-10">
        <div className="flex items-end justify-between">
          <div className="story-ring" style={{ borderRadius: '50%' }}>
            <div className="w-[76px] h-[76px] rounded-full overflow-hidden bg-surface-raised border-2 border-[var(--bg)]">
              {profile?.picture
                ? <img src={profile.picture} alt={name} className="w-full h-full object-cover" />
                : <div className="w-full h-full flex items-center justify-center text-flare-500 text-3xl font-bold font-display">{name[0]?.toUpperCase()}</div>
              }
            </div>
          </div>
          <button className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-[var(--border)] text-sm text-gray-300 bg-surface-raised"><Edit3 size={14} /> Edit</button>
        </div>
        <div className="mt-3">
          <h2 className="font-display text-xl font-bold text-white">{name}</h2>
          {profile?.about && <p className="text-gray-400 text-sm mt-1 leading-relaxed">{profile.about}</p>}
          <button onClick={handleCopy} className="flex items-center gap-1.5 mt-2 text-gray-600 hover:text-gray-400 transition-colors">
            {copied ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
            <span className="text-xs font-mono">{shortNpub}</span>
          </button>
        </div>
        <div className="flex gap-6 mt-4">
          <div className="text-center"><p className="font-display font-bold text-white text-lg">{stories.length}</p><p className="text-gray-600 text-xs">Stories</p></div>
          <div className="text-center"><div className="flex items-center gap-1 justify-center"><Lock size={11} className="text-flare-500" /><p className="font-display font-bold text-white text-lg">E2E</p></div><p className="text-gray-600 text-xs">Encrypted</p></div>
          <div className="text-center"><p className="font-display font-bold text-white text-lg">24h</p><p className="text-gray-600 text-xs">Ephemeral</p></div>
        </div>
      </div>

      <div className="px-5 mt-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2"><Flame size={16} className="text-flare-500" /><h3 className="font-semibold text-white text-sm">Live Stories</h3></div>
          <button onClick={() => setScreen('camera')} className="flex items-center gap-1 text-flare-500 text-xs font-semibold"><Camera size={13} /> Add</button>
        </div>
        {stories.length === 0 ? (
          <button onClick={() => setScreen('camera')}
            className="w-full flex flex-col items-center gap-2 py-8 rounded-2xl border border-dashed border-flare-500/20 bg-surface hover:border-flare-500/40 transition-colors">
            <Camera size={28} className="text-flare-500/40" />
            <p className="text-gray-500 text-sm">Post your first story</p>
          </button>
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-2" style={{ scrollbarWidth: 'none' }}>
            {stories.map(s => (
              <button key={s.id} onClick={() => setViewingStory(true)}
                className="flex-shrink-0 w-24 h-36 rounded-2xl overflow-hidden relative bg-surface active:scale-95 transition-transform">
                <img src={s.mediaUrl} alt="" className="w-full h-full object-cover" />
                <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom,transparent 50%,rgba(0,0,0,0.6) 100%)' }} />
                {s.caption && <p className="absolute bottom-1.5 left-1.5 right-1.5 text-[9px] text-white/80 line-clamp-2 text-center">{s.caption}</p>}
                <div className="absolute top-1.5 right-1.5 bg-black/60 backdrop-blur rounded-full px-1.5 py-0.5">
                  <span className="text-[8px] text-white/70">{Math.max(0, Math.floor((s.expires_at - Date.now() / 1000) / 3600))}h</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {profile?.website && (
        <div className="px-5 mt-4">
          <a href={profile.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-flare-500 text-sm hover:underline">
            <ExternalLink size={14} />{profile.website.replace(/^https?:\/\//, '')}
          </a>
        </div>
      )}

      <div className="px-5 mt-6">
        <div className="bg-surface rounded-2xl border border-[var(--border)] p-4 flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-surface-overlay flex items-center justify-center flex-shrink-0"><Lock size={16} className="text-flare-500" /></div>
          <div>
            <p className="text-white text-sm font-semibold">Decentralized Identity</p>
            <p className="text-gray-500 text-xs mt-0.5 leading-relaxed">Your account is a Nostr keypair. No server owns it. Stories expire in 24h. DMs are NIP-17 end-to-end encrypted.</p>
          </div>
        </div>
      </div>

      <div className="px-5 mt-6 mb-32">
        <button onClick={handleLogout} className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-colors text-sm font-semibold">
          <LogOut size={16} /> Sign out
        </button>
      </div>

      {viewingStory && pubkey && <StoryViewer pubkey={pubkey} onClose={() => setViewingStory(false)} />}
    </div>
  );
};

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Send, Loader2 } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { shortKey } from '@/lib/nostr';

const STORY_DURATION = 5000;

interface StoryViewerProps {
  pubkey: string;
  onClose: () => void;
  onReply?: (pubkey: string, message: string) => void;
}

export const StoryViewer: React.FC<StoryViewerProps> = ({ pubkey, onClose, onReply }) => {
  const allStories = useAppStore(s => s.stories);
  const profiles = useAppStore(s => s.profiles);
  const markViewed = useAppStore(s => s.markViewed);
  const setScreen = useAppStore(s => s.setScreen);
  const setActiveChat = useAppStore(s => s.setActiveChat);

  // Stable ref for onClose — prevents it from being a useCallback/useEffect dep
  // that changes every time the parent re-renders
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  const onReplyRef = useRef(onReply);
  useEffect(() => { onReplyRef.current = onReply; }, [onReply]);

  // Derive stories in a ref-stable way using useMemo equivalent
  const stories = allStories.filter(x => x.pubkey === pubkey);
  const storiesLen = stories.length;

  const [idx, setIdx] = useState(0);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reply, setReply] = useState('');
  const [showReply, setShowReply] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Track which story IDs we've already marked to avoid repeated markViewed calls
  const markedRef = useRef<Set<string>>(new Set());

  const story = stories[idx];
  const profile = profiles.get(pubkey);
  const name = profile?.display_name || profile?.name || shortKey(pubkey);

  // advance uses a ref for onClose so it never changes identity
  const advance = useCallback(() => {
    setIdx(i => {
      if (i < storiesLen - 1) {
        setProgress(0);
        return i + 1;
      }
      onCloseRef.current();
      return i;
    });
  }, [storiesLen]);

  useEffect(() => {
    if (!story || paused || showReply) return;

    // Only mark viewed once per story id
    if (!markedRef.current.has(story.id)) {
      markedRef.current.add(story.id);
      markViewed(story.id);
    }

    setProgress(0);
    const interval = 50;
    const step = (100 / STORY_DURATION) * interval;

    timerRef.current = setInterval(() => {
      setProgress(p => {
        if (p >= 100) {
          clearInterval(timerRef.current!);
          advance();
          return 100;
        }
        return p + step;
      });
    }, interval);

    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [idx, paused, showReply, advance, markViewed]);

  const [sendingReply, setSendingReply] = useState(false);

  if (!story) return null;

  const handleSendReply = async () => {
    if (!reply.trim() || sendingReply) return;
    setSendingReply(true);
    try {
      await onReplyRef.current?.(pubkey, reply.trim());
      setReply('');
      setShowReply(false);
      setActiveChat(pubkey);
      setScreen('chat');
      onCloseRef.current();
    } catch {
      // error toast handled by caller
    } finally {
      setSendingReply(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col select-none">
      {/* Progress bars */}
      <div className="absolute top-0 left-0 right-0 z-10 flex gap-1 px-2 pt-3 safe-top">
        {stories.map((s, i) => (
          <div key={s.id} className="flex-1 h-0.5 rounded-full bg-white/25 overflow-hidden">
            <div
              className="h-full bg-white rounded-full"
              style={{
                width: i < idx ? '100%' : i === idx ? `${progress}%` : '0%',
                transition: 'none',
              }}
            />
          </div>
        ))}
      </div>

      {/* Header */}
      <div className="absolute top-6 left-0 right-0 z-10 flex items-center gap-3 px-4 safe-top mt-4">
        <div className="w-9 h-9 rounded-full overflow-hidden bg-surface-raised flex-shrink-0 ring-2 ring-flare-500">
          {profile?.picture
            ? <img src={profile.picture} alt={name} className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center text-flare-500 font-bold">{name[0]}</div>
          }
        </div>
        <div className="flex-1">
          <p className="text-white font-semibold text-sm leading-none">{name}</p>
          <p className="text-white/60 text-xs mt-0.5">
            {new Date(story.created_at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
        <button onClick={() => onCloseRef.current()} className="text-white/70 hover:text-white p-1">
          <X size={22} />
        </button>
      </div>

      {/* Media */}
      <div
        className="absolute inset-0"
        onPointerDown={() => setPaused(true)}
        onPointerUp={() => setPaused(false)}
        onPointerLeave={() => setPaused(false)}
      >
        {story.mediaType === 'video'
          ? <video src={story.mediaUrl} autoPlay loop playsInline className="w-full h-full object-cover" />
          : <img src={story.mediaUrl} alt="" className="w-full h-full object-cover" />
        }
        <div className="absolute inset-0" style={{
          background: 'linear-gradient(to bottom,rgba(0,0,0,0.4) 0%,transparent 30%,transparent 60%,rgba(0,0,0,0.6) 100%)',
        }} />
      </div>

      {/* Tap zones */}
      <div className="absolute inset-0 flex z-10 pointer-events-none">
        <button
          className="w-1/3 h-full pointer-events-auto"
          onClick={() => {
            if (idx > 0) { setIdx(i => i - 1); setProgress(0); }
            else onCloseRef.current();
          }}
        />
        <div className="flex-1" />
        <button className="w-1/3 h-full pointer-events-auto" onClick={advance} />
      </div>

      {/* Caption */}
      {story.caption && (
        <div className="absolute bottom-20 left-4 right-4 z-10">
          <p className="text-white text-sm font-medium drop-shadow-lg text-center">{story.caption}</p>
        </div>
      )}

      {/* Reply */}
      <div className="absolute bottom-0 left-0 right-0 z-20 safe-bottom px-4 pb-4">
        {showReply ? (
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={reply}
              onChange={e => setReply(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSendReply()}
              placeholder={`Reply to ${name}…`}
              className="flex-1 bg-white/15 backdrop-blur rounded-full px-4 py-2.5 text-white text-sm placeholder-white/50 focus:outline-none border border-white/20"
            />
            <button
              onClick={handleSendReply}
              disabled={!reply.trim() || sendingReply}
              className="w-10 h-10 rounded-full bg-flare-500 flex items-center justify-center disabled:opacity-40 flex-shrink-0"
            >
              {sendingReply
                ? <Loader2 size={16} className="text-white animate-spin" />
                : <Send size={16} className="text-white translate-x-0.5" />
              }
            </button>
          </div>
        ) : (
          <button
            onClick={() => { setPaused(true); setShowReply(true); }}
            className="w-full flex items-center gap-3 bg-white/10 backdrop-blur rounded-full px-4 py-3 border border-white/15"
          >
            <Send size={16} className="text-white/60" />
            <span className="text-white/60 text-sm">Reply privately…</span>
          </button>
        )}
      </div>
    </div>
  );
};

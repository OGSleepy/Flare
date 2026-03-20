import React, { useState, useRef, useEffect } from 'react';
import { ArrowLeft, Send, Lock, Play, Camera, Eye } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { shortKey } from '@/lib/nostr';
import { SnapComposer } from './SnapComposer';
import type { FlareMessage } from '@/types';
import type { NostrSigner } from '@nostrify/nostrify';

interface ChatThreadProps {
  pubkey: string;
  onBack: () => void;
  onSend: (content: string) => Promise<void>;
  onSnapSent: (mediaUrl: string, mediaType: 'image' | 'video', viewOnce: boolean, caption?: string) => void;
  signer: NostrSigner | null;
}

// ── View-once snap bubble ────────────────────────────────────────────────────
const SnapBubble: React.FC<{ msg: FlareMessage; isMine: boolean; onOpen: () => void }> = ({ msg, isMine, onOpen }) => {
  const isVideo = msg.mediaType === 'video';
  const opened = msg.opened;

  if (isMine) {
    // Sender: always show a preview thumbnail
    return (
      <div className="flex justify-end mb-1">
        <div className="flex flex-col items-end gap-1">
          <div className="relative rounded-2xl rounded-br-sm overflow-hidden border border-white/10"
            style={{ width: 160, height: 200 }}>
            {isVideo
              ? <video src={msg.mediaUrl} className="w-full h-full object-cover" muted playsInline autoPlay loop />
              : <img src={msg.mediaUrl} alt="" className="w-full h-full object-cover" />
            }
            <div className="absolute inset-0 bg-black/30 flex flex-col items-center justify-end pb-2">
              <div className="bg-black/60 backdrop-blur rounded-full px-2 py-0.5 flex items-center gap-1">
                {msg.viewOnce
                  ? <><Eye size={10} className="text-flare-400" /><span className="text-[9px] text-flare-400">{opened ? 'Opened' : 'View once'}</span></>
                  : <span className="text-[9px] text-white/60">Sent</span>
                }
              </div>
            </div>
          </div>
          <p className="text-[10px] text-gray-600 pr-1">
            {new Date(msg.created_at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
      </div>
    );
  }

  // Recipient: blurred until tapped if view-once and not yet opened
  if (msg.viewOnce && !opened) {
    return (
      <div className="flex justify-start mb-1">
        <div className="flex flex-col items-start gap-1">
          <button onClick={onOpen}
            className="relative rounded-2xl rounded-bl-sm overflow-hidden border border-flare-500/40 active:scale-95 transition-transform"
            style={{ width: 160, height: 200 }}>
            {isVideo
              ? <video src={msg.mediaUrl} className="w-full h-full object-cover" muted playsInline />
              : <img src={msg.mediaUrl} alt="" className="w-full h-full object-cover" style={{ filter: 'blur(20px)', transform: 'scale(1.1)' }} />
            }
            <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center gap-2">
              <div className="w-12 h-12 rounded-full bg-flare-500/20 border-2 border-flare-500/60 flex items-center justify-center">
                <Eye size={20} className="text-flare-400" />
              </div>
              <p className="text-white text-xs font-semibold">Tap to open</p>
              <p className="text-flare-400 text-[9px]">👻 View once</p>
            </div>
          </button>
          <p className="text-[10px] text-gray-600 pl-1">
            {new Date(msg.created_at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
      </div>
    );
  }

  // Recipient: already opened view-once — show tombstone
  if (msg.viewOnce && opened) {
    return (
      <div className="flex justify-start mb-1">
        <div className="flex items-center gap-2 bg-surface-raised border border-[var(--border)] rounded-2xl rounded-bl-sm px-4 py-2.5">
          <Eye size={14} className="text-gray-600" />
          <p className="text-gray-500 text-xs">Snap opened · no longer available</p>
        </div>
      </div>
    );
  }

  // Keep-in-chat — show normally
  return (
    <div className="flex justify-start mb-1">
      <div className="flex flex-col items-start gap-1">
        <div className="relative rounded-2xl rounded-bl-sm overflow-hidden border border-white/10"
          style={{ width: 160, height: 200 }}>
          {isVideo
            ? <video src={msg.mediaUrl} className="w-full h-full object-cover" controls playsInline />
            : <img src={msg.mediaUrl} alt="" className="w-full h-full object-cover" />
          }
        </div>
        {msg.content && msg.content !== msg.mediaUrl && (
          <div className="bubble-recv px-4 py-2 text-sm text-white max-w-[160px]">
            <p>{msg.content}</p>
          </div>
        )}
        <p className="text-[10px] text-gray-600 pl-1">
          {new Date(msg.created_at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </div>
  );
};

// ── Regular message bubble ───────────────────────────────────────────────────
const MessageBubble: React.FC<{ msg: FlareMessage; isMine: boolean; onOpen: () => void }> = ({ msg, isMine, onOpen }) => {
  // Route snap DMs (have mediaUrl + either viewOnce flag or mediaType) to SnapBubble
  if (msg.mediaUrl && (msg.viewOnce !== undefined || msg.mediaType)) {
    return <SnapBubble msg={msg} isMine={isMine} onOpen={onOpen} />;
  }

  const hasMedia = !!msg.mediaUrl;
  const isVideo = msg.mediaType === 'video';

  return (
    <div className={`flex ${isMine ? 'justify-end' : 'justify-start'} mb-1`}>
      <div className={`max-w-[80%] ${isMine ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
        {hasMedia && (
          <div className={`rounded-2xl overflow-hidden border border-white/10 ${isMine ? 'rounded-br-sm' : 'rounded-bl-sm'}`}
            style={{ width: 200, aspectRatio: '9/16', maxHeight: 280, position: 'relative' }}>
            {isVideo
              ? <video src={msg.mediaUrl} className="w-full h-full object-cover" playsInline muted loop autoPlay />
              : <img src={msg.mediaUrl} alt="" className="w-full h-full object-cover" />
            }
            <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, transparent 50%, rgba(0,0,0,0.6) 100%)' }} />
            {isVideo && (
              <div className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 flex items-center justify-center">
                <Play size={12} className="text-white fill-white ml-0.5" />
              </div>
            )}
            <div className="absolute top-2 left-2 bg-black/60 backdrop-blur rounded-full px-2 py-0.5">
              <span className="text-white text-[9px] font-semibold">↩ Story</span>
            </div>
            {msg.storyCaption && (
              <p className="absolute bottom-2 left-2 right-2 text-white text-[10px] line-clamp-2 text-center">{msg.storyCaption}</p>
            )}
          </div>
        )}
        {(msg.content && msg.content !== '📸 Story') && (
          <div className={`px-4 py-2.5 text-sm text-white ${isMine ? 'bubble-sent' : 'bubble-recv'} ${msg.pending ? 'opacity-60' : ''}`}>
            <p className="break-words">{msg.content}</p>
            <p className={`text-[10px] mt-1 ${isMine ? 'text-white/60 text-right' : 'text-gray-500'}`}>
              {new Date(msg.created_at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
        )}
        {(!msg.content || msg.content === '📸 Story') && hasMedia && (
          <p className={`text-[10px] px-1 ${isMine ? 'text-gray-600 text-right' : 'text-gray-600'}`}>
            {new Date(msg.created_at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
        )}
      </div>
    </div>
  );
};

// ── Chat thread ──────────────────────────────────────────────────────────────
export const ChatThread: React.FC<ChatThreadProps> = ({ pubkey, onBack, onSend, onSnapSent, signer }) => {
  const allMessages = useAppStore(s => s.messages);
  const myPubkey = useAppStore(s => s.pubkey);
  const profiles = useAppStore(s => s.profiles);
  const markMessageOpened = useAppStore(s => s.markMessageOpened);

  const messages = allMessages.get(pubkey) ?? [];
  const profile = profiles.get(pubkey);
  const name = profile?.display_name || profile?.name || shortKey(pubkey);

  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [showSnap, setShowSnap] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleSend = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    try { await onSend(text.trim()); setText(''); }
    finally { setSending(false); }
  };

  const handleOpen = (msgId: string) => {
    markMessageOpened(pubkey, msgId);
  };

  return (
    <div className="flex flex-col h-full bg-[var(--bg)]">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)] safe-top">
        <button onClick={onBack} className="text-gray-400 hover:text-white p-1 -ml-1">
          <ArrowLeft size={22} />
        </button>
        <div className="w-9 h-9 rounded-full overflow-hidden bg-surface-raised flex-shrink-0">
          {profile?.picture
            ? <img src={profile.picture} alt={name} className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center text-flare-500 font-bold text-sm">{name[0]}</div>
          }
        </div>
        <div className="flex-1">
          <p className="text-white font-semibold text-sm">{name}</p>
          <div className="flex items-center gap-1">
            <Lock size={10} className="text-flare-500" />
            <span className="text-[10px] text-gray-500">End-to-end encrypted · NIP-17</span>
          </div>
        </div>
        {/* Snap camera shortcut in header */}
        <button onClick={() => setShowSnap(true)}
          className="w-9 h-9 rounded-full bg-flare-500/10 border border-flare-500/30 flex items-center justify-center text-flare-400 hover:bg-flare-500/20 transition-colors">
          <Camera size={16} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 scrollable px-4 py-3">
        {messages.length === 0 && (
          <div className="text-center py-16 space-y-3">
            <Lock size={32} className="mx-auto text-flare-500/40" />
            <p className="text-gray-600 text-sm">Messages are end-to-end encrypted</p>
            <button onClick={() => setShowSnap(true)}
              className="inline-flex items-center gap-2 bg-flare-500/10 border border-flare-500/20 rounded-2xl px-4 py-2 text-flare-400 text-sm hover:bg-flare-500/20 transition-colors">
              <Camera size={14} />
              Send a snap
            </button>
          </div>
        )}
        {messages.map(msg => (
          <MessageBubble key={msg.id} msg={msg} isMine={msg.senderPubkey === myPubkey}
            onOpen={() => handleOpen(msg.id)} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="flex items-center gap-2 px-4 py-3 border-t border-[var(--border)] flex-shrink-0"
        style={{ paddingBottom: 'calc(0.75rem + 64px + env(safe-area-inset-bottom, 0px))' }}>
        {/* Snap button in input row */}
        <button onClick={() => setShowSnap(true)}
          className="w-10 h-10 rounded-full bg-surface-raised flex items-center justify-center text-flare-400 border border-[var(--border)] flex-shrink-0 hover:border-flare-500/40 transition-colors">
          <Camera size={18} />
        </button>
        <input
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
          placeholder="Message…"
          className="flex-1 bg-surface-raised rounded-full px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none border border-[var(--border)] focus:border-flare-500/50"
        />
        <button onClick={handleSend} disabled={!text.trim() || sending}
          className="w-10 h-10 rounded-full bg-flare-500 flex items-center justify-center disabled:opacity-40 flex-shrink-0">
          <Send size={16} className="text-white translate-x-0.5" />
        </button>
      </div>

      {/* Snap composer overlay */}
      {showSnap && (
        <SnapComposer
          recipientPubkey={pubkey}
          recipientName={name}
          signer={signer}
          onClose={() => setShowSnap(false)}
          onSent={(mediaUrl, mediaType, viewOnce, caption) => {
            onSnapSent(mediaUrl, mediaType, viewOnce, caption);
            setShowSnap(false);
          }}
        />
      )}
    </div>
  );
};

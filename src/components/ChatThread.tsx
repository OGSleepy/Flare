import React, { useState, useRef, useEffect } from 'react';
import { ArrowLeft, Send, Lock, Play } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { shortKey } from '@/lib/nostr';
import type { FlareMessage } from '@/types';

interface ChatThreadProps {
  pubkey: string;
  onBack: () => void;
  onSend: (content: string) => Promise<void>;
}

// Render a single message bubble with optional story preview
const MessageBubble: React.FC<{ msg: FlareMessage; isMine: boolean }> = ({ msg, isMine }) => {
  const hasMedia = !!msg.mediaUrl;
  const isVideo = msg.mediaType === 'video';

  return (
    <div className={`flex ${isMine ? 'justify-end' : 'justify-start'} mb-1`}>
      <div className={`max-w-[80%] ${isMine ? 'items-end' : 'items-start'} flex flex-col gap-1`}>

        {/* Story preview card — shown when message has a media URL */}
        {hasMedia && (
          <div className={`rounded-2xl overflow-hidden border border-white/10 ${isMine ? 'rounded-br-sm' : 'rounded-bl-sm'}`}
            style={{ width: 200, aspectRatio: '9/16', maxHeight: 280, position: 'relative' }}>
            {isVideo ? (
              <video
                src={msg.mediaUrl}
                className="w-full h-full object-cover"
                playsInline
                muted
                loop
                autoPlay
              />
            ) : (
              <img src={msg.mediaUrl} alt="" className="w-full h-full object-cover" />
            )}
            {/* Overlay */}
            <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, transparent 50%, rgba(0,0,0,0.6) 100%)' }} />
            {isVideo && (
              <div className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 flex items-center justify-center">
                <Play size={12} className="text-white fill-white ml-0.5" />
              </div>
            )}
            {/* Story reply indicator */}
            <div className="absolute top-2 left-2 bg-black/60 backdrop-blur rounded-full px-2 py-0.5">
              <span className="text-white text-[9px] font-semibold">↩ Story</span>
            </div>
            {msg.storyCaption && (
              <p className="absolute bottom-2 left-2 right-2 text-white text-[10px] line-clamp-2 text-center">
                {msg.storyCaption}
              </p>
            )}
          </div>
        )}

        {/* Text bubble — only show if there's actual text content */}
        {(msg.content && msg.content !== '📸 Story') && (
          <div className={`px-4 py-2.5 text-sm text-white ${isMine ? 'bubble-sent' : 'bubble-recv'} ${msg.pending ? 'opacity-60' : ''}`}>
            <p className="break-words">{msg.content}</p>
            <p className={`text-[10px] mt-1 ${isMine ? 'text-white/60 text-right' : 'text-gray-500'}`}>
              {new Date(msg.created_at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
        )}

        {/* Timestamp only when just media, no text */}
        {(!msg.content || msg.content === '📸 Story') && hasMedia && (
          <p className={`text-[10px] px-1 ${isMine ? 'text-gray-600 text-right' : 'text-gray-600'}`}>
            {new Date(msg.created_at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
        )}
      </div>
    </div>
  );
};

export const ChatThread: React.FC<ChatThreadProps> = ({ pubkey, onBack, onSend }) => {
  const allMessages = useAppStore(s => s.messages);
  const myPubkey = useAppStore(s => s.pubkey);
  const profiles = useAppStore(s => s.profiles);

  const messages = allMessages.get(pubkey) ?? [];
  const profile = profiles.get(pubkey);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const name = profile?.display_name || profile?.name || shortKey(pubkey);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleSend = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    try { await onSend(text.trim()); setText(''); }
    finally { setSending(false); }
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
      </div>

      {/* Messages */}
      <div className="flex-1 scrollable px-4 py-3">
        {messages.length === 0 && (
          <div className="text-center py-16">
            <Lock size={32} className="mx-auto text-flare-500/40 mb-3" />
            <p className="text-gray-600 text-sm">Messages are end-to-end encrypted</p>
          </div>
        )}
        {messages.map(msg => (
          <MessageBubble key={msg.id} msg={msg} isMine={msg.senderPubkey === myPubkey} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex items-center gap-2 px-4 py-3 border-t border-[var(--border)] flex-shrink-0"
        style={{ paddingBottom: 'calc(0.75rem + 64px + env(safe-area-inset-bottom, 0px))' }}>
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
    </div>
  );
};

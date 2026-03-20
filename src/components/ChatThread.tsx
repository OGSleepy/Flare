import React, { useState, useRef, useEffect } from 'react';
import { ArrowLeft, Send, Lock } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { shortKey } from '@/lib/nostr';

interface ChatThreadProps {
  pubkey: string;
  onBack: () => void;
  onSend: (content: string) => Promise<void>;
}

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
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)] safe-top">
        <button onClick={onBack} className="text-gray-400 hover:text-white p-1 -ml-1"><ArrowLeft size={22} /></button>
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

      <div className="flex-1 scrollable px-4 py-3 space-y-2">
        {messages.length === 0 && (
          <div className="text-center py-16">
            <Lock size={32} className="mx-auto text-flare-500/40 mb-3" />
            <p className="text-gray-600 text-sm">Messages are end-to-end encrypted</p>
          </div>
        )}
        {messages.map(msg => {
          const isMine = msg.senderPubkey === myPubkey;
          return (
            <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[75%] px-4 py-2.5 text-sm text-white ${isMine ? 'bubble-sent' : 'bubble-recv'} ${msg.pending ? 'opacity-60' : ''}`}>
                <p>{msg.content}</p>
                <p className={`text-[10px] mt-1 ${isMine ? 'text-white/60 text-right' : 'text-gray-500'}`}>
                  {new Date(msg.created_at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div className="flex items-center gap-2 px-4 py-3 border-t border-[var(--border)] safe-bottom">
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

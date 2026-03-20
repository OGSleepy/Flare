import React, { useEffect, useState, useCallback } from 'react';
import { Edit, Search, Lock, MessageCircle, X, ArrowRight } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { fetchProfiles, shortKey, DM_RELAYS, getPool } from '@/lib/nostr';
import { decryptDM, sendDM } from '@/lib/nip17';
import { ChatThread } from '@/components/ChatThread';
import type { NostrSigner } from '@nostrify/nostrify';
import type { NostrEvent } from '@nostrify/nostrify';
import type { Conversation, FlareMessage } from '@/types';
import * as nip19 from 'nostr-tools/nip19';

interface ChatScreenProps { signer: NostrSigner | null; }

export const ChatScreen: React.FC<ChatScreenProps> = ({ signer }) => {
  const pubkey = useAppStore(s => s.pubkey);
  const activeChatPubkey = useAppStore(s => s.activeChatPubkey);
  const setActiveChat = useAppStore(s => s.setActiveChat);
  const profiles = useAppStore(s => s.profiles);
  const setProfileCache = useAppStore(s => s.setProfileCache);
  const conversations = useAppStore(s => s.conversations);
  const setConversations = useAppStore(s => s.setConversations);
  const addMessage = useAppStore(s => s.addMessage);

  const [search, setSearch] = useState('');
  const [showCompose, setShowCompose] = useState(false);
  const [composeInput, setComposeInput] = useState('');
  const [composeError, setComposeError] = useState('');

  const handleStartDM = async () => {
    setComposeError('');
    let targetPubkey = composeInput.trim();
    // Decode npub if needed
    try {
      if (targetPubkey.startsWith('npub')) {
        const { type, data } = nip19.decode(targetPubkey);
        if (type !== 'npub') throw new Error('Invalid npub');
        targetPubkey = data as string;
      }
      if (!/^[0-9a-f]{64}$/i.test(targetPubkey)) throw new Error('Invalid pubkey format');
      // Load their profile
      await fetchProfiles([targetPubkey]).then(profs => {
        if (profs[0]) setProfileCache(profs[0]);
      });
      setShowCompose(false);
      setComposeInput('');
      setActiveChat(targetPubkey);
    } catch {
      setComposeError('Enter a valid npub or hex pubkey');
    }
  };

  useEffect(() => {
    if (!pubkey || !signer) return;
    const pool = getPool();
    const sub = (pool as any).req([{ kinds: [1059], '#p': [pubkey], limit: 100 }], DM_RELAYS);
    const subscription = sub?.subscribe?.({
      next: async (msg: any) => {
        if (msg?.[0] !== 'EVENT') return;
        const wrap: NostrEvent = msg[2];
        const dm = await decryptDM(wrap, signer as any).catch(() => null);
        if (!dm) return;
        const convoKey = dm.senderPubkey === pubkey ? dm.recipientPubkey : dm.senderPubkey;
        addMessage(convoKey, dm);
        if (!profiles.get(convoKey)) {
          const profs = await fetchProfiles([convoKey]);
          profs.forEach(p => setProfileCache(p));
        }
        const profile = profiles.get(convoKey);
        const updated: Conversation = { pubkey: convoKey, lastMessage: dm.content.slice(0, 60), lastAt: dm.created_at, unread: dm.senderPubkey !== pubkey };
        const existing = conversations.find((c: Conversation) => c.pubkey === convoKey);
        const next = existing
          ? conversations.map((c: Conversation) => c.pubkey === convoKey ? updated : c)
          : [updated, ...conversations].sort((a, b) => b.lastAt - a.lastAt);
        setConversations(next);
      },
    });
    return () => subscription?.unsubscribe?.();
  }, [pubkey, signer]);

  const handleSend = useCallback(async (content: string) => {
    if (!signer || !activeChatPubkey || !pubkey) return;
    const optimistic: FlareMessage = { id: `pending-${Date.now()}`, senderPubkey: pubkey, recipientPubkey: activeChatPubkey, content, created_at: Math.floor(Date.now() / 1000), pending: true };
    addMessage(activeChatPubkey, optimistic);
    await sendDM(signer as any, activeChatPubkey, content);
  }, [signer, activeChatPubkey, pubkey, addMessage]);

  const filtered = conversations.filter(c => {
    if (!search) return true;
    const profile = profiles.get(c.pubkey);
    const name = profile?.display_name || profile?.name || c.pubkey;
    return name.toLowerCase().includes(search.toLowerCase());
  });

  if (activeChatPubkey) return <ChatThread pubkey={activeChatPubkey} onBack={() => setActiveChat(null)} onSend={handleSend} />;

  return (
    <div className="flex flex-col h-full bg-[var(--bg)]">
      <div className="px-5 pt-14 pb-3 safe-top">
        <div className="flex items-center justify-between mb-4">
          <h1 className="font-display text-2xl font-extrabold text-white">Messages</h1>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-surface-raised px-2.5 py-1 rounded-full border border-[var(--border)]">
              <Lock size={10} className="text-flare-500" />
              <span className="text-[10px] text-gray-500">NIP-17</span>
            </div>
            <button
              onClick={() => setShowCompose(true)}
              className="w-9 h-9 rounded-full bg-surface flex items-center justify-center text-gray-400 border border-[var(--border)] hover:text-white transition-colors">
              <Edit size={16} />
            </button>
          </div>
        </div>
        <div className="relative">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-600" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search messages…"
            className="w-full bg-surface-raised border border-[var(--border)] rounded-2xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-flare-500/40" />
        </div>
      </div>

      <div className="flex-1 scrollable pb-24">
        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 px-6">
            <div className="w-16 h-16 rounded-2xl bg-surface flex items-center justify-center"><MessageCircle size={28} className="text-gray-600" /></div>
            <p className="text-gray-500 text-sm text-center">No conversations yet.<br />Reply to a story to start chatting!</p>
          </div>
        )}
        <div className="px-4 space-y-1">
          {filtered.map(convo => {
            const profile = profiles.get(convo.pubkey);
            const name = profile?.display_name || profile?.name || shortKey(convo.pubkey);
            const mins = Math.floor((Date.now() / 1000 - convo.lastAt) / 60);
            const timeLabel = mins < 1 ? 'now' : mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h`;
            return (
              <button key={convo.pubkey} onClick={() => setActiveChat(convo.pubkey)}
                className="w-full flex items-center gap-3 px-3 py-3.5 rounded-2xl hover:bg-surface-raised transition-colors active:scale-[0.98]">
                <div className="relative flex-shrink-0">
                  <div className="w-12 h-12 rounded-full overflow-hidden bg-surface-raised">
                    {profile?.picture ? <img src={profile.picture} alt={name} className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center text-flare-500 font-bold">{name[0]}</div>}
                  </div>
                  {convo.unread && <div className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-flare-500 border-2 border-[var(--bg)]" />}
                </div>
                <div className="flex-1 text-left min-w-0">
                  <div className="flex items-center justify-between">
                    <p className={`text-sm truncate ${convo.unread ? 'text-white font-semibold' : 'text-gray-300 font-medium'}`}>{name}</p>
                    <span className={`text-xs flex-shrink-0 ml-2 ${convo.unread ? 'text-flare-500 font-semibold' : 'text-gray-600'}`}>{timeLabel}</span>
                  </div>
                  <p className={`text-xs truncate mt-0.5 ${convo.unread ? 'text-gray-300' : 'text-gray-600'}`}>{convo.lastMessage}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* New Message sheet */}
      {showCompose && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowCompose(false)} />
          <div className="relative bg-surface rounded-t-3xl px-5 pt-4 animate-slide-up"
            style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom, 0px))' }}>
            <div className="w-10 h-1 rounded-full bg-white/20 mx-auto mb-5" />
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display font-bold text-white text-lg">New Message</h3>
              <button onClick={() => setShowCompose(false)} className="text-gray-500 hover:text-white">
                <X size={20} />
              </button>
            </div>
            <p className="text-gray-500 text-xs mb-3">Enter an npub or hex pubkey to start a private encrypted conversation.</p>
            <div className="flex gap-2">
              <input
                autoFocus
                value={composeInput}
                onChange={e => { setComposeInput(e.target.value); setComposeError(''); }}
                onKeyDown={e => e.key === 'Enter' && handleStartDM()}
                placeholder="npub1… or hex pubkey"
                className="flex-1 bg-surface-raised border border-[var(--border)] rounded-2xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-flare-500/50 font-mono"
              />
              <button
                onClick={handleStartDM}
                disabled={!composeInput.trim()}
                className="w-12 h-12 rounded-2xl bg-flare-500 flex items-center justify-center disabled:opacity-40 flex-shrink-0"
              >
                <ArrowRight size={18} className="text-white" />
              </button>
            </div>
            {composeError && <p className="text-red-400 text-xs mt-2">{composeError}</p>}
          </div>
        </div>
      )}
    </div>
  );
};

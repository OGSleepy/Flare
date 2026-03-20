import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Edit, Search, Lock, MessageCircle, X, ArrowRight } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { fetchProfiles, shortKey, fetchDMRelays, DM_RELAYS } from '@/lib/nostr';
import { decryptDM, sendDM } from '@/lib/nip17';
import { ChatThread } from '@/components/ChatThread';
import type { NostrSigner, NostrEvent } from '@nostrify/nostrify';
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
  const followList = useAppStore(s => s.followList);

  const [search, setSearch] = useState('');
  const [showCompose, setShowCompose] = useState(false);
  const [composeSearch, setComposeSearch] = useState('');
  const [composeInput, setComposeInput] = useState('');
  const [composeError, setComposeError] = useState('');

  // ── DM subscription — connects to user's kind 10050 inbox relays ─────────
  const wsRefs = useRef<WebSocket[]>([]);

  useEffect(() => {
    if (!pubkey || !signer) return;

    // Close existing connections
    wsRefs.current.forEach(ws => ws.close());
    wsRefs.current = [];

    const processedIds = new Set<string>();

    const subscribe = async () => {
      // Get user's own DM inbox relays from kind 10050
      const inboxRelays = await fetchDMRelays(pubkey).catch(() => DM_RELAYS);

      inboxRelays.forEach(url => {
        try {
          const ws = new WebSocket(url);
          wsRefs.current.push(ws);

          ws.onopen = () => {
            const sub = JSON.stringify(['REQ', 'dm-sub', { kinds: [1059], '#p': [pubkey], limit: 100 }]);
            ws.send(sub);
          };

          ws.onmessage = async (evt) => {
            try {
              const msg = JSON.parse(evt.data);
              if (msg[0] !== 'EVENT') return;
              const wrap: NostrEvent = msg[2];
              if (!wrap?.id || processedIds.has(wrap.id)) return;
              processedIds.add(wrap.id);

              const dm = await decryptDM(wrap, signer as any).catch(() => null);
              if (!dm) return;

              const convoKey = dm.senderPubkey === pubkey ? dm.recipientPubkey : dm.senderPubkey;
              addMessage(convoKey, dm);

              if (!useAppStore.getState().profiles.get(convoKey)) {
                fetchProfiles([convoKey]).then(profs => profs.forEach(p => setProfileCache(p)));
              }

              const store = useAppStore.getState();
              const updated: Conversation = {
                pubkey: convoKey,
                lastMessage: dm.content.slice(0, 60),
                lastAt: dm.created_at,
                unread: dm.senderPubkey !== pubkey,
              };
              const existing = store.conversations.find(c => c.pubkey === convoKey);
              store.setConversations(
                existing
                  ? store.conversations.map(c => c.pubkey === convoKey ? updated : c)
                  : [updated, ...store.conversations].sort((a, b) => b.lastAt - a.lastAt)
              );
            } catch { /* malformed message */ }
          };

          ws.onerror = () => {};
        } catch { /* ws failed */ }
      });
    };

    subscribe();

    return () => {
      wsRefs.current.forEach(ws => ws.close());
      wsRefs.current = [];
    };
  }, [pubkey, signer]);

  // ── Compose / new message ─────────────────────────────────────────────────
  const openChat = async (targetPubkey: string) => {
    if (!profiles.get(targetPubkey)) {
      await fetchProfiles([targetPubkey]).then(profs => profs.forEach(p => setProfileCache(p)));
    }
    setShowCompose(false);
    setComposeInput('');
    setComposeSearch('');
    setActiveChat(targetPubkey);
  };

  const handleStartDM = async () => {
    setComposeError('');
    let targetPubkey = composeInput.trim();
    try {
      if (targetPubkey.startsWith('npub')) {
        const { type, data } = nip19.decode(targetPubkey);
        if (type !== 'npub') throw new Error('Invalid npub');
        targetPubkey = data as string;
      }
      if (!/^[0-9a-f]{64}$/i.test(targetPubkey)) throw new Error('Invalid pubkey format');
      await openChat(targetPubkey);
    } catch {
      setComposeError('Enter a valid npub or hex pubkey');
    }
  };

  // ── Send ──────────────────────────────────────────────────────────────────
  const handleSend = useCallback(async (content: string) => {
    if (!signer || !activeChatPubkey || !pubkey) return;
    const now = Math.floor(Date.now() / 1000);
    const optimistic: FlareMessage = {
      id: `pending-${Date.now()}`,
      senderPubkey: pubkey,
      recipientPubkey: activeChatPubkey,
      content,
      created_at: now,
      pending: true,
    };
    addMessage(activeChatPubkey, optimistic);

    // Update conversations immediately
    const updated: Conversation = { pubkey: activeChatPubkey, lastMessage: content.slice(0, 60), lastAt: now, unread: false };
    const store = useAppStore.getState();
    const exists = store.conversations.find(c => c.pubkey === activeChatPubkey);
    store.setConversations(
      exists
        ? store.conversations.map(c => c.pubkey === activeChatPubkey ? updated : c)
        : [updated, ...store.conversations].sort((a, b) => b.lastAt - a.lastAt)
    );

    await sendDM(signer as any, activeChatPubkey, content);
  }, [signer, activeChatPubkey, pubkey, addMessage]);

  // ── Follow list for compose picker ───────────────────────────────────────
  const allContacts = [...new Set([...followList, ...conversations.map(c => c.pubkey)])];
  const filteredContacts = allContacts.filter(pk => {
    if (!composeSearch) return true;
    const profile = profiles.get(pk);
    const name = (profile?.display_name || profile?.name || pk).toLowerCase();
    return name.includes(composeSearch.toLowerCase()) || pk.startsWith(composeSearch);
  }).slice(0, 60);

  // ── Conversation list filter ──────────────────────────────────────────────
  const filtered = conversations.filter(c => {
    if (!search) return true;
    const profile = profiles.get(c.pubkey);
    const name = profile?.display_name || profile?.name || c.pubkey;
    return name.toLowerCase().includes(search.toLowerCase());
  });

  if (activeChatPubkey) {
    return <ChatThread pubkey={activeChatPubkey} onBack={() => setActiveChat(null)} onSend={handleSend} />;
  }

  return (
    <div className="flex flex-col h-full bg-[var(--bg)]">
      {/* Header */}
      <div className="px-5 pt-14 pb-3 safe-top">
        <div className="flex items-center justify-between mb-4">
          <h1 className="font-display text-2xl font-extrabold text-white">Messages</h1>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-surface-raised px-2.5 py-1 rounded-full border border-[var(--border)]">
              <Lock size={10} className="text-flare-500" />
              <span className="text-[10px] text-gray-500">NIP-17</span>
            </div>
            <button onClick={() => setShowCompose(true)}
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

      {/* Conversation list */}
      <div className="flex-1 scrollable pb-24">
        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 px-6">
            <div className="w-16 h-16 rounded-2xl bg-surface flex items-center justify-center">
              <MessageCircle size={28} className="text-gray-600" />
            </div>
            <p className="text-gray-500 text-sm text-center">
              No conversations yet.<br />
              <button onClick={() => setShowCompose(true)} className="text-flare-500 underline">Start one</button>
            </p>
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
                    {profile?.picture
                      ? <img src={profile.picture} alt={name} className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center text-flare-500 font-bold">{name[0]}</div>
                    }
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
        <div className="fixed inset-0 z-[60] flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowCompose(false)} />
          <div className="relative bg-surface rounded-t-3xl px-5 pt-4 animate-slide-up"
            style={{ maxHeight: '80vh', paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))' }}>
            <div className="w-10 h-1 rounded-full bg-white/20 mx-auto mb-4" />
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-display font-bold text-white text-lg">New Message</h3>
              <button onClick={() => setShowCompose(false)} className="text-gray-500 hover:text-white"><X size={20} /></button>
            </div>

            {/* Search bar */}
            <div className="relative mb-3">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600" />
              <input
                autoFocus
                value={composeSearch}
                onChange={e => { setComposeSearch(e.target.value); setComposeInput(''); setComposeError(''); }}
                placeholder="Search by name or paste npub…"
                className="w-full bg-surface-raised border border-[var(--border)] rounded-2xl pl-9 pr-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-flare-500/50"
              />
            </div>

            {/* Contact list */}
            {filteredContacts.length > 0 ? (
              <div className="overflow-y-auto space-y-1" style={{ maxHeight: '40vh' }}>
                {filteredContacts.map(pk => {
                  const profile = profiles.get(pk);
                  const name = profile?.display_name || profile?.name || shortKey(pk);
                  return (
                    <button key={pk} onClick={() => openChat(pk)}
                      className="w-full flex items-center gap-3 px-3 py-3 rounded-2xl hover:bg-surface-raised transition-colors active:scale-[0.98]">
                      <div className="w-10 h-10 rounded-full overflow-hidden bg-surface-overlay flex-shrink-0">
                        {profile?.picture
                          ? <img src={profile.picture} alt={name} className="w-full h-full object-cover" />
                          : <div className="w-full h-full flex items-center justify-center text-flare-500 font-bold">{name[0]?.toUpperCase()}</div>
                        }
                      </div>
                      <div className="text-left min-w-0">
                        <p className="text-white text-sm font-medium truncate">{name}</p>
                        <p className="text-gray-600 text-xs font-mono truncate">{shortKey(pk)}</p>
                      </div>
                      <ArrowRight size={16} className="text-gray-600 ml-auto flex-shrink-0" />
                    </button>
                  );
                })}
              </div>
            ) : composeSearch && (
              <div>
                <p className="text-gray-600 text-xs mb-3 text-center">No matches — paste their npub directly</p>
                <div className="flex gap-2">
                  <input
                    value={composeInput}
                    onChange={e => { setComposeInput(e.target.value); setComposeError(''); }}
                    onKeyDown={e => e.key === 'Enter' && handleStartDM()}
                    placeholder="npub1…"
                    className="flex-1 bg-surface-raised border border-[var(--border)] rounded-2xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-flare-500/50 font-mono"
                  />
                  <button onClick={handleStartDM} disabled={!composeInput.trim()}
                    className="w-12 h-12 rounded-2xl bg-flare-500 flex items-center justify-center disabled:opacity-40 flex-shrink-0">
                    <ArrowRight size={18} className="text-white" />
                  </button>
                </div>
                {composeError && <p className="text-red-400 text-xs mt-2">{composeError}</p>}
              </div>
            )}

            {/* Always show npub input when no contacts at all */}
            {allContacts.length === 0 && (
              <div className="space-y-2">
                <p className="text-gray-500 text-xs">Paste an npub to start a conversation</p>
                <div className="flex gap-2">
                  <input
                    value={composeInput}
                    onChange={e => { setComposeInput(e.target.value); setComposeError(''); }}
                    onKeyDown={e => e.key === 'Enter' && handleStartDM()}
                    placeholder="npub1…"
                    className="flex-1 bg-surface-raised border border-[var(--border)] rounded-2xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-flare-500/50 font-mono"
                  />
                  <button onClick={handleStartDM} disabled={!composeInput.trim()}
                    className="w-12 h-12 rounded-2xl bg-flare-500 flex items-center justify-center disabled:opacity-40 flex-shrink-0">
                    <ArrowRight size={18} className="text-white" />
                  </button>
                </div>
                {composeError && <p className="text-red-400 text-xs mt-2">{composeError}</p>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

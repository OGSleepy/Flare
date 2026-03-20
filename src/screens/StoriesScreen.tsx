import React, { useEffect, useState, useCallback } from 'react';
import { Flame, Plus, Loader2 } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { fetchStories, fetchProfiles, shortKey, unixNow } from '@/lib/nostr';
import { StoryViewer } from '@/components/StoryViewer';
import type { NostrSigner } from '@nostrify/nostrify';
import type { FlareStory } from '@/types';
import { sendDM } from '@/lib/nip17';
import { toast } from 'sonner';
interface StoriesScreenProps { signer: NostrSigner | null; }

function groupByPubkey(stories: FlareStory[]): Map<string, FlareStory[]> {
  const map = new Map<string, FlareStory[]>();
  stories.forEach(s => { const arr = map.get(s.pubkey) ?? []; map.set(s.pubkey, [...arr, s]); });
  return map;
}

export const StoriesScreen: React.FC<StoriesScreenProps> = ({ signer }) => {
  const stories = useAppStore(s => s.stories);
  const setStories = useAppStore(s => s.setStories);
  const setProfileCache = useAppStore(s => s.setProfileCache);
  const profiles = useAppStore(s => s.profiles);
  const viewedStories = useAppStore(s => s.viewedStories);
  const pubkey = useAppStore(s => s.pubkey);
  const setScreen = useAppStore(s => s.setScreen);
  const addMessage = useAppStore(s => s.addMessage);
  const conversations = useAppStore(s => s.conversations);
  const setConversations = useAppStore(s => s.setConversations);

  const [loading, setLoading] = useState(false);
  const [viewingPubkey, setViewingPubkey] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchStories().then(async fresh => {
      setStories(fresh);
      const pks = [...new Set(fresh.map(s => s.pubkey))];
      const profs = await fetchProfiles(pks);
      profs.forEach(p => setProfileCache(p));
    }).finally(() => setLoading(false));
  }, []);

  const grouped = groupByPubkey(stories);
  const pubkeys = [...grouped.keys()];
  const myPubkey = pubkey;
  const orderedPubkeys = [...(myPubkey && grouped.has(myPubkey) ? [myPubkey] : []), ...pubkeys.filter(p => p !== myPubkey)];

  const handleReply = useCallback(async (toPubkey: string, message: string) => {
    if (!signer || !pubkey) { toast.error('Sign in to reply'); return; }
    try {
      await sendDM(signer as any, toPubkey, message);

      // Add to local messages immediately so it shows in Chat without waiting for relay
      const now = Math.floor(Date.now() / 1000);
      addMessage(toPubkey, {
        id: `sent-${Date.now()}`,
        senderPubkey: pubkey,
        recipientPubkey: toPubkey,
        content: message,
        created_at: now,
        pending: false,
      });

      // Update conversation list
      const updated = { pubkey: toPubkey, lastMessage: message.slice(0, 60), lastAt: now, unread: false };
      const exists = conversations.find(c => c.pubkey === toPubkey);
      setConversations(
        exists
          ? conversations.map(c => c.pubkey === toPubkey ? updated : c)
          : [updated, ...conversations].sort((a, b) => b.lastAt - a.lastAt)
      );

      toast.success('Reply sent 🔥');
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to send reply');
    }
  }, [signer, pubkey, addMessage, conversations, setConversations]);

  const handleClose = useCallback(() => setViewingPubkey(null), []);

  return (
    <div className="flex flex-col h-full bg-[var(--bg)]">
      <div className="px-5 pt-14 pb-4 safe-top">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl font-extrabold text-white">Stories</h1>
          <div className="flex items-center gap-1 text-flare-500">
            <Flame size={16} />
            <span className="text-xs font-semibold">{stories.length} live</span>
          </div>
        </div>
      </div>

      {loading && stories.length === 0 && (
        <div className="flex-1 flex items-center justify-center"><Loader2 size={28} className="text-flare-500 animate-spin" /></div>
      )}
      {!loading && stories.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6">
          <Flame size={36} className="text-flare-500/40" />
          <p className="text-gray-500 text-center text-sm">No stories yet. Be the first to post one!</p>
          <button onClick={() => setScreen('camera')}
            className="flex items-center gap-2 px-5 py-3 rounded-2xl font-semibold text-white flare-glow"
            style={{ background: 'linear-gradient(135deg,#f97316,#fb923c)' }}>
            <Plus size={16} /> Post a Story
          </button>
        </div>
      )}

      <div className="flex-1 scrollable">
        {orderedPubkeys.length > 0 && (
          <div className="px-5 py-2">
            <div className="flex gap-4 overflow-x-auto pb-2" style={{ scrollbarWidth: 'none' }}>
              {!grouped.has(myPubkey ?? '') && myPubkey && (
                <button onClick={() => setScreen('camera')} className="flex flex-col items-center gap-1.5 flex-shrink-0">
                  <div className="w-[58px] h-[58px] rounded-full border-2 border-dashed border-flare-500/40 flex items-center justify-center bg-surface">
                    <Plus size={22} className="text-flare-500" />
                  </div>
                  <span className="text-[10px] text-gray-500 font-medium">You</span>
                </button>
              )}
              {orderedPubkeys.map(pk => {
                const profile = profiles.get(pk);
                const storyList = grouped.get(pk) ?? [];
                const allSeen = storyList.every(s => viewedStories.has(s.id));
                const name = profile?.display_name || profile?.name || shortKey(pk);
                return (
                  <button key={pk} onClick={() => setViewingPubkey(pk)} className="flex flex-col items-center gap-1.5 flex-shrink-0">
                    <div className={allSeen ? 'story-ring-seen' : 'story-ring'}>
                      <div className="w-[54px] h-[54px] rounded-full overflow-hidden bg-surface-raised">
                        {profile?.picture ? <img src={profile.picture} alt={name} className="w-full h-full object-cover" />
                          : <div className="w-full h-full flex items-center justify-center text-flare-500 font-bold text-xl">{name[0]}</div>}
                      </div>
                    </div>
                    <span className="text-[10px] text-gray-400 max-w-[60px] truncate text-center">{pk === myPubkey ? 'You' : name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="px-4 space-y-3 pb-24 mt-2">
          {orderedPubkeys.map(pk => {
            const profile = profiles.get(pk);
            const storyList = grouped.get(pk) ?? [];
            const latest = storyList[0];
            const name = profile?.display_name || profile?.name || shortKey(pk);
            const allSeen = storyList.every(s => viewedStories.has(s.id));
            const mins = Math.floor((unixNow() - latest.created_at) / 60);
            const timeLabel = mins < 60 ? `${mins}m ago` : `${Math.floor(mins / 60)}h ago`;
            return (
              <button key={pk} onClick={() => setViewingPubkey(pk)}
                className="w-full flex items-center gap-3 bg-surface rounded-2xl p-3 border border-[var(--border)] active:scale-[0.98] transition-transform">
                <div className={allSeen ? 'story-ring-seen' : 'story-ring'}>
                  <div className="w-[52px] h-[52px] rounded-full overflow-hidden bg-surface-raised">
                    {profile?.picture ? <img src={profile.picture} alt={name} className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center text-flare-500 font-bold text-lg">{name[0]}</div>}
                  </div>
                </div>
                <div className="flex-1 text-left min-w-0">
                  <p className={`font-semibold text-sm truncate ${allSeen ? 'text-gray-400' : 'text-white'}`}>{name}</p>
                  <p className="text-xs text-gray-600 mt-0.5">{storyList.length} {storyList.length === 1 ? 'story' : 'stories'} · {timeLabel}</p>
                </div>
                {latest.mediaType === 'image' && (
                  <div className="w-14 h-14 rounded-xl overflow-hidden flex-shrink-0">
                    <img src={latest.mediaUrl} alt="" className="w-full h-full object-cover" />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {viewingPubkey && <StoryViewer pubkey={viewingPubkey} onClose={handleClose} onReply={handleReply} />}
    </div>
  );
};

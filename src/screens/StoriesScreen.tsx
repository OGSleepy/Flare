import React, { useEffect, useState } from 'react';
import { Flame, Plus, Loader2 } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { fetchStories, fetchProfiles, shortKey } from '@/lib/nostr';
import { StoryViewer } from '@/components/StoryViewer';
import type { NostrSigner } from '@nostrify/nostrify';
import type { FlareStory } from '@/types';
import { sendDM } from '@/lib/nip17';

interface StoriesScreenProps {
  signer: NostrSigner | null;
}

// Group stories by pubkey
function groupByPubkey(stories: FlareStory[]): Map<string, FlareStory[]> {
  const map = new Map<string, FlareStory[]>();
  stories.forEach(s => {
    const arr = map.get(s.pubkey) ?? [];
    map.set(s.pubkey, [...arr, s]);
  });
  return map;
}

export const StoriesScreen: React.FC<StoriesScreenProps> = ({ signer }) => {
  const { stories, setStories, setProfileCache, profiles, viewedStories, pubkey, setScreen } = useAppStore(s => ({
    stories: s.stories,
    setStories: s.setStories,
    setProfileCache: s.setProfileCache,
    profiles: s.profiles,
    viewedStories: s.viewedStories,
    pubkey: s.pubkey,
    setScreen: s.setScreen,
  }));

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

  // My story first
  const myPubkey = pubkey;
  const orderedPubkeys = [
    ...(myPubkey && grouped.has(myPubkey) ? [myPubkey] : []),
    ...pubkeys.filter(p => p !== myPubkey),
  ];

  const handleReply = async (toPubkey: string, message: string) => {
    if (!signer) return;
    try { await sendDM(signer as any, toPubkey, message); }
    catch (e) { console.error('Failed to send DM reply', e); }
  };

  return (
    <div className="flex flex-col h-full bg-[var(--bg)]">
      {/* Header */}
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
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={28} className="text-flare-500 animate-spin" />
        </div>
      )}

      {!loading && stories.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6">
          <div className="w-20 h-20 rounded-3xl bg-surface flex items-center justify-center">
            <Flame size={36} className="text-flare-500/40" />
          </div>
          <p className="text-gray-500 text-center text-sm">No stories yet.<br />Be the first to post one!</p>
          <button onClick={() => setScreen('camera')}
            className="flex items-center gap-2 px-5 py-3 rounded-2xl font-semibold text-white flare-glow"
            style={{ background: 'linear-gradient(135deg, #f97316, #fb923c)' }}>
            <Plus size={16} /> Post a Story
          </button>
        </div>
      )}

      <div className="flex-1 scrollable">
        {/* Story bubbles row */}
        {orderedPubkeys.length > 0 && (
          <div className="px-5 py-2">
            <div className="flex gap-4 overflow-x-auto pb-2" style={{ scrollbarWidth: 'none' }}>
              {/* Add my story button */}
              {!grouped.has(myPubkey ?? '') && myPubkey && (
                <button onClick={() => setScreen('camera')} className="flex flex-col items-center gap-1.5 flex-shrink-0">
                  <div className="w-[58px] h-[58px] rounded-full border-2 border-dashed border-flare-500/40 flex items-center justify-center bg-surface">
                    <Plus size={22} className="text-flare-500" />
                  </div>
                  <span className="text-[10px] text-gray-500 font-medium max-w-[58px] truncate text-center">You</span>
                </button>
              )}
              {orderedPubkeys.map(pk => {
                const profile = profiles.get(pk);
                const isMine = pk === myPubkey;
                const storyList = grouped.get(pk) ?? [];
                const allSeen = storyList.every(s => viewedStories.has(s.id));
                const name = profile?.display_name || profile?.name || shortKey(pk);

                return (
                  <button key={pk} onClick={() => setViewingPubkey(pk)} className="flex flex-col items-center gap-1.5 flex-shrink-0">
                    <div className={allSeen ? 'story-ring-seen' : 'story-ring'}>
                      <div className="w-[54px] h-[54px] rounded-full overflow-hidden bg-surface-raised">
                        {profile?.picture
                          ? <img src={profile.picture} alt={name} className="w-full h-full object-cover" />
                          : <div className="w-full h-full flex items-center justify-center text-flare-500 font-bold text-xl">{name[0]}</div>
                        }
                      </div>
                    </div>
                    <span className="text-[10px] text-gray-400 max-w-[60px] truncate text-center">
                      {isMine ? 'You' : name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Full story cards list */}
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
              <button
                key={pk}
                onClick={() => setViewingPubkey(pk)}
                className="w-full flex items-center gap-3 bg-surface rounded-2xl p-3 border border-[var(--border)] active:scale-[0.98] transition-transform"
              >
                <div className={allSeen ? 'story-ring-seen' : 'story-ring'}>
                  <div className="w-[52px] h-[52px] rounded-full overflow-hidden bg-surface-raised">
                    {profile?.picture
                      ? <img src={profile.picture} alt={name} className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center text-flare-500 font-bold text-lg">{name[0]}</div>
                    }
                  </div>
                </div>

                <div className="flex-1 text-left min-w-0">
                  <p className={`font-semibold text-sm truncate ${allSeen ? 'text-gray-400' : 'text-white'}`}>{name}</p>
                  <p className="text-xs text-gray-600 mt-0.5">{storyList.length} {storyList.length === 1 ? 'story' : 'stories'} · {timeLabel}</p>
                </div>

                {/* Thumbnail */}
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

      {/* Story Viewer */}
      {viewingPubkey && (
        <StoryViewer
          pubkey={viewingPubkey}
          onClose={() => setViewingPubkey(null)}
          onReply={handleReply}
        />
      )}
    </div>
  );
};

function unixNow() { return Math.floor(Date.now() / 1000); }

import React, { useEffect, useState } from 'react';
import { Search, Compass, TrendingUp, Loader2 } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { fetchStories, fetchProfiles, shortKey, unixNow } from '@/lib/nostr';
import { StoryViewer } from '@/components/StoryViewer';
import type { FlareStory } from '@/types';

export const ExploreScreen: React.FC = () => {
  const stories = useAppStore(s => s.stories);
  const setStories = useAppStore(s => s.setStories);
  const profiles = useAppStore(s => s.profiles);
  const setProfileCache = useAppStore(s => s.setProfileCache);
  const viewedStories = useAppStore(s => s.viewedStories);

  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [viewingPubkey, setViewingPubkey] = useState<string | null>(null);

  useEffect(() => {
    if (stories.length > 0) return;
    setLoading(true);
    fetchStories().then(async fresh => {
      setStories(fresh);
      const pks = [...new Set(fresh.map(s => s.pubkey))];
      const profs = await fetchProfiles(pks);
      profs.forEach(p => setProfileCache(p));
    }).finally(() => setLoading(false));
  }, []);

  const imageStories = stories.filter(s => s.mediaType === 'image');
  const filtered = imageStories.filter(s => {
    if (!search) return true;
    const profile = profiles.get(s.pubkey);
    const name = profile?.display_name || profile?.name || s.pubkey;
    return name.toLowerCase().includes(search.toLowerCase()) || s.caption?.toLowerCase().includes(search.toLowerCase());
  });

  const col1: FlareStory[] = [], col2: FlareStory[] = [];
  filtered.forEach((s, i) => (i % 2 === 0 ? col1 : col2).push(s));

  return (
    <div className="flex flex-col h-full bg-[var(--bg)]">
      <div className="px-5 pt-14 pb-3 safe-top">
        <div className="flex items-center gap-2 mb-4">
          <Compass size={22} className="text-flare-500" />
          <h1 className="font-display text-2xl font-extrabold text-white">Explore</h1>
        </div>
        <div className="relative">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-600" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search people or stories…"
            className="w-full bg-surface-raised border border-[var(--border)] rounded-2xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-flare-500/40" />
        </div>
        {!search && (
          <div className="flex items-center gap-2 mt-3">
            <TrendingUp size={13} className="text-flare-500" />
            <span className="text-xs text-gray-500">{filtered.length} live stories right now</span>
          </div>
        )}
      </div>

      <div className="flex-1 scrollable pb-24 px-3">
        {loading && <div className="flex items-center justify-center py-20"><Loader2 size={28} className="text-flare-500 animate-spin" /></div>}
        {!loading && filtered.length === 0 && <div className="flex flex-col items-center justify-center py-20 gap-3"><Compass size={40} className="text-gray-700" /><p className="text-gray-500 text-sm">Nothing to explore yet</p></div>}

        {!loading && filtered.length > 0 && (
          <div className="flex gap-2">
            {[col1, col2].map((col, ci) => (
              <div key={ci} className="flex-1 flex flex-col gap-2">
                {col.map(story => {
                  const profile = profiles.get(story.pubkey);
                  const name = profile?.display_name || profile?.name || shortKey(story.pubkey);
                  const seen = viewedStories.has(story.id);
                  return (
                    <button key={story.id} onClick={() => setViewingPubkey(story.pubkey)}
                      className="relative rounded-2xl overflow-hidden bg-surface active:scale-95 transition-transform"
                      style={{ aspectRatio: ci === 0 ? '3/4' : '3/5' }}>
                      <img src={story.mediaUrl} alt={story.caption} className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
                      <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom,transparent 50%,rgba(0,0,0,0.75) 100%)' }} />
                      {!seen && <div className="absolute top-2.5 left-2.5 w-2 h-2 rounded-full bg-flare-500 shadow-lg" />}
                      <div className="absolute bottom-0 left-0 right-0 p-2.5">
                        <div className="flex items-center gap-1.5">
                          <div className="w-5 h-5 rounded-full overflow-hidden bg-surface-raised flex-shrink-0">
                            {profile?.picture ? <img src={profile.picture} alt={name} className="w-full h-full object-cover" />
                              : <div className="w-full h-full flex items-center justify-center text-flare-500 text-[9px] font-bold">{name[0]}</div>}
                          </div>
                          <span className="text-white text-[10px] font-semibold truncate">{name}</span>
                        </div>
                        {story.caption && <p className="text-white/70 text-[10px] mt-0.5 line-clamp-2 text-left">{story.caption}</p>}
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      {viewingPubkey && <StoryViewer pubkey={viewingPubkey} onClose={() => setViewingPubkey(null)} />}
    </div>
  );
};

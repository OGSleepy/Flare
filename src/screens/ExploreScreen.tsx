import React, { useEffect, useState, useCallback } from 'react';
import { Search, Compass, Loader2, RefreshCw, SlidersHorizontal, X, Wifi } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { fetchStoriesFromRelays, fetchProfiles, fetchRelayList, shortKey, unixNow, DEFAULT_RELAYS } from '@/lib/nostr';
import { StoryViewer } from '@/components/StoryViewer';
import type { FlareStory } from '@/types';

// Fallback relays shown if user has no NIP-65 list
const FALLBACK_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.snort.social',
  'wss://nostr.wine',
];

export const ExploreScreen: React.FC = () => {
  const profiles = useAppStore(s => s.profiles);
  const setProfileCache = useAppStore(s => s.setProfileCache);
  const viewedStories = useAppStore(s => s.viewedStories);
  const pubkey = useAppStore(s => s.pubkey);

  // The user's relay list from NIP-65
  const [userRelays, setUserRelays] = useState<string[]>([]);
  // Which relays are toggled on
  const [enabledRelays, setEnabledRelays] = useState<Set<string>>(new Set());
  const [relaysLoaded, setRelaysLoaded] = useState(false);

  const [exploreStories, setExploreStories] = useState<FlareStory[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [viewingPubkey, setViewingPubkey] = useState<string | null>(null);
  const [showFilterSheet, setShowFilterSheet] = useState(false);

  // Load user's NIP-65 relay list on mount
  useEffect(() => {
    if (!pubkey) {
      setUserRelays(FALLBACK_RELAYS);
      setEnabledRelays(new Set(FALLBACK_RELAYS));
      setRelaysLoaded(true);
      return;
    }
    fetchRelayList(pubkey).then(list => {
      const relays = [...new Set([...list.read, ...list.write])].filter(Boolean);
      const finalRelays = relays.length > 0 ? relays : FALLBACK_RELAYS;
      setUserRelays(finalRelays);
      setEnabledRelays(new Set(finalRelays)); // all on by default
      setRelaysLoaded(true);
    }).catch(() => {
      setUserRelays(FALLBACK_RELAYS);
      setEnabledRelays(new Set(FALLBACK_RELAYS));
      setRelaysLoaded(true);
    });
  }, [pubkey]);

  const loadStories = useCallback(async (relays: string[]) => {
    if (!relays.length) { setExploreStories([]); return; }
    setLoading(true);
    setExploreStories([]);
    try {
      const fresh = await fetchStoriesFromRelays(relays);
      setExploreStories(fresh);
      const pks = [...new Set(fresh.map(s => s.pubkey))];
      if (pks.length > 0) {
        const profs = await fetchProfiles(pks);
        profs.forEach(p => setProfileCache(p));
      }
    } finally {
      setLoading(false);
    }
  }, [setProfileCache]);

  // Fetch whenever enabled relays change (after initial load)
  useEffect(() => {
    if (!relaysLoaded) return;
    loadStories([...enabledRelays]);
  }, [relaysLoaded, enabledRelays.size]);

  const toggleRelay = (url: string) => {
    setEnabledRelays(prev => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  };

  const filtered = exploreStories.filter(s => {
    if (!search) return true;
    const profile = profiles.get(s.pubkey);
    const name = profile?.display_name || profile?.name || s.pubkey;
    return name.toLowerCase().includes(search.toLowerCase())
      || s.caption?.toLowerCase().includes(search.toLowerCase());
  });

  const col1: FlareStory[] = [], col2: FlareStory[] = [];
  filtered.forEach((s, i) => (i % 2 === 0 ? col1 : col2).push(s));

  const enabledCount = enabledRelays.size;

  return (
    <div className="flex flex-col h-full bg-[var(--bg)]">
      {/* Header */}
      <div className="px-5 pt-14 pb-3 safe-top space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Compass size={22} className="text-flare-500" />
            <h1 className="font-display text-2xl font-extrabold text-white">Explore</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => loadStories([...enabledRelays])}
              disabled={loading}
              className="w-9 h-9 rounded-full bg-surface-raised flex items-center justify-center text-gray-500 border border-[var(--border)] hover:text-white disabled:opacity-40 transition-colors"
            >
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            </button>
            {/* Relay filter button */}
            <button
              onClick={() => setShowFilterSheet(true)}
              className={`flex items-center gap-1.5 px-3 h-9 rounded-full border transition-all text-xs font-semibold ${
                enabledCount < userRelays.length
                  ? 'bg-flare-500/10 border-flare-500/40 text-flare-400'
                  : 'bg-surface-raised border-[var(--border)] text-gray-400 hover:text-white'
              }`}
            >
              <SlidersHorizontal size={13} />
              Relays {enabledCount < userRelays.length ? `(${enabledCount}/${userRelays.length})` : ''}
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-600" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search people or stories…"
            className="w-full bg-surface-raised border border-[var(--border)] rounded-2xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-flare-500/40"
          />
        </div>

        {!loading && !search && filtered.length > 0 && (
          <p className="text-xs text-gray-600">
            {filtered.length} {filtered.length === 1 ? 'story' : 'stories'} from {enabledCount} {enabledCount === 1 ? 'relay' : 'relays'}
          </p>
        )}
      </div>

      {/* Grid */}
      <div className="flex-1 scrollable pb-24 px-3">
        {loading && (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 size={28} className="text-flare-500 animate-spin" />
            <p className="text-gray-600 text-xs">Loading from {enabledCount} {enabledCount === 1 ? 'relay' : 'relays'}…</p>
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Compass size={40} className="text-gray-700" />
            <p className="text-gray-500 text-sm">
              {enabledCount === 0 ? 'Turn on at least one relay to explore' : 'No stories found'}
            </p>
            {enabledCount === 0 && (
              <button onClick={() => setShowFilterSheet(true)}
                className="text-flare-500 text-xs underline">
                Open relay settings
              </button>
            )}
          </div>
        )}

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
                      {story.mediaType === 'video'
                        ? <video src={story.mediaUrl} className="absolute inset-0 w-full h-full object-cover" muted playsInline />
                        : <img src={story.mediaUrl} alt={story.caption} className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
                      }
                      <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom,transparent 50%,rgba(0,0,0,0.75) 100%)' }} />
                      {!seen && <div className="absolute top-2.5 left-2.5 w-2 h-2 rounded-full bg-flare-500 shadow-lg" />}
                      <div className="absolute bottom-0 left-0 right-0 p-2.5">
                        <div className="flex items-center gap-1.5">
                          <div className="w-5 h-5 rounded-full overflow-hidden bg-surface-raised flex-shrink-0">
                            {profile?.picture
                              ? <img src={profile.picture} alt={name} className="w-full h-full object-cover" />
                              : <div className="w-full h-full flex items-center justify-center text-flare-500 text-[9px] font-bold">{name[0]}</div>
                            }
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

      {/* Relay filter sheet */}
      {showFilterSheet && (
        <div className="fixed inset-0 z-[60] flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowFilterSheet(false)} />
          <div className="relative bg-surface rounded-t-3xl px-5 pt-4 animate-slide-up"
            style={{ paddingBottom: 'calc(1.5rem + 64px + env(safe-area-inset-bottom, 0px))' }}>
            <div className="w-10 h-1 rounded-full bg-white/20 mx-auto mb-4" />
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-display font-bold text-white text-lg">Relay Filter</h3>
              <button onClick={() => setShowFilterSheet(false)} className="text-gray-500 hover:text-white">
                <X size={20} />
              </button>
            </div>
            <p className="text-gray-500 text-xs mb-4">Choose which relays to pull stories from</p>

            <div className="space-y-2 max-h-72 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
              {userRelays.map(url => {
                const on = enabledRelays.has(url);
                const label = url.replace(/^wss?:\/\//, '').replace(/\/$/, '');
                return (
                  <div key={url} className="flex items-center gap-3 bg-surface-raised rounded-2xl px-4 py-3 border border-[var(--border)]">
                    <div className="w-8 h-8 rounded-full bg-surface-overlay flex items-center justify-center flex-shrink-0">
                      <Wifi size={14} className={on ? 'text-flare-500' : 'text-gray-600'} />
                    </div>
                    <p className={`flex-1 text-sm font-mono truncate ${on ? 'text-white' : 'text-gray-500'}`}>{label}</p>
                    {/* Toggle */}
                    <button
                      onClick={() => toggleRelay(url)}
                      className={`w-12 h-6 rounded-full transition-colors relative flex-shrink-0 ${on ? 'bg-flare-500' : 'bg-surface-overlay border border-[var(--border)]'}`}
                    >
                      <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform shadow ${on ? 'translate-x-6' : 'translate-x-0.5'}`} />
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setEnabledRelays(new Set(userRelays))}
                className="flex-1 py-2.5 rounded-2xl text-sm font-semibold border border-[var(--border)] text-gray-400 bg-surface-raised hover:text-white transition-colors"
              >
                All on
              </button>
              <button
                onClick={() => setEnabledRelays(new Set())}
                className="flex-1 py-2.5 rounded-2xl text-sm font-semibold border border-[var(--border)] text-gray-400 bg-surface-raised hover:text-white transition-colors"
              >
                All off
              </button>
            </div>
          </div>
        </div>
      )}

      {viewingPubkey && <StoryViewer pubkey={viewingPubkey} onClose={() => setViewingPubkey(null)} />}
    </div>
  );
};

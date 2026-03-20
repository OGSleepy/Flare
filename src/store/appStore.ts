import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { NostrProfile, FlareStory, FlareMessage, Conversation, Screen } from '@/types';

interface AppState {
  // Auth
  pubkey: string | null;
  profile: NostrProfile | null;
  isAuthenticated: boolean;
  setAuth: (pubkey: string) => void;
  setProfile: (p: NostrProfile) => void;
  logout: () => void;

  // Navigation
  screen: Screen;
  setScreen: (s: Screen) => void;

  // Profiles cache
  profiles: Map<string, NostrProfile>;
  setProfileCache: (p: NostrProfile) => void;
  getProfileCache: (pk: string) => NostrProfile | undefined;

  // Stories
  stories: FlareStory[];
  setStories: (s: FlareStory[]) => void;
  addStory: (s: FlareStory) => void;
  viewedStories: Set<string>;
  markViewed: (id: string) => void;

  // Messages
  messages: Map<string, FlareMessage[]>;
  conversations: Conversation[];
  addMessage: (convo: string, msg: FlareMessage) => void;
  setConversations: (c: Conversation[]) => void;
  markMessageOpened: (convo: string, msgId: string) => void;

  // Follow list for DM picker
  followList: string[];
  setFollowList: (list: string[]) => void;

  // Active chat
  activeChatPubkey: string | null;
  setActiveChat: (pk: string | null) => void;

  // Active story viewer
  activeStoryPubkey: string | null;
  setActiveStoryPubkey: (pk: string | null) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      pubkey: null,
      profile: null,
      isAuthenticated: false,
      setAuth: (pubkey) => set({ pubkey, isAuthenticated: true }),
      setProfile: (profile) => set({ profile }),
      logout: () => set({
        pubkey: null, profile: null, isAuthenticated: false,
        stories: [], conversations: [], messages: new Map(),
        viewedStories: new Set(),
      }),

      screen: 'camera',
      setScreen: (screen) => set({ screen }),

      profiles: new Map(),
      setProfileCache: (p) => set(s => {
        const m = new Map(s.profiles); m.set(p.pubkey, p); return { profiles: m };
      }),
      getProfileCache: (pk) => get().profiles.get(pk),

      stories: [],
      setStories: (stories) => {
        const now = Math.floor(Date.now() / 1000);
        set({ stories: stories.filter(s => s.expires_at > now) });
      },
      addStory: (story) => set(s => ({
        stories: [story, ...s.stories.filter(x => x.id !== story.id)]
          .filter(x => x.expires_at > Math.floor(Date.now() / 1000)),
      })),
      viewedStories: new Set(),
      markViewed: (id) => set(s => ({ viewedStories: new Set([...s.viewedStories, id]) })),

      messages: new Map(),
      conversations: [],
      addMessage: (convo, msg) => set(s => {
        const m = new Map(s.messages);
        const existing = m.get(convo) ?? [];
        // Deduplicate
        if (!existing.find(e => e.id === msg.id)) {
          m.set(convo, [...existing, msg].sort((a, b) => a.created_at - b.created_at));
        }
        return { messages: m };
      }),
      setConversations: (c) => set({ conversations: c }),

      markMessageOpened: (convo, msgId) => set(s => {
        const m = new Map(s.messages);
        const msgs = m.get(convo) ?? [];
        m.set(convo, msgs.map(msg =>
          msg.id === msgId ? { ...msg, opened: true } : msg
        ));
        return { messages: m };
      }),

      followList: [],
      setFollowList: (list) => set({ followList: list }),

      activeChatPubkey: null,
      setActiveChat: (pk) => set({ activeChatPubkey: pk }),

      activeStoryPubkey: null,
      setActiveStoryPubkey: (pk) => set({ activeStoryPubkey: pk }),
    }),
    {
      name: 'flare-storage',
      partialize: (s) => ({
        pubkey: s.pubkey,
        profile: s.profile,
        viewedStories: [...s.viewedStories],
        conversations: s.conversations,
      }),
      merge: (persisted: any, current) => {
        try {
          return {
            ...current,
            pubkey: persisted?.pubkey ?? null,
            profile: persisted?.profile ?? null,
            isAuthenticated: !!persisted?.pubkey,
            viewedStories: new Set(Array.isArray(persisted?.viewedStories) ? persisted.viewedStories : []),
            conversations: Array.isArray(persisted?.conversations) ? persisted.conversations : [],
            profiles: new Map(),
            messages: new Map(),
            stories: [],
          };
        } catch {
          return { ...current, profiles: new Map(), messages: new Map(), stories: [], viewedStories: new Set() };
        }
      },
    },
  ),
);

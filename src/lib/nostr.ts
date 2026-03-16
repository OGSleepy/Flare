import { NPool, NRelay1, NCache } from '@nostrify/nostrify';
import type { NostrFilter, NostrEvent } from '@nostrify/nostrify';
import { EventStore } from 'applesauce-core';
import type { NostrProfile, FlareStory } from '@/types';

// ─── Singletons ────────────────────────────────────────────────────────────
export const eventStore = new EventStore();

export const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://relay.snort.social',
  'wss://nostr.wine',
];

// DM relays for NIP-17
export const DM_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
];

export const BLOSSOM_SERVER = 'https://blossom.primal.net/';

export const STORY_KIND = 30315;
export const STORY_EXPIRY = 24 * 60 * 60; // 24h in seconds

let _pool: NPool | null = null;
export const cache = new NCache({ max: 3000 });

export function getPool(): NPool {
  if (_pool) return _pool;
  _pool = new NPool({
    open: (url) => new NRelay1(url),
    reqRouter: async (filters) => {
      const routes = new Map<string, NostrFilter[]>();
      DEFAULT_RELAYS.forEach(url => routes.set(url, filters));
      return routes;
    },
    eventRouter: async () => DEFAULT_RELAYS,
  });
  return _pool;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function parseProfile(event: NostrEvent): NostrProfile | null {
  try {
    const meta = JSON.parse(event.content);
    return { pubkey: event.pubkey, ...meta };
  } catch { return null; }
}

export function parseStory(event: NostrEvent): FlareStory | null {
  try {
    const urlTag = event.tags.find(t => t[0] === 'url');
    const mTag = event.tags.find(t => t[0] === 'm');
    const expTag = event.tags.find(t => t[0] === 'expiration');

    const mediaUrl = urlTag?.[1];
    if (!mediaUrl) return null;

    const mime = mTag?.[1] ?? '';
    const isMedia =
      mime.startsWith('image/') ||
      mime.startsWith('video/') ||
      /\.(jpe?g|png|gif|webp|avif|mp4|mov|webm)(\?|$)/i.test(mediaUrl);
    if (!isMedia) return null;

    return {
      id: event.id,
      pubkey: event.pubkey,
      mediaUrl,
      mediaType: mime.startsWith('video/') ? 'video' : 'image',
      caption: event.content || undefined,
      created_at: event.created_at,
      expires_at: expTag ? parseInt(expTag[1]) : event.created_at + STORY_EXPIRY,
      tags: event.tags,
    };
  } catch { return null; }
}

export function unixNow() {
  return Math.floor(Date.now() / 1000);
}

export function shortKey(pubkey: string) {
  return pubkey.slice(0, 8) + '…' + pubkey.slice(-4);
}

export async function fetchProfiles(pubkeys: string[]): Promise<NostrProfile[]> {
  if (!pubkeys.length) return [];
  const pool = getPool();
  try {
    const events = await pool.query([{ kinds: [0], authors: pubkeys, limit: pubkeys.length }]);
    return events.map(e => {
      eventStore.add(e);
      return parseProfile(e);
    }).filter(Boolean) as NostrProfile[];
  } catch { return []; }
}

export async function fetchStories(): Promise<FlareStory[]> {
  const pool = getPool();
  const now = unixNow();
  try {
    const events = await pool.query([{ kinds: [STORY_KIND], since: now - STORY_EXPIRY, limit: 200 }]);
    return events.map(parseStory).filter(Boolean) as FlareStory[];
  } catch { return []; }
}

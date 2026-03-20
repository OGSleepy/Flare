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

export const DM_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
];

export const BLOSSOM_SERVER = 'https://blossom.primal.net/';
export const STORY_KIND = 30315;
export const STORY_EXPIRY = 24 * 60 * 60;

export const cache = new NCache({ max: 3000 });

// ─── NIP-65 relay list store ───────────────────────────────────────────────
// Maps pubkey → { read: string[], write: string[] }
interface RelayList { read: string[]; write: string[]; }
const relayListCache = new Map<string, RelayList>();

/** Parse a kind 10002 event into read/write relay lists */
function parseRelayList(event: NostrEvent): RelayList {
  const read: string[] = [];
  const write: string[] = [];
  for (const tag of event.tags) {
    if (tag[0] !== 'r' || !tag[1]) continue;
    const url = tag[1];
    const marker = tag[2];
    if (!marker || marker === 'read') read.push(url);
    if (!marker || marker === 'write') write.push(url);
  }
  return { read, write };
}

/** Fetch and cache NIP-65 relay list for a pubkey */
export async function fetchRelayList(pubkey: string): Promise<RelayList> {
  if (relayListCache.has(pubkey)) return relayListCache.get(pubkey)!;
  try {
    const pool = getPool();
    const events = await pool.query([{ kinds: [10002], authors: [pubkey], limit: 1 }]);
    if (events.length > 0) {
      const list = parseRelayList(events[0]);
      relayListCache.set(pubkey, list);
      return list;
    }
  } catch { /* fall through to defaults */ }
  const fallback = { read: DEFAULT_RELAYS, write: DEFAULT_RELAYS };
  relayListCache.set(pubkey, fallback);
  return fallback;
}

/** Get write relays for a pubkey (uses cache, falls back to defaults) */
export function getWriteRelays(pubkey: string): string[] {
  return relayListCache.get(pubkey)?.write ?? DEFAULT_RELAYS;
}

/** Get read relays for a pubkey (uses cache, falls back to defaults) */
export function getReadRelays(pubkey: string): string[] {
  return relayListCache.get(pubkey)?.read ?? DEFAULT_RELAYS;
}

// ─── Pool ──────────────────────────────────────────────────────────────────
let _pool: NPool | null = null;

export function getPool(): NPool {
  if (_pool) return _pool;
  _pool = new NPool({
    open: (url) => new NRelay1(url),

    // Outbox model: route queries to each author's read relays when known
    reqRouter: async (filters) => {
      const routes = new Map<string, NostrFilter[]>();

      for (const filter of filters) {
        const authors = filter.authors ?? [];
        if (authors.length > 0) {
          // Route to each author's known read relays
          const usedRelays = new Set<string>();
          for (const author of authors) {
            const relays = relayListCache.get(author)?.read ?? DEFAULT_RELAYS;
            relays.forEach(r => usedRelays.add(r));
          }
          for (const relay of usedRelays) {
            const existing = routes.get(relay) ?? [];
            routes.set(relay, [...existing, filter]);
          }
        } else {
          // No author filter — broadcast to all default relays
          DEFAULT_RELAYS.forEach(url => {
            const existing = routes.get(url) ?? [];
            routes.set(url, [...existing, filter]);
          });
        }
      }

      return routes;
    },

    // Outbox model: publish to the signing user's write relays
    eventRouter: async (event) => {
      const write = relayListCache.get(event.pubkey)?.write;
      return write && write.length > 0 ? write : DEFAULT_RELAYS;
    },
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
    const isMedia = mime.startsWith('image/') || mime.startsWith('video/') ||
      /\.(jpe?g|png|gif|webp|avif|mp4|mov|webm)(\?|$)/i.test(mediaUrl);
    if (!isMedia) return null;
    return {
      id: event.id, pubkey: event.pubkey, mediaUrl,
      mediaType: mime.startsWith('video/') ? 'video' : 'image',
      caption: event.content || undefined,
      created_at: event.created_at,
      expires_at: expTag ? parseInt(expTag[1]) : event.created_at + STORY_EXPIRY,
      tags: event.tags,
    };
  } catch { return null; }
}

export function unixNow() { return Math.floor(Date.now() / 1000); }
export function shortKey(pk: string) { return pk.slice(0, 8) + '…' + pk.slice(-4); }

export async function fetchProfiles(pubkeys: string[]): Promise<NostrProfile[]> {
  if (!pubkeys.length) return [];
  try {
    const pool = getPool();
    const events = await pool.query([{ kinds: [0], authors: pubkeys, limit: pubkeys.length }]);
    return events.map(e => { eventStore.add(e); return parseProfile(e); }).filter(Boolean) as NostrProfile[];
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

/** Fetch the user's follow list (kind 3) and return pubkeys */
export async function fetchFollowList(pubkey: string): Promise<string[]> {
  try {
    const pool = getPool();
    const events = await pool.query([{ kinds: [3], authors: [pubkey], limit: 1 }]);
    if (!events.length) return [];
    return events[0].tags.filter(t => t[0] === 'p' && t[1]).map(t => t[1]);
  } catch { return []; }
}

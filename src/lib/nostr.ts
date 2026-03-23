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

// Well-known NIP-17 DM inbox relays — used as fallback when user has no kind 10050
export const DM_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.utxo.one/inbox',
  'wss://inbox.nostr.wine',
];

export const BLOSSOM_SERVER = 'https://blossom.primal.net/';
export const BLOSSOM_FALLBACKS = [
  'https://cdn.nostrfiles.com/',
  'https://nostr.build/',
  'https://blossom.oxtr.dev/',
];
export const STORY_KIND = 30923;
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

/** Fetch stories from a specific relay URL */
export async function fetchStoriesFromRelay(relayUrl: string): Promise<FlareStory[]> {
  const { NRelay1 } = await import('@nostrify/nostrify');
  const now = unixNow();
  const results: FlareStory[] = [];
  try {
    const relay = new NRelay1(relayUrl);
    const sub = relay.req([{ kinds: [STORY_KIND], since: now - STORY_EXPIRY, limit: 200 }]);
    const timeout = new Promise<void>(res => setTimeout(res, 5000));
    await Promise.race([
      (async () => {
        for await (const msg of sub) {
          if (msg[0] === 'EOSE') break;
          if (msg[0] !== 'EVENT') continue;
          const story = parseStory(msg[2]);
          if (story) results.push(story);
        }
      })(),
      timeout,
    ]);
    relay.close?.();
  } catch { /* relay failed */ }
  return results;
}

/** Fetch stories from multiple relays simultaneously, deduplicated by event ID */
export async function fetchStoriesFromRelays(relayUrls: string[]): Promise<FlareStory[]> {
  if (!relayUrls.length) return [];
  const results = await Promise.allSettled(relayUrls.map(url => fetchStoriesFromRelay(url)));
  const seen = new Set<string>();
  const stories: FlareStory[] = [];
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    for (const s of r.value) {
      if (!seen.has(s.id)) { seen.add(s.id); stories.push(s); }
    }
  }
  return stories.sort((a, b) => b.created_at - a.created_at);
}

/** Fetch stories only from a list of authors (for following feed) */
export async function fetchStoriesFromAuthors(authors: string[]): Promise<FlareStory[]> {
  if (!authors.length) return [];
  const pool = getPool();
  const now = unixNow();
  try {
    // Batch in chunks of 50 to avoid filter size limits
    const chunks: string[][] = [];
    for (let i = 0; i < authors.length; i += 50) chunks.push(authors.slice(i, i + 50));
    const all = await Promise.all(
      chunks.map(chunk => pool.query([{ kinds: [STORY_KIND], authors: chunk, since: now - STORY_EXPIRY, limit: 100 }]).catch(() => []))
    );
    return all.flat().map(parseStory).filter(Boolean) as FlareStory[];
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

// ─── NIP-17 DM relay discovery (kind 10050) ───────────────────────────────
const dmRelayCache = new Map<string, string[]>();

/** Fetch a user's preferred DM inbox relays (kind 10050). Falls back to DEFAULT_RELAYS. */
export async function fetchDMRelays(pubkey: string): Promise<string[]> {
  if (dmRelayCache.has(pubkey)) return dmRelayCache.get(pubkey)!;
  try {
    const pool = getPool();
    const events = await pool.query([{ kinds: [10050], authors: [pubkey], limit: 1 }]);
    if (events.length > 0) {
      const relays = events[0].tags
        .filter(t => t[0] === 'relay' && t[1])
        .map(t => t[1]);
      if (relays.length > 0) {
        dmRelayCache.set(pubkey, relays);
        return relays;
      }
    }
  } catch { /* fall through */ }
  // User has no kind 10050 — use well-known DM relays as fallback
  dmRelayCache.set(pubkey, DM_RELAYS);
  return DM_RELAYS;
}

/** Publish the user's own kind 10050 DM relay list if they don't have one */
export async function publishDMRelayList(
  signer: any,
  relays: string[] = DM_RELAYS,
): Promise<void> {
  try {
    const pool = getPool();
    const event = await signer.signEvent({
      kind: 10050,
      content: '',
      created_at: unixNow(),
      tags: relays.map(r => ['relay', r]),
    });
    await pool.event(event);
    const pubkey = await signer.getPublicKey();
    dmRelayCache.set(pubkey, relays);
  } catch { /* best effort */ }
}

/**
 * NIP-17: Private Direct Messages
 * kind 14 rumor → kind 13 seal (NIP-44) → kind 1059 gift wrap (ephemeral NIP-44)
 */
import { nip44, generateSecretKey, getPublicKey, finalizeEvent, getEventHash } from 'nostr-tools';
import { NRelay1 } from '@nostrify/nostrify';
import type { NostrEvent } from '@nostrify/nostrify';
import type { FlareMessage } from '@/types';
import { unixNow, DM_RELAYS, getPool, fetchDMRelays } from './nostr';

function jitterTime(): number {
  return unixNow() - Math.floor(Math.random() * 172800);
}

/** Send a NIP-17 DM. Also sends a copy to the sender's own inbox so sent messages appear in chat. */
export async function sendDM(
  signer: any,
  recipientPubkey: string,
  content: string,
): Promise<void> {
  const senderPubkey = await signer.getPublicKey();

  // Step 1 — kind 14 rumor (unsigned)
  const rumor = {
    pubkey: senderPubkey,
    kind: 14,
    content,
    created_at: unixNow(),
    tags: [['p', recipientPubkey]],
  };

  // Step 2 — kind 13 seal encrypted to recipient
  let sealContent: string;
  try {
    sealContent = await signer.nip44.encrypt(recipientPubkey, JSON.stringify(rumor));
  } catch {
    throw new Error('Signer does not support NIP-44 encryption. Use a private key or compatible signer.');
  }

  const seal: NostrEvent = await signer.signEvent({
    kind: 13,
    content: sealContent,
    created_at: jitterTime(),
    tags: [],
  });

  // Helper to build a gift wrap for a given recipient pubkey
  const buildWrap = (targetPubkey: string, sealToWrap: NostrEvent) => {
    const ephemeralKey = generateSecretKey();
    const convKey = nip44.v2.utils.getConversationKey(ephemeralKey, targetPubkey);
    const wrapContent = nip44.v2.encrypt(JSON.stringify(sealToWrap), convKey);
    return finalizeEvent(
      { kind: 1059, content: wrapContent, created_at: jitterTime(), tags: [['p', targetPubkey]] },
      ephemeralKey,
    );
  };

  // Step 3a — gift wrap for recipient, publish to their inbox relays
  const recipientWrap = buildWrap(recipientPubkey, seal);
  const recipientRelays = await fetchDMRelays(recipientPubkey).catch(() => DM_RELAYS);
  await Promise.allSettled(recipientRelays.map(async url => {
    try { const r = new NRelay1(url); await r.event(recipientWrap as unknown as NostrEvent); r.close?.(); } catch {}
  }));

  // Step 3b — self-copy: seal encrypted to sender so they can decrypt from their own inbox
  let selfSealContent: string;
  try {
    selfSealContent = await signer.nip44.encrypt(senderPubkey, JSON.stringify(rumor));
  } catch { return; } // best-effort — don't fail the whole send if self-copy fails

  const selfSeal: NostrEvent = await signer.signEvent({
    kind: 13,
    content: selfSealContent,
    created_at: jitterTime(),
    tags: [],
  });

  const selfWrap = buildWrap(senderPubkey, selfSeal);
  const senderRelays = await fetchDMRelays(senderPubkey).catch(() => DM_RELAYS);
  await Promise.allSettled(senderRelays.map(async url => {
    try { const r = new NRelay1(url); await r.event(selfWrap as unknown as NostrEvent); r.close?.(); } catch {}
  }));
}

/** Decrypt a received kind 1059 gift wrap */
export async function decryptDM(
  wrap: NostrEvent,
  signer: any,
): Promise<FlareMessage | null> {
  try {
    const myPubkey = await signer.getPublicKey();

    // Decrypt gift wrap → seal
    let sealJson: string;
    try {
      sealJson = await signer.nip44.decrypt(wrap.pubkey, wrap.content);
    } catch {
      return null; // can't decrypt — not intended for us or unsupported
    }

    const seal: NostrEvent = JSON.parse(sealJson);
    if (seal.kind !== 13) return null;

    // Decrypt seal → rumor
    let rumorJson: string;
    try {
      rumorJson = await signer.nip44.decrypt(seal.pubkey, seal.content);
    } catch {
      return null;
    }

    const rumor = JSON.parse(rumorJson);
    if (rumor.kind !== 14) return null;

    const recipientTag = rumor.tags?.find((t: string[]) => t[0] === 'p');
    const recipientPubkey = recipientTag?.[1] ?? myPubkey;

    // Extract media URL from content if present (story replies include the URL)
    const content: string = rumor.content ?? '';
    const urlMatch = content.match(/https?:\/\/\S+\.(jpe?g|png|gif|webp|avif|mp4|mov|webm)(\?\S*)?/i);
    const storyUrlMatch = content.match(/↩ Replied to your story: (https?:\/\/\S+)/i);
    const mediaUrl = (storyUrlMatch?.[1] || urlMatch?.[0])?.trim();
    const isVideo = mediaUrl ? /\.(mp4|mov|webm)(\?|$)/i.test(mediaUrl) : false;

    // View-once snaps are tagged with ['view-once', 'true'] on the rumor
    const viewOnce = rumor.tags?.some((t: string[]) => t[0] === 'view-once') ?? false;

    // Display content — strip the story URL line from the bubble text
    const displayContent = storyUrlMatch
      ? content.replace(/\n\n↩ Replied to your story: https?:\/\/\S+/i, '').trim()
      : content;

    return {
      id: wrap.id,
      senderPubkey: seal.pubkey,
      recipientPubkey,
      content: displayContent,
      created_at: rumor.created_at,
      ...(mediaUrl ? { mediaUrl, mediaType: isVideo ? 'video' : 'image' } : {}),
      ...(viewOnce ? { viewOnce: true } : {}),
    };
  } catch {
    return null;
  }
}

/** Send a snap DM — a media message with optional view-once */
export async function sendSnap(
  signer: any,
  recipientPubkey: string,
  mediaUrl: string,
  mediaType: 'image' | 'video',
  viewOnce: boolean,
  caption?: string,
): Promise<void> {
  const senderPubkey = await signer.getPublicKey();
  const content = caption ? `${caption}\n${mediaUrl}` : mediaUrl;

  const rumor = {
    pubkey: senderPubkey,
    kind: 14,
    content,
    created_at: unixNow(),
    tags: [
      ['p', recipientPubkey],
      ['m', mediaType === 'video' ? 'video/mp4' : 'image/jpeg'],
      ...(viewOnce ? [['view-once', 'true']] : []),
    ],
  };

  const buildWrap = (targetPubkey: string, sealToWrap: NostrEvent) => {
    const ek = generateSecretKey();
    return finalizeEvent(
      { kind: 1059, content: nip44.v2.encrypt(JSON.stringify(sealToWrap), nip44.v2.utils.getConversationKey(ek, targetPubkey)), created_at: jitterTime(), tags: [['p', targetPubkey]] },
      ek,
    );
  };

  // Recipient copy
  const sealContent = await signer.nip44.encrypt(recipientPubkey, JSON.stringify(rumor));
  const seal = await signer.signEvent({ kind: 13, content: sealContent, created_at: jitterTime(), tags: [] });
  const recipientRelays = await fetchDMRelays(recipientPubkey).catch(() => DM_RELAYS);
  await Promise.allSettled(recipientRelays.map(async url => {
    try { const r = new NRelay1(url); await r.event(buildWrap(recipientPubkey, seal) as unknown as NostrEvent); r.close?.(); } catch {}
  }));

  // Self-copy so sent snaps appear in your own inbox
  try {
    const selfSealContent = await signer.nip44.encrypt(senderPubkey, JSON.stringify(rumor));
    const selfSeal = await signer.signEvent({ kind: 13, content: selfSealContent, created_at: jitterTime(), tags: [] });
    const senderRelays = await fetchDMRelays(senderPubkey).catch(() => DM_RELAYS);
    await Promise.allSettled(senderRelays.map(async url => {
      try { const r = new NRelay1(url); await r.event(buildWrap(senderPubkey, selfSeal) as unknown as NostrEvent); r.close?.(); } catch {}
    }));
  } catch { /* best effort */ }
}

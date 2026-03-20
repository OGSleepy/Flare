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

/** Send a NIP-17 DM. Works with any signer that exposes nip44.encrypt or signEvent */
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

  // Step 2 — kind 13 seal: NIP-44 encrypt the rumor, signed by sender
  // Try nip44 interface first (applesauce signers), fall back to direct key signing
  let sealContent: string;
  try {
    sealContent = await signer.nip44.encrypt(recipientPubkey, JSON.stringify(rumor));
  } catch {
    throw new Error('Signer does not support NIP-44 encryption. Use a private key or compatible signer.');
  }

  const sealTemplate = {
    kind: 13,
    content: sealContent,
    created_at: jitterTime(),
    tags: [] as string[][],
  };

  let seal: NostrEvent;
  try {
    seal = await signer.signEvent(sealTemplate);
  } catch {
    throw new Error('Failed to sign seal event');
  }

  // Step 3 — kind 1059 gift wrap: ephemeral key NIP-44 encrypts the seal
  const ephemeralKey = generateSecretKey();
  const ephemeralPub = getPublicKey(ephemeralKey);
  const convKey = nip44.v2.utils.getConversationKey(ephemeralKey, recipientPubkey);
  const wrapContent = nip44.v2.encrypt(JSON.stringify(seal), convKey);

  const wrapTemplate = {
    kind: 1059,
    pubkey: ephemeralPub,
    content: wrapContent,
    created_at: jitterTime(),
    tags: [['p', recipientPubkey]],
  };

  const wrap = finalizeEvent(
    { ...wrapTemplate, created_at: wrapTemplate.created_at },
    ephemeralKey,
  );

  // Per NIP-17: publish to recipient's kind 10050 DM relays
  const recipientRelays = await fetchDMRelays(recipientPubkey).catch(() => DM_RELAYS);

  // Publish to each relay individually for reliability
  await Promise.allSettled(
    recipientRelays.map(async url => {
      try {
        const relay = new NRelay1(url);
        await relay.event(wrap as unknown as NostrEvent);
        relay.close?.();
      } catch { /* relay may reject, keep going */ }
    })
  );
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

  let sealContent: string;
  try {
    sealContent = await signer.nip44.encrypt(recipientPubkey, JSON.stringify(rumor));
  } catch {
    throw new Error('Signer does not support NIP-44 encryption.');
  }

  const seal = await signer.signEvent({
    kind: 13,
    content: sealContent,
    created_at: jitterTime(),
    tags: [],
  });

  const ephemeralKey = generateSecretKey();
  const ephemeralPub = getPublicKey(ephemeralKey);
  const convKey = nip44.v2.utils.getConversationKey(ephemeralKey, recipientPubkey);
  const wrapContent = nip44.v2.encrypt(JSON.stringify(seal), convKey);

  const wrap = finalizeEvent(
    { kind: 1059, content: wrapContent, created_at: jitterTime(), tags: [['p', recipientPubkey]] },
    ephemeralKey,
  );

  const recipientRelays = await fetchDMRelays(recipientPubkey).catch(() => DM_RELAYS);
  await Promise.allSettled(
    recipientRelays.map(async url => {
      try {
        const relay = new NRelay1(url);
        await relay.event(wrap as unknown as NostrEvent);
        relay.close?.();
      } catch { }
    })
  );
}

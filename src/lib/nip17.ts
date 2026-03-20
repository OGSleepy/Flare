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

    return {
      id: wrap.id,
      senderPubkey: seal.pubkey,
      recipientPubkey,
      content: rumor.content,
      created_at: rumor.created_at,
    };
  } catch {
    return null;
  }
}

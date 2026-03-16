/**
 * NIP-17: Private Direct Messages
 *
 * 3-layer encryption:
 *   kind 14 rumor  →  kind 13 seal (NIP-44, sender signs)
 *               →  kind 1059 gift wrap (NIP-44, ephemeral key signs)
 *
 * Published to recipient's DM relays.
 */

import { nip44, generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools';
import type { NostrEvent } from '@nostrify/nostrify';
import type { DMRumor, FlareMessage } from '@/types';
import { unixNow, DM_RELAYS, getPool } from './nostr';

// Jitter created_at slightly to hide metadata
function jitterTime(): number {
  return unixNow() - Math.floor(Math.random() * 172800); // up to 2d in past
}

/** Send a NIP-17 DM from signer → recipientPubkey */
export async function sendDM(
  signer: { getPublicKey(): Promise<string>; nip44: { encrypt(pk: string, pt: string): Promise<string> } },
  recipientPubkey: string,
  content: string,
): Promise<void> {
  const senderPubkey = await signer.getPublicKey();

  // Step 1: rumor (kind 14, unsigned)
  const rumor: DMRumor = {
    pubkey: senderPubkey,
    kind: 14,
    content,
    created_at: unixNow(),
    tags: [['p', recipientPubkey]],
  };

  // Step 2: seal (kind 13) — NIP-44 encrypt rumor, signed by sender
  const sealContent = await signer.nip44.encrypt(recipientPubkey, JSON.stringify(rumor));
  const sealTemplate = {
    kind: 13,
    content: sealContent,
    created_at: jitterTime(),
    tags: [] as string[][],
  };
  // We need to sign the seal. Since we only have the high-level signer interface,
  // we use signEvent from the signer. The signer signs with its own key.
  const seal = await (signer as any).signEvent(sealTemplate);

  // Step 3: gift wrap (kind 1059) — ephemeral key, NIP-44 encrypt seal
  const ephemeralKey = generateSecretKey();
  const ephemeralPub = getPublicKey(ephemeralKey);
  const convKey = nip44.v2.utils.getConversationKey(ephemeralKey, recipientPubkey);
  const wrapContent = nip44.v2.encrypt(JSON.stringify(seal), convKey);

  const wrap = finalizeEvent(
    {
      kind: 1059,
      content: wrapContent,
      created_at: jitterTime(),
      tags: [['p', recipientPubkey]],
    },
    ephemeralKey,
  );

  // Publish to DM relays
  const pool = getPool();
  await pool.event(wrap as NostrEvent);
}

/** Decrypt a received kind 1059 gift wrap using the recipient's signer */
export async function decryptDM(
  wrap: NostrEvent,
  signer: { getPublicKey(): Promise<string>; nip44: { decrypt(pk: string, ct: string): Promise<string> } },
): Promise<FlareMessage | null> {
  try {
    const myPubkey = await signer.getPublicKey();

    // Decrypt gift wrap → seal (kind 13)
    const sealJson = await signer.nip44.decrypt(wrap.pubkey, wrap.content);
    const seal: NostrEvent = JSON.parse(sealJson);
    if (seal.kind !== 13) return null;

    // Decrypt seal → rumor (kind 14)
    const rumorJson = await signer.nip44.decrypt(seal.pubkey, seal.content);
    const rumor: DMRumor = JSON.parse(rumorJson);
    if (rumor.kind !== 14) return null;

    const recipientTag = rumor.tags.find(t => t[0] === 'p');
    const recipientPubkey = recipientTag?.[1] ?? myPubkey;

    return {
      id: wrap.id,
      senderPubkey: seal.pubkey,
      recipientPubkey,
      content: rumor.content,
      created_at: rumor.created_at,
    };
  } catch { return null; }
}

/** Subscribe to incoming DMs for a pubkey */
export function subscribeDMs(
  pubkey: string,
  onMessage: (wrap: NostrEvent) => void,
): () => void {
  const pool = getPool();
  const sub = (pool as any).req(
    [{ kinds: [1059], '#p': [pubkey], limit: 100 }],
    DM_RELAYS,
  );

  const subscription = (sub as any).subscribe({
    next: (msg: any) => {
      if (msg?.[0] === 'EVENT') onMessage(msg[2]);
    },
  });

  return () => subscription?.unsubscribe?.();
}

import { BLOSSOM_SERVER, BLOSSOM_FALLBACKS } from './nostr';
import type { BlossomUpload } from '@/types';

async function tryUpload(
  serverBase: string,
  file: File,
  sha256: string,
  signer: { signEvent(e: any): Promise<any> },
): Promise<BlossomUpload> {
  const authEvent = await signer.signEvent({
    kind: 24242,
    content: 'Upload file',
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['t', 'upload'],
      ['x', sha256],
      ['expiration', String(Math.floor(Date.now() / 1000) + 3600)],
    ],
  });

  const res = await fetch(`${serverBase}upload`, {
    method: 'PUT',
    headers: {
      Authorization: `Nostr ${btoa(JSON.stringify(authEvent))}`,
      'Content-Type': file.type || 'application/octet-stream',
    },
    body: file,
  });

  if (!res.ok) {
    const reason = res.headers.get('X-Reason') || res.statusText || `HTTP ${res.status}`;
    throw new Error(`Upload failed (${serverBase}): ${reason}`);
  }

  const data = await res.json();
  if (!data.url) throw new Error(`Upload failed: no URL from ${serverBase}`);

  return { url: data.url, sha256, size: file.size, type: file.type };
}

export async function uploadFile(
  file: File,
  signer: { signEvent(e: any): Promise<any> },
): Promise<BlossomUpload> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const sha256 = Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  // Try primary server first, then fallbacks
  const servers = [BLOSSOM_SERVER, ...BLOSSOM_FALLBACKS];
  let lastError: Error = new Error('All upload servers failed');

  for (const server of servers) {
    try {
      return await tryUpload(server, file, sha256, signer);
    } catch (e: any) {
      lastError = e;
      // Try next server
    }
  }

  throw lastError;
}

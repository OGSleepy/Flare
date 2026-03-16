import { BLOSSOM_SERVER } from './nostr';
import type { BlossomUpload } from '@/types';

export async function uploadFile(
  file: File,
  signer: { signEvent(e: any): Promise<any> },
): Promise<BlossomUpload> {
  // Compute SHA-256 (required by BUD-02)
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const sha256 = Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

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

  const res = await fetch(`${BLOSSOM_SERVER}upload`, {
    method: 'PUT',
    headers: {
      Authorization: `Nostr ${btoa(JSON.stringify(authEvent))}`,
      'Content-Type': file.type,
    },
    body: file,
  });

  if (!res.ok) {
    const reason = res.headers.get('X-Reason') || res.statusText;
    throw new Error(`Upload failed: ${reason}`);
  }

  const data = await res.json();
  if (!data.url) throw new Error('Upload failed: no URL returned');

  return { url: data.url, sha256, size: file.size, type: file.type };
}

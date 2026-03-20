export interface NostrProfile {
  pubkey: string;
  name?: string;
  display_name?: string;
  picture?: string;
  about?: string;
  nip05?: string;
  banner?: string;
  lud16?: string;
  website?: string;
}

// Kind 30315 — ephemeral media story (24h expiry)
export interface FlareStory {
  id: string;
  pubkey: string;
  mediaUrl: string;
  mediaType: 'image' | 'video';
  caption?: string;
  created_at: number;
  expires_at: number;
  tags: string[][];
}

// NIP-17 DM rumor (kind 14, unsigned)
export interface DMRumor {
  pubkey: string;
  kind: 14;
  content: string;
  created_at: number;
  tags: string[][];
  id?: string;
}

// Decrypted DM ready to display
export interface FlareMessage {
  id: string;
  senderPubkey: string;
  recipientPubkey: string;
  content: string;
  created_at: number;
  pending?: boolean;
  // Rich content
  mediaUrl?: string;
  mediaType?: 'image' | 'video';
  storyCaption?: string;
  // Snap DM
  viewOnce?: boolean;   // true = disappears after opening
  opened?: boolean;     // true = recipient has already viewed it
}

export interface Conversation {
  pubkey: string;
  lastMessage: string;
  lastAt: number;
  unread: boolean;
}

export type Screen = 'chat' | 'stories' | 'camera' | 'explore' | 'profile';

// Blossom upload response
export interface BlossomUpload {
  url: string;
  sha256: string;
  size: number;
  type: string;
}

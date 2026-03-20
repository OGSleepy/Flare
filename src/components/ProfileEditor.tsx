import React, { useState } from 'react';
import { X, Camera, Loader2, Check } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { getPool } from '@/lib/nostr';
import { uploadFile } from '@/lib/upload';
import type { NostrSigner } from '@nostrify/nostrify';
import type { NostrProfile } from '@/types';
import { toast } from 'sonner';

interface ProfileEditorProps {
  onClose: () => void;
  signer: NostrSigner | null;
}

export const ProfileEditor: React.FC<ProfileEditorProps> = ({ onClose, signer }) => {
  const profile = useAppStore(s => s.profile);
  const setProfile = useAppStore(s => s.setProfile);
  const setProfileCache = useAppStore(s => s.setProfileCache);
  const pubkey = useAppStore(s => s.pubkey);

  const [name, setName] = useState(profile?.display_name || profile?.name || '');
  const [about, setAbout] = useState(profile?.about || '');
  const [website, setWebsite] = useState(profile?.website || '');
  const [picture, setPicture] = useState(profile?.picture || '');
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !signer) return;
    setUploadingAvatar(true);
    try {
      const upload = await uploadFile(file, signer as any);
      setPicture(upload.url);
      toast.success('Photo uploaded');
    } catch (err: any) {
      toast.error(err.message ?? 'Upload failed');
    } finally {
      setUploadingAvatar(false);
      e.target.value = '';
    }
  };

  const handleSave = async () => {
    if (!signer || !pubkey) { toast.error('Not signed in'); return; }
    setSaving(true);
    try {
      const metadata: Record<string, string> = {};
      if (name.trim()) { metadata.name = name.trim(); metadata.display_name = name.trim(); }
      if (about.trim()) metadata.about = about.trim();
      if (website.trim()) metadata.website = website.trim();
      if (picture.trim()) metadata.picture = picture.trim();

      const pool = getPool();
      const event = await (signer as any).signEvent({
        kind: 0,
        content: JSON.stringify(metadata),
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
      });
      await pool.event(event);

      const updated: NostrProfile = { pubkey, ...metadata };
      setProfile(updated);
      setProfileCache(updated);
      toast.success('Profile updated ✓');
      onClose();
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-[var(--bg)]">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] safe-top pt-14">
        <button onClick={onClose} className="text-gray-400 hover:text-white">
          <X size={22} />
        </button>
        <h2 className="font-display font-bold text-white text-lg">Edit Profile</h2>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 text-flare-500 font-semibold text-sm disabled:opacity-40"
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      <div className="flex-1 scrollable px-5 py-6 space-y-6">
        {/* Avatar */}
        <div className="flex flex-col items-center gap-3">
          <div className="relative">
            <div className="w-24 h-24 rounded-full overflow-hidden bg-surface-raised border-2 border-flare-500/30">
              {picture
                ? <img src={picture} alt="avatar" className="w-full h-full object-cover" />
                : <div className="w-full h-full flex items-center justify-center text-flare-500 text-4xl font-bold font-display">
                    {name[0]?.toUpperCase() || '?'}
                  </div>
              }
            </div>
            <label className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-flare-500 flex items-center justify-center cursor-pointer border-2 border-[var(--bg)] hover:bg-flare-600 transition-colors">
              {uploadingAvatar
                ? <Loader2 size={14} className="text-white animate-spin" />
                : <Camera size={14} className="text-white" />
              }
              <input type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} disabled={uploadingAvatar} />
            </label>
          </div>
          <p className="text-gray-500 text-xs">Tap camera to change photo</p>
        </div>

        {/* Fields */}
        <div className="space-y-4">
          <div>
            <label className="text-gray-400 text-xs font-semibold uppercase tracking-wider block mb-1.5">Display Name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Your name"
              maxLength={50}
              className="w-full bg-surface-raised border border-[var(--border)] rounded-2xl px-4 py-3 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-flare-500/50"
            />
          </div>

          <div>
            <label className="text-gray-400 text-xs font-semibold uppercase tracking-wider block mb-1.5">Bio</label>
            <textarea
              value={about}
              onChange={e => setAbout(e.target.value)}
              placeholder="Tell the world about yourself…"
              maxLength={300}
              rows={3}
              className="w-full bg-surface-raised border border-[var(--border)] rounded-2xl px-4 py-3 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-flare-500/50 resize-none"
            />
            <p className="text-gray-700 text-xs text-right mt-1">{about.length}/300</p>
          </div>

          <div>
            <label className="text-gray-400 text-xs font-semibold uppercase tracking-wider block mb-1.5">Website</label>
            <input
              value={website}
              onChange={e => setWebsite(e.target.value)}
              placeholder="https://yoursite.com"
              type="url"
              className="w-full bg-surface-raised border border-[var(--border)] rounded-2xl px-4 py-3 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-flare-500/50"
            />
          </div>

          <div>
            <label className="text-gray-400 text-xs font-semibold uppercase tracking-wider block mb-1.5">Profile Picture URL</label>
            <input
              value={picture}
              onChange={e => setPicture(e.target.value)}
              placeholder="https://… (or upload above)"
              className="w-full bg-surface-raised border border-[var(--border)] rounded-2xl px-4 py-3 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-flare-500/50 font-mono text-xs"
            />
          </div>
        </div>

        <div className="bg-surface rounded-2xl border border-[var(--border)] p-4">
          <p className="text-gray-500 text-xs leading-relaxed">
            Your profile is published as a Nostr kind 0 event to your write relays. It's public and visible to anyone on the network.
          </p>
        </div>
      </div>
    </div>
  );
};

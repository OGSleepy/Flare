import React, { useState, useEffect } from 'react';
import { Flame, Chrome, Key, Wifi, Sparkles, Copy, Check, ShieldAlert, Info, Eye, EyeOff, Smartphone } from 'lucide-react';
import { Accounts } from 'applesauce-accounts';
import { ExtensionSigner, PrivateKeySigner, NostrConnectSigner, AmberClipboardSigner } from 'applesauce-signers';
import { generateSecretKey } from 'nostr-tools';
import * as nip19 from 'nostr-tools/nip19';
import { accountManager } from '@/lib/accountManager';
import { useAppStore } from '@/store/appStore';

declare global {
  interface Window {
    nostr?: { getPublicKey(): Promise<string>; signEvent(e: any): Promise<any> };
  }
}
import { fetchProfiles, fetchRelayList, fetchFollowList } from '@/lib/nostr';
import type { NostrSigner } from '@nostrify/nostrify';

// Detect Android — Amber is Android-only
const isAndroid = /Android/i.test(navigator.userAgent);

type Tab = 'new' | 'extension' | 'nsec' | 'bunker' | 'amber';

interface LoginScreenProps {
  onLogin: (signer: NostrSigner) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLogin }) => {
  const [tab, setTab] = useState<Tab>('new');
  const [nsec, setNsec] = useState('');
  const [bunkerUri, setBunkerUri] = useState('');
  const [showNsec, setShowNsec] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Create account step 2
  const [createdNsec, setCreatedNsec] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  // Amber — waiting for clipboard paste after redirect
  const [amberWaiting, setAmberWaiting] = useState(false);
  const [amberPubkey, setAmberPubkey] = useState('');

  const setAuth = useAppStore(s => s.setAuth);
  const setProfile = useAppStore(s => s.setProfile);
  const setProfileCache = useAppStore(s => s.setProfileCache);
  const setFollowList = useAppStore(s => s.setFollowList);

  // Check for Amber callback on mount (pubkey returned in URL params)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const amberResult = params.get('event') || params.get('result');
    if (amberResult) {
      // Strip the param from URL without reload
      window.history.replaceState({}, '', window.location.pathname);
      // Try to extract pubkey from Amber result
      try {
        const hex = amberResult.length === 64 ? amberResult : JSON.parse(amberResult);
        if (typeof hex === 'string' && /^[0-9a-f]{64}$/i.test(hex)) {
          setAmberPubkey(hex);
          setTab('amber');
        }
      } catch { /* not a valid result */ }
    }
  }, []);

  const postLogin = async (signer: NostrSigner) => {
    const pubkey = await signer.getPublicKey();
    setAuth(pubkey);
    onLogin(signer);
    const [profiles] = await Promise.all([
      fetchProfiles([pubkey]),
      fetchRelayList(pubkey).catch(() => {}),
    ]);
    if (profiles[0]) { setProfile(profiles[0]); setProfileCache(profiles[0]); }
    fetchFollowList(pubkey).then(list => {
      setFollowList(list);
      if (list.length > 0) fetchProfiles(list.slice(0, 50)).then(profs => profs.forEach(p => setProfileCache(p))).catch(() => {});
    }).catch(() => {});
  };

  const wrap = async (fn: () => Promise<void>) => {
    setLoading(true); setError('');
    try { await fn(); }
    catch (e: any) { setError(e.message ?? 'Something went wrong'); }
    finally { setLoading(false); }
  };

  const handleCreate = () => wrap(async () => {
    const key = generateSecretKey();
    const signer = new PrivateKeySigner(key);
    const pubkey = await signer.getPublicKey();
    const nsecStr = nip19.nsecEncode(key);
    const account = new Accounts.PrivateKeyAccount(pubkey, signer);
    accountManager.addAccount(account);
    accountManager.setActive(account);
    setCreatedNsec(nsecStr);
    await postLogin(signer as unknown as NostrSigner);
  });

  const handleExtension = () => wrap(async () => {
    if (!window.nostr) throw new Error('No NIP-07 extension found. Install Alby or nos2x.');
    const signer = new ExtensionSigner();
    const pubkey = await signer.getPublicKey();
    const account = new Accounts.ExtensionAccount(pubkey, signer);
    accountManager.addAccount(account);
    accountManager.setActive(account);
    await postLogin(signer as unknown as NostrSigner);
  });

  const handleNsec = () => wrap(async () => {
    const { type, data } = nip19.decode(nsec.trim());
    if (type !== 'nsec') throw new Error('Invalid nsec key');
    const signer = new PrivateKeySigner(data as Uint8Array);
    const pubkey = await signer.getPublicKey();
    const account = new Accounts.PrivateKeyAccount(pubkey, signer);
    accountManager.addAccount(account);
    accountManager.setActive(account);
    await postLogin(signer as unknown as NostrSigner);
  });

  const handleBunker = () => wrap(async () => {
    const signer = await NostrConnectSigner.fromBunkerURI(bunkerUri.trim());
    const pubkey = await signer.getPublicKey();
    const account = new Accounts.NostrConnectAccount(pubkey, signer);
    accountManager.addAccount(account);
    accountManager.setActive(account);
    await postLogin(signer as unknown as NostrSigner);
  });

  const handleAmberConnect = () => wrap(async () => {
    const signer = new AmberClipboardSigner();
    // This opens the nostrsigner: intent, Amber handles signing via clipboard
    await signer.getPublicKey();
    const pubkey = await signer.getPublicKey();
    // Store as a NostrConnect-compatible account since Amber acts as external signer
    const account = new Accounts.NostrConnectAccount(pubkey, signer as any);
    accountManager.addAccount(account);
    accountManager.setActive(account);
    await postLogin(signer as unknown as NostrSigner);
  });

  const tabs: { id: Tab; label: string; androidOnly?: boolean }[] = [
    { id: 'new', label: 'New' },
    { id: 'extension', label: 'Extension' },
    { id: 'nsec', label: 'Key' },
    { id: 'bunker', label: 'Bunker' },
    ...(isAndroid ? [{ id: 'amber' as Tab, label: 'Amber', androidOnly: true }] : []),
  ];

  return (
    <div className="flex flex-col items-center justify-center min-h-full px-6 py-10 safe-top">
      {/* Logo */}
      <div className="mb-10 text-center animate-fade-up">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl mb-4 flare-glow"
          style={{ background: 'linear-gradient(135deg, #f97316, #fb923c)' }}>
          <Flame size={38} className="text-white" />
        </div>
        <h1 className="font-display text-4xl font-extrabold text-white tracking-tight">flare</h1>
        <p className="text-gray-500 text-sm mt-1">ephemeral. encrypted. yours.</p>
      </div>

      <div className="w-full max-w-sm animate-fade-up" style={{ animationDelay: '0.1s' }}>
        {/* Tab bar */}
        <div className="flex gap-1 bg-surface rounded-xl p-1 mb-6 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-shrink-0 flex-1 py-2 rounded-lg text-xs font-semibold transition-all ${
                tab === t.id ? 'bg-surface-overlay text-white' : 'text-gray-600 hover:text-gray-400'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* New account */}
        {tab === 'new' && !createdNsec && (
          <div className="space-y-4">
            <div className="text-center space-y-2">
              <Sparkles size={36} className="mx-auto text-flare-500" />
              <p className="text-white font-semibold">New to Nostr?</p>
              <p className="text-gray-500 text-xs leading-relaxed">
                Generate a keypair instantly. No email. No phone number. You own your identity forever.
              </p>
            </div>
            <button
              onClick={handleCreate}
              disabled={loading}
              className="w-full py-3.5 rounded-2xl font-semibold text-white transition-all active:scale-95 flare-glow"
              style={{ background: 'linear-gradient(135deg, #f97316, #fb923c)' }}
            >
              {loading ? 'Generating keypair…' : 'Create My Account'}
            </button>
          </div>
        )}

        {/* nsec backup step */}
        {tab === 'new' && createdNsec && (
          <div className="space-y-4 animate-scale-in">
            <div className="flex items-center gap-2 text-yellow-400">
              <ShieldAlert size={18} />
              <p className="font-semibold text-sm">Back up your private key</p>
            </div>
            <p className="text-gray-400 text-xs leading-relaxed">
              This is your <span className="text-white font-mono">nsec</span> — the only way to access your account. There is no reset. Save it now.
            </p>
            <div className="relative bg-surface-overlay rounded-xl p-4 border border-[var(--border)]">
              <p className="font-mono text-xs text-flare-400 break-all pr-8 select-all">{createdNsec}</p>
              <button
                onClick={() => { navigator.clipboard.writeText(createdNsec); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                className="absolute top-3 right-3 text-gray-500 hover:text-white transition-colors"
              >
                {copied ? <Check size={16} className="text-green-400" /> : <Copy size={16} />}
              </button>
            </div>
            <label className="flex items-start gap-3 cursor-pointer" onClick={() => setConfirmed(c => !c)}>
              <div className={`mt-0.5 w-4 h-4 flex-shrink-0 rounded border transition-all flex items-center justify-center ${confirmed ? 'bg-flare-500 border-flare-500' : 'border-white/30'}`}>
                {confirmed && <Check size={10} className="text-white" />}
              </div>
              <span className="text-xs text-gray-400">I've saved my nsec. I understand this can't be recovered.</span>
            </label>
            <div className="flex items-start gap-2 bg-surface-overlay rounded-xl p-3 border border-[var(--border)]">
              <Info size={14} className="text-flare-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-gray-500">You're already logged in — this just ensures you have your key backed up.</p>
            </div>
            <button
              disabled={!confirmed}
              className="w-full py-3.5 rounded-2xl font-semibold text-white disabled:opacity-30 transition-all active:scale-95"
              style={{ background: confirmed ? 'linear-gradient(135deg, #f97316, #fb923c)' : '#333' }}
            >
              I've saved it — let's go 🔥
            </button>
          </div>
        )}

        {/* Extension */}
        {tab === 'extension' && (
          <div className="space-y-4">
            <div className="text-center space-y-2">
              <Chrome size={36} className="mx-auto text-gray-400" />
              <p className="text-white font-semibold">Browser Extension</p>
              <p className="text-gray-500 text-xs">Use Alby, nos2x, or any NIP-07 extension. Your key never leaves your device.</p>
            </div>
            <button onClick={handleExtension} disabled={loading}
              className="w-full py-3.5 rounded-2xl font-semibold text-white bg-surface-overlay border border-[var(--border)] hover:border-flare-500/40 transition-all active:scale-95">
              {loading ? 'Connecting…' : 'Sign in with Extension'}
            </button>
          </div>
        )}

        {/* nsec */}
        {tab === 'nsec' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-gray-400">
              <Key size={18} />
              <span className="text-sm">Enter your private key</span>
            </div>
            <div className="relative">
              <input
                type={showNsec ? 'text' : 'password'}
                placeholder="nsec1…"
                value={nsec}
                onChange={e => setNsec(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && nsec && handleNsec()}
                className="w-full bg-surface-overlay border border-[var(--border)] rounded-2xl px-4 py-3.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-flare-500/50 pr-12"
              />
              <button onClick={() => setShowNsec(v => !v)} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500">
                {showNsec ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <button onClick={handleNsec} disabled={loading || !nsec.trim()}
              className="w-full py-3.5 rounded-2xl font-semibold text-white bg-surface-overlay border border-[var(--border)] disabled:opacity-30 hover:border-flare-500/40 transition-all active:scale-95">
              {loading ? 'Unlocking…' : 'Sign in'}
            </button>
            <p className="text-xs text-yellow-600 text-center">Only use on trusted devices</p>
          </div>
        )}

        {/* Bunker */}
        {tab === 'bunker' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-gray-400">
              <Wifi size={18} />
              <span className="text-sm">Remote signer (NIP-46)</span>
            </div>
            <p className="text-gray-500 text-xs">Paste a bunker:// URI from Amber, nsecbunker, or nsec.app.</p>
            <input
              placeholder="bunker://pubkey?relay=wss://…"
              value={bunkerUri}
              onChange={e => setBunkerUri(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && bunkerUri && handleBunker()}
              className="w-full bg-surface-overlay border border-[var(--border)] rounded-2xl px-4 py-3.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-flare-500/50"
            />
            <button onClick={handleBunker} disabled={loading || !bunkerUri.trim()}
              className="w-full py-3.5 rounded-2xl font-semibold text-white bg-surface-overlay border border-[var(--border)] disabled:opacity-30 hover:border-flare-500/40 transition-all active:scale-95">
              {loading ? 'Connecting to signer…' : 'Connect Bunker'}
            </button>
          </div>
        )}

        {/* Amber — Android only */}
        {tab === 'amber' && (
          <div className="space-y-4">
            <div className="text-center space-y-2">
              <div className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center"
                style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)' }}>
                <Smartphone size={28} className="text-white" />
              </div>
              <p className="text-white font-semibold">Sign in with Amber</p>
              <p className="text-gray-500 text-xs leading-relaxed">
                Keep your nsec safe in Amber. Flare will ask Amber to sign events — your key never leaves the signer app.
              </p>
            </div>

            <div className="bg-surface-overlay rounded-2xl p-4 border border-[var(--border)] space-y-2">
              <p className="text-white text-xs font-semibold">Requirements</p>
              <p className="text-gray-500 text-xs">Amber must be installed on this device.</p>
              <a href="https://github.com/greenart7c3/Amber/releases" target="_blank" rel="noopener noreferrer"
                className="text-flare-500 text-xs underline block">
                Download Amber →
              </a>
            </div>

            <button
              onClick={handleAmberConnect}
              disabled={loading}
              className="w-full py-3.5 rounded-2xl font-semibold text-white transition-all active:scale-95 flare-glow"
              style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)' }}
            >
              {loading ? 'Opening Amber…' : 'Connect Amber'}
            </button>

            <p className="text-xs text-gray-600 text-center">
              Uses NIP-55 (Android Signer Application)
            </p>
          </div>
        )}

        {error && (
          <div className="mt-4 bg-red-900/30 border border-red-500/30 rounded-xl px-4 py-3">
            <p className="text-red-400 text-xs">{error}</p>
          </div>
        )}
      </div>
    </div>
  );
};

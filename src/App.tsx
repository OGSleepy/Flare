import React, { useState, useEffect } from 'react';
import { Toaster } from 'sonner';
import { useAppStore } from '@/store/appStore';
import { accountManager, initAccountManager } from '@/lib/accountManager';
import { fetchProfiles } from '@/lib/nostr';
import { LoginScreen } from '@/screens/LoginScreen';
import { CameraScreen } from '@/screens/CameraScreen';
import { StoriesScreen } from '@/screens/StoriesScreen';
import { ChatScreen } from '@/screens/ChatScreen';
import { ExploreScreen } from '@/screens/ExploreScreen';
import { ProfileScreen } from '@/screens/ProfileScreen';
import { BottomNav } from '@/components/BottomNav';
import type { NostrSigner } from '@nostrify/nostrify';

export default function App() {
  const { isAuthenticated, screen, pubkey, setAuth, setProfile, setProfileCache } = useAppStore(s => ({
    isAuthenticated: s.isAuthenticated,
    screen: s.screen,
    pubkey: s.pubkey,
    setAuth: s.setAuth,
    setProfile: s.setProfile,
    setProfileCache: s.setProfileCache,
  }));

  const [signer, setSigner] = useState<NostrSigner | null>(null);
  const [hydrating, setHydrating] = useState(true);

  // Init AccountManager and restore session on mount
  useEffect(() => {
    initAccountManager().then(async () => {
      const active = accountManager.active;
      if (active) {
        const s = active.signer as unknown as NostrSigner;
        setSigner(s);
        const pk = await s.getPublicKey();
        setAuth(pk);
        const profiles = await fetchProfiles([pk]);
        if (profiles[0]) { setProfile(profiles[0]); setProfileCache(profiles[0]); }
      }
    }).finally(() => setHydrating(false));

    // Keep signer in sync with active account changes
    const sub = accountManager.active$.subscribe(account => {
      if (account) setSigner(account.signer as unknown as NostrSigner);
      else setSigner(null);
    });

    return () => sub.unsubscribe();
  }, []);

  const handleLogin = (s: NostrSigner) => setSigner(s);

  if (hydrating) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-12 h-12 rounded-2xl flare-glow flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg, #f97316, #fb923c)', animation: 'pulse 1.5s ease-in-out infinite' }}>
          <span className="text-white text-xl">🔥</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <>
        <LoginScreen onLogin={handleLogin} />
        <Toaster position="top-center" theme="dark" />
      </>
    );
  }

  return (
    <div className="flex flex-col h-full relative">
      <main className="flex-1 overflow-hidden">
        {screen === 'camera'  && <CameraScreen signer={signer} />}
        {screen === 'stories' && <StoriesScreen signer={signer} />}
        {screen === 'chat'    && <ChatScreen signer={signer} />}
        {screen === 'explore' && <ExploreScreen />}
        {screen === 'profile' && <ProfileScreen />}
      </main>

      <BottomNav />
      <Toaster position="top-center" theme="dark" />
    </div>
  );
}

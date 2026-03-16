import React, { useState, useEffect, Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
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
import { Flame } from 'lucide-react';
import type { NostrSigner } from '@nostrify/nostrify';

// ── Error boundary so crashes show a message instead of a black screen ──────
class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null };
  static getDerivedStateFromError(e: Error) { return { error: e.message }; }
  componentDidCatch(e: Error, info: ErrorInfo) { console.error('Flare crash:', e, info); }
  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-4 px-8 text-center">
          <Flame size={40} className="text-flare-500" />
          <p className="text-white font-semibold">Something went wrong</p>
          <p className="text-gray-500 text-xs font-mono break-all">{this.state.error}</p>
          <button
            onClick={() => { localStorage.clear(); window.location.reload(); }}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white"
            style={{ background: 'linear-gradient(135deg,#f97316,#fb923c)' }}
          >
            Clear data & reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Splash screen ────────────────────────────────────────────────────────────
const Splash = () => (
  <div className="flex items-center justify-center h-full">
    <div
      className="w-16 h-16 rounded-3xl flex items-center justify-center"
      style={{ background: 'linear-gradient(135deg,#f97316,#fb923c)', animation: 'pulse 1.5s ease-in-out infinite' }}
    >
      <Flame size={32} className="text-white" />
    </div>
  </div>
);

// ── Main app ─────────────────────────────────────────────────────────────────
function AppInner() {
  const { isAuthenticated, screen, setAuth, setProfile, setProfileCache, logout } = useAppStore(s => ({
    isAuthenticated: s.isAuthenticated,
    screen: s.screen,
    setAuth: s.setAuth,
    setProfile: s.setProfile,
    setProfileCache: s.setProfileCache,
    logout: s.logout,
  }));

  const [signer, setSigner] = useState<NostrSigner | null>(null);
  const [hydrating, setHydrating] = useState(true);

  useEffect(() => {
    let subUnsub: (() => void) | null = null;

    // Subscribe to future active-account changes (set up before init so we don't miss anything)
    try {
      const sub = accountManager.active$.subscribe(account => {
        if (account) setSigner(account.signer as unknown as NostrSigner);
        else setSigner(null);
      });
      subUnsub = () => sub.unsubscribe();
    } catch (e) {
      console.error('active$ subscribe failed:', e);
    }

    initAccountManager()
      .then(async () => {
        const active = accountManager.active;
        if (active) {
          try {
            const s = active.signer as unknown as NostrSigner;
            setSigner(s);
            const pk = await s.getPublicKey();
            setAuth(pk);
            // Load profile in background — don't block hydration
            fetchProfiles([pk]).then(profiles => {
              if (profiles[0]) { setProfile(profiles[0]); setProfileCache(profiles[0]); }
            }).catch(() => {});
          } catch (e) {
            console.error('Session restore failed:', e);
            logout();
          }
        } else {
          // No active account — if store thinks we're logged in, that's stale, clear it
          if (useAppStore.getState().isAuthenticated) logout();
        }
      })
      .catch(e => {
        console.error('initAccountManager failed:', e);
      })
      .finally(() => {
        setHydrating(false);
      });

    return () => { subUnsub?.(); };
  }, []);

  const handleLogin = (s: NostrSigner) => setSigner(s);

  if (hydrating) return <Splash />;

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

export default function App() {
  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  );
}

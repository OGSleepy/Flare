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

// ── Error boundary ───────────────────────────────────────────────────────────
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

// ── App ──────────────────────────────────────────────────────────────────────
function AppInner() {
  const isAuthenticated = useAppStore(s => s.isAuthenticated);
  const screen = useAppStore(s => s.screen);
  const setAuth = useAppStore(s => s.setAuth);
  const setProfile = useAppStore(s => s.setProfile);
  const setProfileCache = useAppStore(s => s.setProfileCache);
  const logout = useAppStore(s => s.logout);

  const [signer, setSigner] = useState<NostrSigner | null>(null);
  const [hydrating, setHydrating] = useState(true);

  useEffect(() => {
    initAccountManager()
      .then(async () => {
        const active = accountManager.active;
        if (active) {
          try {
            const s = active.signer as unknown as NostrSigner;
            const pk = await s.getPublicKey();
            setSigner(s);
            setAuth(pk);
            // Load profile in background
            fetchProfiles([pk])
              .then(profiles => {
                if (profiles[0]) { setProfile(profiles[0]); setProfileCache(profiles[0]); }
              })
              .catch(() => {});
          } catch {
            logout();
          }
        } else {
          // No restored account — clear stale auth state if any
          if (useAppStore.getState().isAuthenticated) logout();
        }
      })
      .catch(() => {
        if (useAppStore.getState().isAuthenticated) logout();
      })
      .finally(() => setHydrating(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (hydrating) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-16 h-16 rounded-3xl flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg,#f97316,#fb923c)', animation: 'pulse 1.5s ease-in-out infinite' }}>
          <Flame size={32} className="text-white" />
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <>
        <LoginScreen onLogin={setSigner} />
        <Toaster position="top-center" theme="dark" />
      </>
    );
  }

  return (
    <div className="flex flex-col h-full">
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

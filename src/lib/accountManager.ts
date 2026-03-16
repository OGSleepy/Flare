import { AccountManager, Accounts } from 'applesauce-accounts';

export const accountManager = new AccountManager();

// MUST register types before fromJSON — otherwise deserialization crashes silently
Accounts.registerCommonAccountTypes(accountManager);

const ACCOUNTS_KEY = 'flare-accounts';
const ACTIVE_KEY = 'flare-active';
let ready = false;

export async function initAccountManager(): Promise<void> {
  if (ready) return;
  ready = true;

  // Restore saved accounts
  const saved = localStorage.getItem(ACCOUNTS_KEY);
  if (saved) {
    try {
      await accountManager.fromJSON(JSON.parse(saved));
    } catch {
      localStorage.removeItem(ACCOUNTS_KEY);
      localStorage.removeItem(ACTIVE_KEY);
    }
  }

  // Auto-save on any change
  accountManager.accounts$.subscribe(() => {
    try {
      localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accountManager.toJSON()));
    } catch { /* storage full */ }
  });

  // Restore active account
  const activeId = localStorage.getItem(ACTIVE_KEY);
  if (activeId) {
    try { accountManager.setActive(activeId); } catch { localStorage.removeItem(ACTIVE_KEY); }
  }

  // Persist active account ID
  accountManager.active$.subscribe(account => {
    if (account) localStorage.setItem(ACTIVE_KEY, account.id);
    else localStorage.removeItem(ACTIVE_KEY);
  });
}

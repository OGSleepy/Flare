import { AccountManager, Accounts } from 'applesauce-accounts';

export const accountManager = new AccountManager();

const ACCOUNTS_KEY = 'flare-accounts';
const ACTIVE_KEY = 'flare-active';
let ready = false;

export async function initAccountManager(): Promise<void> {
  if (ready) return;
  ready = true;

  const saved = localStorage.getItem(ACCOUNTS_KEY);
  if (saved) {
    try {
      await accountManager.fromJSON(JSON.parse(saved));
    } catch {
      localStorage.removeItem(ACCOUNTS_KEY);
      localStorage.removeItem(ACTIVE_KEY);
      return;
    }
  }

  accountManager.accounts$.subscribe(() => {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accountManager.toJSON()));
  });

  const activeId = localStorage.getItem(ACTIVE_KEY);
  if (activeId) {
    try { accountManager.setActive(activeId); } catch { localStorage.removeItem(ACTIVE_KEY); }
  }

  accountManager.active$.subscribe(account => {
    if (account) localStorage.setItem(ACTIVE_KEY, account.id);
    else localStorage.removeItem(ACTIVE_KEY);
  });
}

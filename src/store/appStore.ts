import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AppState {
  // Theme
  isDarkMode: boolean;
  toggleDarkMode: () => void;

  // Sidebar
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  openSidebarGroups: string[];
  toggleSidebarGroup: (label: string) => void;

  // User
  user: {
    name: string;
    email: string;
    avatar: string;
    plan: string;
  } | null;
  setUser: (user: AppState['user']) => void;

  // Notifications
  unreadNotifications: number;
  setUnreadNotifications: (count: number) => void;

  // AI Generation state
  isGenerating: boolean;
  setIsGenerating: (generating: boolean) => void;

  // Connected accounts
  connectedAccounts: {
    meta: boolean;
    google: boolean;
  };
  setConnectedAccount: (platform: 'meta' | 'google', connected: boolean) => void;

  // Polling interval (minutes)
  pollingIntervalMinutes: number;
  setPollingIntervalMinutes: (minutes: number) => void;

  // Product Tour
  showProductTour: boolean;
  setShowProductTour: (show: boolean) => void;
}

const THEME_STORAGE_KEY = 'logosia-storage';
const THEME_PREFERENCE_KEY = 'logosia-theme-preference';

const applyThemeClass = (isDarkMode: boolean) => {
  if (typeof document === 'undefined') return;

  document.documentElement.classList.toggle('dark', isDarkMode);
  document.documentElement.style.colorScheme = isDarkMode ? 'dark' : 'light';
};

const readStoredDarkMode = () => {
  if (typeof window === 'undefined') return true;

  try {
    const preference = window.localStorage.getItem(THEME_PREFERENCE_KEY);
    if (preference === 'light') return false;
    if (preference === 'dark') return true;

    // Old versions persisted false accidentally when the DOM was still dark.
    // Treat legacy/missing preference as dark and only honor the new key.
    return true;
  } catch {
    return true;
  }
};

const writeThemePreference = (isDarkMode: boolean) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(THEME_PREFERENCE_KEY, isDarkMode ? 'dark' : 'light');
};

const initialDarkMode = readStoredDarkMode();
applyThemeClass(initialDarkMode);

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      // Theme - default to dark mode
      isDarkMode: initialDarkMode,
      toggleDarkMode: () =>
        set((state) => {
          const newMode = !state.isDarkMode;
          applyThemeClass(newMode);
          writeThemePreference(newMode);
          return { isDarkMode: newMode };
        }),

      // Sidebar
      sidebarOpen: true,
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      openSidebarGroups: ['🏠 Dashboard', '🤖 Agentes IA', '💬 WhatsApp & CRM', '🔗 Integrações', '⚙️ Sistema'],
      toggleSidebarGroup: (label) =>
        set((state) => ({
          openSidebarGroups: state.openSidebarGroups.includes(label)
            ? state.openSidebarGroups.filter((l) => l !== label)
            : [...state.openSidebarGroups, label],
        })),

      // User
      user: null,
      setUser: (user) => set({ user }),

      // Notifications
      unreadNotifications: 2,
      setUnreadNotifications: (count) => set({ unreadNotifications: count }),

      // AI Generation
      isGenerating: false,
      setIsGenerating: (generating) => set({ isGenerating: generating }),

      // Connected accounts
      connectedAccounts: {
        meta: false,
        google: false,
      },
      setConnectedAccount: (platform, connected) =>
        set((state) => ({
          connectedAccounts: {
            ...state.connectedAccounts,
            [platform]: connected,
          },
        })),

      // Polling interval (default 5 min)
      pollingIntervalMinutes: 5,
      setPollingIntervalMinutes: (minutes) => set({ pollingIntervalMinutes: minutes }),

      // Product Tour
      showProductTour: false,
      setShowProductTour: (show) => set({ showProductTour: show }),
    }),
    {
      name: THEME_STORAGE_KEY,
      onRehydrateStorage: () => (state) => {
        const isDarkMode = readStoredDarkMode();
        applyThemeClass(isDarkMode);
      },
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...(persistedState as Partial<AppState>),
        isDarkMode: readStoredDarkMode(),
      }),
      partialize: (state) => ({
        isDarkMode: state.isDarkMode,
        sidebarOpen: state.sidebarOpen,
        openSidebarGroups: state.openSidebarGroups,
        pollingIntervalMinutes: state.pollingIntervalMinutes,
      }),
    }
  )
);

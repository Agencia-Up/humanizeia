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
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      // Theme - default to dark mode
      isDarkMode: true,
      toggleDarkMode: () =>
        set((state) => {
          const newMode = !state.isDarkMode;
          if (newMode) {
            document.documentElement.classList.add('dark');
          } else {
            document.documentElement.classList.remove('dark');
          }
          return { isDarkMode: newMode };
        }),

      // Sidebar
      sidebarOpen: true,
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      openSidebarGroups: [],
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
    }),
    {
      name: 'humanizeai-storage',
      partialize: (state) => ({
        isDarkMode: state.isDarkMode,
        sidebarOpen: state.sidebarOpen,
        openSidebarGroups: state.openSidebarGroups,
      }),
    }
  )
);

// Initialize dark mode on load
if (typeof window !== 'undefined') {
  const stored = localStorage.getItem('humanizeai-storage');
  if (stored) {
    const parsed = JSON.parse(stored);
    if (parsed.state?.isDarkMode) {
      document.documentElement.classList.add('dark');
    }
  } else {
    // Default to dark mode
    document.documentElement.classList.add('dark');
  }
}

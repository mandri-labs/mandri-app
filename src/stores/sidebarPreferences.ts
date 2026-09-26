import { createStore } from "zustand/vanilla";
import { createJSONStorage, persist } from "zustand/middleware";

interface SidebarPreferences {
  hideTemporaryFolders: boolean;
  setHideTemporaryFolders: (value: boolean) => void;
}

export const sidebarPreferencesStore = createStore<SidebarPreferences>()(
  persist(
    (set) => ({
      hideTemporaryFolders: false,
      setHideTemporaryFolders: (hideTemporaryFolders) => set({ hideTemporaryFolders }),
    }),
    {
      name: "mandri.sidebar",
      storage: createJSONStorage(() => localStorage),
      partialize: ({ hideTemporaryFolders }) => ({ hideTemporaryFolders }),
      merge: (stored, current) => ({
        ...current,
        hideTemporaryFolders:
          (stored as Partial<SidebarPreferences> | undefined)?.hideTemporaryFolders === true,
      }),
    },
  ),
);

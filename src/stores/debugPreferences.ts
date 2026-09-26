import { createStore } from "zustand/vanilla";
import { createJSONStorage, persist } from "zustand/middleware";

interface DebugPreferences {
  showTechnicalEvents: boolean;
  setShowTechnicalEvents: (value: boolean) => void;
}

export const debugPreferencesStore = createStore<DebugPreferences>()(
  persist(
    (set) => ({
      showTechnicalEvents: false,
      setShowTechnicalEvents: (showTechnicalEvents) => set({ showTechnicalEvents }),
    }),
    {
      name: "mandri.debug",
      storage: createJSONStorage(() => localStorage),
      partialize: ({ showTechnicalEvents }) => ({ showTechnicalEvents }),
      merge: (stored, current) => ({
        ...current,
        showTechnicalEvents:
          (stored as Partial<DebugPreferences> | undefined)?.showTechnicalEvents === true,
      }),
    },
  ),
);

import { createStore } from "zustand/vanilla";
import { createJSONStorage, persist } from "zustand/middleware";

export type ConversationWidth = "standard" | "wide" | "full";

interface DisplayPreferences {
  conversationWidth: ConversationWidth;
  setConversationWidth: (value: ConversationWidth) => void;
}

export const displayPreferencesStore = createStore<DisplayPreferences>()(
  persist(
    (set) => ({
      conversationWidth: "standard",
      setConversationWidth: (conversationWidth) => set({ conversationWidth }),
    }),
    {
      name: "mandri.display",
      storage: createJSONStorage(() => localStorage),
      partialize: ({ conversationWidth }) => ({ conversationWidth }),
      merge: (stored, current) => {
        const width = (stored as Partial<DisplayPreferences> | undefined)?.conversationWidth;
        return {
          ...current,
          conversationWidth: width === "wide" || width === "full" ? width : "standard",
        };
      },
    },
  ),
);

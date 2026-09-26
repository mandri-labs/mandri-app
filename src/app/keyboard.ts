export const NEW_SESSION_EVENT = "mandri:new-session";
export const FOCUS_COMPOSER_EVENT = "mandri:focus-composer";
export const TOGGLE_PALETTE_EVENT = "mandri:toggle-palette";
export const TOGGLE_SHORTCUTS_EVENT = "mandri:toggle-shortcuts";
export const ENTER_SPLIT_EVENT = "mandri:enter-split";

function dispatchEvent(name: string): void {
  window.dispatchEvent(new CustomEvent(name));
}

export function requestNewSession(): void {
  dispatchEvent(NEW_SESSION_EVENT);
}

export function requestFocusComposer(): void {
  dispatchEvent(FOCUS_COMPOSER_EVENT);
}

export function requestSplitMode(): void {
  dispatchEvent(ENTER_SPLIT_EVENT);
}

export function toggleCommandPalette(): void {
  dispatchEvent(TOGGLE_PALETTE_EVENT);
}

export function toggleShortcutSheet(): void {
  dispatchEvent(TOGGLE_SHORTCUTS_EVENT);
}

export function modifierKeyName(): string {
  return navigator.platform.toLowerCase().startsWith("mac") ? "Cmd" : "Ctrl";
}

export function registerWindowKeyboardShortcuts(): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) {
      return;
    }
    if (event.key === "k" || event.key === "K") {
      event.preventDefault();
      toggleCommandPalette();
      return;
    }
    if (event.key === "/") {
      event.preventDefault();
      toggleShortcutSheet();
      return;
    }
    if (event.shiftKey && !event.metaKey && (event.key === "p" || event.key === "P")) {
      event.preventDefault();
      requestSplitMode();
      return;
    }
    if (event.key === "n" || event.key === "N") {
      event.preventDefault();
      requestNewSession();
    }
  };
  window.addEventListener("keydown", onKeyDown);
  return () => {
    window.removeEventListener("keydown", onKeyDown);
  };
}

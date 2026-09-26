import { isTauri } from "./index";

export interface Notifier {
  isSupported(): Promise<boolean>;
  requestPermission(): Promise<boolean>;
  notify(title: string, body: string): Promise<void>;
}

async function tauriNotifier(): Promise<Notifier> {
  const notification = await import("@tauri-apps/plugin-notification");
  return {
    isSupported: notification.isPermissionGranted,
    requestPermission: async () => (await notification.requestPermission()) === "granted",
    notify: async (title, body) => {
      const granted = await notification.isPermissionGranted();
      if (granted) {
        notification.sendNotification({ title, body });
      }
    },
  };
}

async function webNotifier(): Promise<Notifier> {
  return {
    isSupported: async () => typeof Notification !== "undefined",
    requestPermission: async () => {
      if (typeof Notification === "undefined") {
        return false;
      }
      return (await Notification.requestPermission()) === "granted";
    },
    notify: async (title, body) => {
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        new Notification(title, { body });
      }
    },
  };
}

export async function getNotifier(): Promise<Notifier> {
  return isTauri() ? tauriNotifier() : webNotifier();
}

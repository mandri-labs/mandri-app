import { isTauri } from "./index";

export async function openAuthorizationUrl(url: string): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname !== "auth.openai.com") {
    throw new Error("Invalid authorization URL");
  }
  if (isTauri()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } else {
    const opened = window.open(url, "_blank");
    if (opened === null) throw new Error("Browser blocked the authorization window");
    opened.opener = null;
  }
}

export async function openMcpAuthorizationUrl(url: string): Promise<void> {
  const parsed = new URL(url);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (
    (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) ||
    parsed.username ||
    parsed.password
  )
    throw new Error("Invalid authorization URL");
  if (isTauri()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } else {
    const opened = window.open(url, "_blank");
    if (opened === null) throw new Error("Browser blocked the authorization window");
    opened.opener = null;
  }
}

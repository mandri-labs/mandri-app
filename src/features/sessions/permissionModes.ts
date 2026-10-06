import type { HarnessKind } from "@/daemon/types/ws";
import type { TFunction } from "i18next";

export const HARNESS_MODES: Record<HarnessKind, readonly string[]> = {
  claude: ["default", "acceptEdits", "auto", "plan", "bypassPermissions", "dontAsk"],
  codex: ["ask", "auto", "full-access"],
  opencode: ["default", "auto"],
  pi: ["default", "acceptEdits", "plan", "bypassPermissions"],
  agy: ["default", "acceptEdits", "plan", "bypassPermissions"],
};

export const DEFAULT_MODE: Record<HarnessKind, string> = {
  claude: "default",
  codex: "ask",
  opencode: "default",
  pi: "default",
  agy: "default",
};

export function permissionLabel(harness: HarnessKind, mode: string, t: TFunction): string {
  if (!mode) return t("core.composer.permissions_inherit");
  const key = `core.permissions.${harness}.${mode}.label`;
  return t(key, { defaultValue: t("core.permissions.legacy", { mode }) });
}

export function permissionTone(harness: HarnessKind, mode: string): "amber" | "danger" | undefined {
  if ((harness === "claude" || harness === "opencode" || harness === "codex") && mode === "auto")
    return "amber";
  if (
    ((harness === "claude" || harness === "agy" || harness === "pi") &&
      mode === "bypassPermissions") ||
    (harness === "codex" && mode === "full-access")
  )
    return "danger";
  return undefined;
}

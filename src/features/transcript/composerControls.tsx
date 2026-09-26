import { AntigravityLogo, ClaudeLogo, OpenAILogo, OpencodeLogo, PiLogo } from "@/design/logos";

export const HARNESS_NAME_KEYS: Record<string, string> = {
  pi: "core.settings.defaults.harness_pi",
  claude: "core.settings.defaults.harness_claude",
  codex: "core.settings.defaults.harness_codex",
  opencode: "core.settings.defaults.harness_opencode",
  agy: "core.settings.defaults.harness_agy",
};

export function harnessDisplayName(harness: string, t: (key: string) => string): string {
  const key = HARNESS_NAME_KEYS[harness];
  return key === undefined ? harness : t(key);
}

export function HarnessMark({ harness, size = 14 }: { harness: string; size?: number }) {
  if (harness === "pi") return <PiLogo size={size} />;
  if (harness === "agy") return <AntigravityLogo size={size} />;
  if (harness === "claude") {
    return <ClaudeLogo size={size} />;
  }
  if (harness === "codex") {
    return <OpenAILogo size={size} />;
  }
  if (harness === "opencode") {
    return <OpencodeLogo size={size} />;
  }
  return null;
}

export function splitModelRef(modelRef: string): { prefix: string; name: string } {
  const index = modelRef.lastIndexOf("/");
  if (index < 0) {
    return { prefix: "", name: modelRef };
  }
  return { prefix: modelRef.slice(0, index + 1), name: modelRef.slice(index + 1) };
}

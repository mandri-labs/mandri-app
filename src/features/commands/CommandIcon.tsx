import {
  Archive,
  Bot,
  BookOpen,
  CircleHelp,
  ClipboardList,
  Coins,
  FilePlus2,
  FileText,
  Gauge,
  GitFork,
  Goal,
  KeyRound,
  Layers,
  ListChecks,
  MessageSquarePlus,
  Minimize2,
  Plug,
  SearchCheck,
  Settings2,
  ShieldCheck,
  Sparkles,
  Terminal,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { NativeCommand } from "@/daemon/types/commands";

const commandIcons: Record<string, LucideIcon> = {
  goal: Goal,
  help: CircleHelp,
  compact: Minimize2,
  context: Layers,
  usage: Gauge,
  quota: Gauge,
  credits: Coins,
  model: Bot,
  models: Bot,
  effort: Zap,
  fast: Zap,
  agents: Bot,
  skills: BookOpen,
  hooks: Plug,
  mcp: Plug,
  config: Settings2,
  settings: Settings2,
  permissions: ShieldCheck,
  login: KeyRound,
  logout: KeyRound,
  init: FilePlus2,
  review: SearchCheck,
  plan: ClipboardList,
  todos: ListChecks,
  changelog: FileText,
  clear: MessageSquarePlus,
  new: MessageSquarePlus,
  fork: GitFork,
  archive: Archive,
  "customize-opencode": Sparkles,
};

export function CommandIcon({
  command,
  size = 16,
}: {
  command: Pick<NativeCommand, "name" | "kind">;
  size?: number;
}) {
  const name = command.name.replace(/^\//, "").toLowerCase();
  const Icon = commandIcons[name] ?? (command.kind === "skill" ? BookOpen : Terminal);
  return <Icon size={size} aria-hidden="true" />;
}

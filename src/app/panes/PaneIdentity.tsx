import { Circle } from "lucide-react";
import { useStore } from "@/app/useStore";
import { AntigravityLogo, ClaudeLogo, OpenAILogo, OpencodeLogo, PiLogo } from "@/design/logos";
import { agentsStore } from "@/stores/agents";
import { sessionsStore } from "@/stores/sessions";
import type { PaneTarget } from "@/stores/panes";

export function PaneIdentity({ target }: { target: PaneTarget }) {
  const session = useStore(sessionsStore, (state) =>
    target.kind === "session" ? state.sessions[target.id] : undefined,
  );
  const agent = useStore(agentsStore, (state) =>
    target.kind === "agent" ? state.agents[target.id] : undefined,
  );
  const harness = agent?.harness ?? session?.harness;
  const Logo = harness
    ? {
        claude: ClaudeLogo,
        codex: OpenAILogo,
        opencode: OpencodeLogo,
        agy: AntigravityLogo,
        pi: PiLogo,
      }[harness]
    : Circle;
  const title = agent?.title ?? session?.title ?? target.id;
  return (
    <span className="pane-identity">
      <span className="pane-harness" aria-hidden="true">
        <Logo size={14} />
      </span>
      <span className="pane-title" title={title}>
        {title}
      </span>
    </span>
  );
}

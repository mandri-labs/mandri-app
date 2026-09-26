import type { Meta, StoryObj } from "@storybook/react-vite";
import { initI18n } from "@/i18n";
import { CodexTool } from "./CodexTool";
import { agentsStore } from "@/stores/agents";

export default {
  title: "Features/Transcript/Codex agent activity",
  loaders: [
    async () => {
      await initI18n("fr");
      agentsStore.setState({
        agents: {
          sample: {
            id: "sample",
            native_id: "native-sample",
            parent_session_id: "sample-parent",
            parent_agent_id: null,
            session_id: "sample-child",
            harness: "codex",
            title: "Cicero",
            task_id: "/root/selected_family_front",
            state: "completed",
            delegation_id: null,
            capabilities: { message: false, stop: false },
            created_at: 0,
            updated_at: 0,
          },
        },
      });
    },
  ],
} satisfies Meta;

export const Messages: StoryObj = {
  render: () => (
    <div style={{ width: "min(680px, calc(100vw - 48px))", display: "grid", gap: 18 }}>
      {[
        {
          tool: "send_message",
          input: {
            targets: ["Plan backend", "Plan e2e"],
            message: "gAAAAABopaque-encrypted-content",
          },
        },
        {
          tool: "send_message",
          input: { target: "selected_family_front", message: "Hidden plaintext message" },
        },
        { tool: "spawn_agent", input: { task_name: "Audit frontend" } },
        { tool: "wait_agent", input: { targets: ["Audit frontend", "Plan backend"] } },
        { tool: "send_message", input: { target: "/root" } },
      ].map(({ tool, input }, index) => (
        <CodexTool
          sessionId="sample-parent"
          key={index}
          node={{
            kind: "tool",
            tool: `collaboration.${tool}`,
            label: tool,
            status: "done",
            codex: { input, output: "" },
          }}
        />
      ))}
    </div>
  ),
};

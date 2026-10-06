import { createRoot } from "react-dom/client";
import "@/design/fonts";
import "@/design/tokens.css";
import "@/design/theme.css";
import { initI18n } from "@/i18n";
import { SessionView } from "@/features/transcript/SessionView";
import { sessionsStore, transcriptStore } from "@/stores/sessions";
import { approvalsStore, setApprovalTransport } from "@/stores/approvals";

export const answers: unknown[] = [];
const command =
  'rm "/workspace/AGENTS - Copie.md" "/workspace/AGENTS.local - Copie.md" "/workspace/CLAUDE - Copie.md"';

export function seed() {
  approvalsStore.getState().reset();
  approvalsStore.getState().ingestFrame({
    type: "approval.pending",
    topic: "session.preview",
    seq: 1,
    source: "claude",
    ts: Date.now(),
    approval_id: "approval-preview",
    deadline: Date.now() + 120000,
    status: "pending",
    raw: {
      request: {
        tool_name: "Bash",
        input: { command },
        permission_suggestions: [{ rules: [{ ruleContent: command }] }],
      },
    },
  });
}

export async function mount() {
  await initI18n("fr");
  document.documentElement.dataset.theme = "dark";
  sessionsStore.setState({
    sessions: {
      preview: {
        id: "preview",
        harness: "claude",
        state: "stopped",
        deleted: false,
        title: "Approval preview",
        pendingApprovals: 0,
        nativeId: "native-preview",
        daemonOrigin: true,
        externalBusy: false,
        interactionMode: "default",
      },
    },
    order: ["preview"],
  });
  setApprovalTransport({
    answer: async (params) => {
      answers.push(params);
      return { approval_id: params.approval_id, status: "answered" };
    },
    cancel: async (params) => {
      answers.push(params);
      return { approval_id: params.approval_id, status: "cancelled" };
    },
  });
  seed();
  createRoot(document.getElementById("root")!).render(
    <div
      className="pane-body"
      style={{ display: "flex", height: "100%", padding: "24px 32px 80px", overflow: "hidden" }}
    >
      <SessionView sessionId="preview" />
    </div>,
  );
  setTimeout(
    () =>
      transcriptStore.getState().setNodes("preview", [
        { kind: "user", text: "Supprime les fichiers Copie." },
        { kind: "tool", tool: "Bash", label: command, status: "running" },
      ]),
    100,
  );
}

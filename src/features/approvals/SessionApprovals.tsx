import { useStore } from "@/app/useStore";
import { approvalsStore } from "@/stores/approvals";
import { ApprovalCard } from "./ApprovalCard";
import "./approvals.css";
import { agentsStore } from "@/stores/agents";
import { navigate } from "@/app/useHashRoute";
import { useTranslation } from "react-i18next";

export function SessionApprovals({ sessionId, agentId }: { sessionId: string; agentId?: string }) {
  const { t } = useTranslation();
  const agents = useStore(agentsStore, (state) => state.agents);
  const pending = useStore(approvalsStore, (state) => state.pending);
  const requests = Object.values(pending)
    .filter((request) => (agentId ? request.agentId === agentId : request.sessionId === sessionId))
    .sort((a, b) => a.deadline - b.deadline);
  if (requests.length === 0) return null;
  return (
    <div className="session-approvals" aria-live="polite">
      {requests.map((request) => (
        <div key={request.approvalId}>
          {!agentId && request.agentId && (
            <button
              type="button"
              className="agents-parent"
              onClick={() => navigate({ name: "agent", id: request.agentId! })}
            >
              {t("core.agents.child", { title: agents[request.agentId]?.title ?? request.agentId })}
            </button>
          )}
          <ApprovalCard approval={request} />
        </div>
      ))}
    </div>
  );
}

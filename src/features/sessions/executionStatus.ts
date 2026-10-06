import { useEffect } from "react";
import { useStore } from "@/app/useStore";
import { daemonIdentity } from "@/daemon/identity";
import { policyFromWire } from "@/daemon/protection";
import { getExecutionStatus, type ExecutionStatus } from "@/daemon/rest/protection";
import { sessionsStore } from "@/stores/sessions";

export function applyExecutionStatus(id: string, status: ExecutionStatus): void {
  const current = sessionsStore.getState().sessions[id];
  if (
    !current ||
    status.session_id !== id ||
    !Number.isSafeInteger(status.generation) ||
    status.generation < 0 ||
    !Number.isSafeInteger(status.revision) ||
    status.revision < 0 ||
    !Number.isSafeInteger(status.policy_revision) ||
    status.policy_revision < Math.max(1, current.policyRevision ?? 1) ||
    !policyFromWire(status).policyConfirmed
  )
    return;
  if (
    status.generation < (current.executionGeneration ?? -1) ||
    (status.generation === current.executionGeneration &&
      status.revision < (current.executionRevision ?? -1))
  )
    return;
  const policy = policyFromWire(status, current);
  sessionsStore.getState().applySessionPatch(id, {
    ...policy,
    executionGeneration: status.generation,
    executionRevision: status.revision,
    executionPhase: status.phase,
    executionReason:
      policy.executionReason === "session_policy_conflict"
        ? policy.executionReason
        : (status.reason ?? undefined),
    effectiveBinding:
      policy.executionReason !== "session_policy_conflict" && status.effective_binding === true,
  });
}

export function useExecutionStatus(id: string): void {
  const generation = useStore(daemonIdentity, (state) => state.generation);
  const confirmed = useStore(sessionsStore, (state) => state.sessions[id]?.policyConfirmed);
  const sessionState = useStore(sessionsStore, (state) => state.sessions[id]?.state);
  useEffect(() => {
    if (!confirmed) return;
    let active = true;
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const status = await getExecutionStatus(id);
        if (active && generation === daemonIdentity.getState().generation)
          applyExecutionStatus(id, status);
      } catch {
        if (active && generation === daemonIdentity.getState().generation) {
          sessionsStore.getState().applySessionPatch(id, {
            effectiveBinding: false,
            executionReason: "execution_status_unavailable",
          });
        }
      } finally {
        pending = false;
      }
    };
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [id, generation, confirmed, sessionState]);
}

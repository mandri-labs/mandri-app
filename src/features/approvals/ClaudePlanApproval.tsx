import { useTranslation } from "react-i18next";
import type { ApprovalResponse, ApprovalView } from "@/stores/approvals";
import { asRecord, stringAt } from "@/features/transcript/parse/shared";
import { MarkdownText } from "@/features/transcript/renderers/MarkdownText";
import { permissionLabel } from "@/features/sessions/permissionModes";

export function isClaudePlanApproval(approval: ApprovalView): boolean {
  return (
    approval.harness === "claude" &&
    asRecord(asRecord(approval.raw)?.["request"])?.["tool_name"] === "ExitPlanMode"
  );
}

export function ClaudePlanApproval({
  approval,
  disabled,
  onApprove,
  onReject,
}: {
  approval: ApprovalView;
  disabled: boolean;
  onApprove: (response: ApprovalResponse) => void;
  onReject: () => void;
}) {
  const { t } = useTranslation();
  const request = asRecord(asRecord(approval.raw)?.["request"]);
  const plan = stringAt(asRecord(request?.["input"]), "plan");
  const modes = approval.permissionModes ?? ["default", "acceptEdits"];
  return (
    <div className="approval-plan">
      {plan ? (
        <MarkdownText text={plan} sessionId={approval.sessionId} />
      ) : (
        <p>{t("core.approvals.plan_ready")}</p>
      )}
      <div className="approval-actions">
        {modes
          .filter((mode): mode is NonNullable<ApprovalResponse["permission_mode"]> =>
            ["default", "acceptEdits", "bypassPermissions", "auto"].includes(mode),
          )
          .map((mode) => (
            <button
              key={mode}
              type="button"
              className="approval-decision approval-decision--allow"
              disabled={disabled}
              onClick={() => onApprove({ permission_mode: mode })}
            >
              {t("core.approvals.approve_plan", { mode: permissionLabel("claude", mode, t) })}
            </button>
          ))}
        <button
          type="button"
          className="approval-decision approval-decision--deny"
          disabled={disabled}
          onClick={onReject}
        >
          {t("core.approvals.keep_planning")}
        </button>
      </div>
    </div>
  );
}

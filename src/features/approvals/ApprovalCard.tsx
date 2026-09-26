import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "@/app/useStore";
import { agyToolCall } from "./AgyQuestions";
import { NativeQuestions, NativeInputUnavailable } from "./NativeQuestions";
import type { ApprovalAnswerParams, ApprovalDecision } from "@/daemon/types/ws";
import {
  HARNESS_VARIANTS,
  approvalsStore,
  decisionLabelKey,
} from "@/stores/approvals";
import type { ApprovalView } from "@/stores/approvals";
import "./approvals.css";

const URGENT_THRESHOLD_MS = 15_000;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function stringAt(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function commandAt(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (Array.isArray(value) && value.every((part) => typeof part === "string")) {
    return value.join(" ");
  }
  return undefined;
}

export interface ApprovalContext {
  title?: string;
  command?: string;
  path?: string;
  scopes?: string[];
  question?: string;
  summary?: string;
}

export function extractApprovalContext(approval: ApprovalView): ApprovalContext {
  const raw = asRecord(approval.raw);
  if (raw === undefined) {
    return {};
  }
  if (approval.harness === "pi") {
    return { title: stringAt(raw, "title"), summary: stringAt(raw, "title"), question: stringAt(raw, "message") };
  }
  if (approval.harness === "agy") {
    const call = agyToolCall(raw);
    const args = asRecord(call?.["args"]);
    return { command: commandAt(args?.["CommandLine"]), path: stringAt(args, "TargetFile"),
      summary: stringAt(args, "toolSummary") ?? stringAt(call, "name") };
  }
  if (approval.harness === "claude") {
    const request = asRecord(raw["request"]);
    const input = asRecord(request?.["input"]);
    const suggestions = Array.isArray(request?.["permission_suggestions"])
      ? (request?.["permission_suggestions"] as unknown[])
      : [];
    const scopes = suggestions.flatMap((entry) => {
      const rules = asRecord(entry)?.["rules"];
      if (!Array.isArray(rules)) {
        return [];
      }
      return rules.flatMap((rule) => {
        const content = stringAt(asRecord(rule), "ruleContent");
        return content === undefined ? [] : [content];
      });
    });
    const questions = Array.isArray(input?.["questions"]) ? (input?.["questions"] as unknown[]) : [];
    const question = questions
      .map((entry) => stringAt(asRecord(entry), "question"))
      .find((value) => value !== undefined);
    return {
      command: commandAt(input?.["command"]),
      path: stringAt(input, "file_path"),
      scopes: scopes.length > 0 ? scopes : undefined,
      question: question ?? stringAt(request, "description"),
      summary: stringAt(request, "tool_name"),
    };
  }
  if (approval.harness === "opencode") {
    const props = asRecord(raw["properties"]);
    const metadata = asRecord(props?.["metadata"]);
    const patterns = Array.isArray(props?.["patterns"]) ? (props?.["patterns"] as unknown[]) : [];
    return {
      command: commandAt(metadata?.["command"]),
      scopes: patterns.length > 0 ? patterns.filter((p): p is string => typeof p === "string") : undefined,
      summary: stringAt(props, "permission"),
    };
  }
  const params = asRecord(raw["params"]);
  return {
    command: commandAt(params?.["command"] ?? params?.["cmd"] ?? raw["command"]),
    path: stringAt(params, "path") ?? stringAt(params, "file_path") ?? stringAt(raw, "path"),
    summary: stringAt(params, "summary") ?? stringAt(raw, "summary"),
  };
}

function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

interface CountdownProps {
  deadline: number;
  onTick?: (now: number) => void;
}

function Countdown({ deadline, onTick }: CountdownProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const handle = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      onTick?.(current);
    }, 1000);
    return () => {
      window.clearInterval(handle);
    };
  }, [onTick]);
  const { t } = useTranslation();
  const remaining = deadline - now;
  return (
    <span
      className={`approval-countdown${remaining < URGENT_THRESHOLD_MS ? " approval-countdown--urgent" : ""}`}
      role="timer"
    >
      {t("core.approvals.remaining_time", { time: formatCountdown(remaining) })}
    </span>
  );
}

export interface ApprovalCardProps {
  approval: ApprovalView;
  variant?: "full" | "mini";
  onAnswer?: (decision: ApprovalDecision, answers?: ApprovalAnswerParams["answers"]) => void;
  onCancel?: () => void;
}

export function ApprovalCard({
  approval,
  variant = "full",
  onAnswer,
  onCancel,
}: ApprovalCardProps) {
  const { t } = useTranslation();
  const error = useStore(
    approvalsStore,
    (state) => state.errors[approval.approvalId],
  );
  const submitting = useStore(approvalsStore, (state) => state.submitting[approval.approvalId] ?? false);
  const pending = approval.status === "pending";
  const context = useMemo(() => extractApprovalContext(approval), [approval]);
  const scopes = context.scopes?.filter((scope) => scope.trim() !== context.command?.trim());
  const variants = HARNESS_VARIANTS[approval.harness];
  const handleTick = useCallback((now: number) => {
    approvalsStore.getState().tick(now);
  }, []);
  const answer = (decision: ApprovalDecision, answers?: ApprovalAnswerParams["answers"]): void => {
    if (onAnswer !== undefined) {
      onAnswer(decision, answers);
      return;
    }
    void approvalsStore.getState().answer(approval.approvalId, decision, answers);
  };
  const cancel = (): void => {
    if (onCancel !== undefined) {
      onCancel();
      return;
    }
    void approvalsStore.getState().cancel(approval.approvalId);
  };
  return (
    <article
      className={[
        "approval-card",
        `approval-card--${approval.status}`,
        variant === "mini" ? "approval-card--mini" : "",
        error !== undefined ? "approval-card--error" : "",
      ]
        .filter((part) => part.length > 0)
        .join(" ")}
      aria-busy={submitting}
      aria-label={`${t("core.approvals.title")} ${t(`core.approvals.kind_${approval.kind}`)}`}
    >
      <header className="approval-card-header">
        <span className={`approval-kind approval-kind--${approval.kind}`}>
          {t(`core.approvals.kind_${approval.kind}`)}
        </span>
        {pending ? <Countdown deadline={approval.deadline} onTick={handleTick} /> : null}
      </header>
      {pending ? (
        <div className="approval-context">
          {context.command !== undefined ? (
            <pre className="approval-command">{context.command}</pre>
          ) : null}
          {context.path !== undefined ? <span className="approval-path">{context.path}</span> : null}
          {scopes !== undefined && scopes.length > 0 ? (
            <ul className="approval-scopes">
              {Array.from(new Set(scopes)).map((scope) => (
                <li key={scope}>{scope}</li>
              ))}
            </ul>
          ) : null}
          {context.command === undefined &&
          context.path === undefined &&
          context.scopes === undefined && approval.kind !== "user_input" ? (
            <span className="approval-summary">
              {context.title && context.question && <><strong>{context.title}</strong><br /></>}
              {context.question ?? context.summary}
            </span>
          ) : null}
          {approval.kind === "user_input" ? <NativeQuestions key={approval.approvalId} harness={approval.harness} raw={approval.raw} disabled={submitting} onAnswer={(answers) => answer(approval.harness === "codex" || approval.harness === "pi" ? "accept" : approval.harness === "opencode" ? "once" : "allow", answers)} /> : null}
          {approval.kind === "unknown" ? <NativeInputUnavailable /> : null}
        </div>
      ) : (
        <div className={`approval-resolved approval-resolved--${approval.status}`} role="status">
          {t(`core.approvals.${approval.status}`)}
          {approval.status === "answered" && approval.decision !== undefined
            ? ` — ${t(decisionLabelKey(approval.decision))}`
            : null}
        </div>
      )}
      {error !== undefined ? (
        <p className="approval-error" role="alert">
          {t(`error.${error}`)}
        </p>
      ) : null}
      {pending ? (
        <footer className="approval-actions">
          {variants.filter(() => approval.kind !== "user_input" && approval.kind !== "unknown").map((variantEntry) => (
            <button
              key={variantEntry.decision}
              type="button"
              className={`approval-decision approval-decision--${variantEntry.decision}`}
              disabled={submitting}
              onClick={() => answer(variantEntry.decision)}
            >
              {t(variantEntry.labelKey)}
            </button>
          ))}
          {approval.kind !== "user_input" && approval.kind !== "unknown" && variants.some((variantEntry) => variantEntry.decision === "cancel") ? null : (
            <button
              type="button"
              className="approval-decision approval-decision--cancel"
              disabled={submitting}
              onClick={cancel}
            >
              {t("core.approvals.decision_cancel")}
            </button>
          )}
        </footer>
      ) : null}
    </article>
  );
}

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { turnCompleted, type TurnWork } from "./turns/types";
import "./transcript.css";
import "./shimmer.css";

export function WorkingIndicator({ turn, running = true }: { turn?: TurnWork; running?: boolean }) {
  const { t } = useTranslation();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!turn || !running || turnCompleted(turn) || turn.startedAt === undefined) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [turn, running]);
  const complete = turn !== undefined && turnCompleted(turn);
  const timed = turn?.startedAt !== undefined && Number.isFinite(turn.startedAt) &&
    (!complete || (turn.endedAt !== undefined && Number.isFinite(turn.endedAt) && turn.endedAt > turn.startedAt));
  const seconds = Math.max(0, Math.floor(((turn?.endedAt ?? now) - (turn?.startedAt ?? now)) / 1000));
  const duration = seconds === 0 ? "<1s" : seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const outcome = turn?.outcome ?? "worked";
  const key = complete ? timed ? `${outcome}_for` : outcome
    : !turn || !timed || seconds === 0 ? "working" : "working_for";
  if (turn && !running && !complete) return null;
  if (complete && outcome === "worked" && !turn?.firstNodeKey) return null;
  return <div className="transcript-turn-summary"><span>{t(`core.transcript.${key}`, { duration })}</span></div>;
}

export function ActivityIndicator({ label }: { label: string }) {
  return <div className="transcript-activity" role="status"><span className="tr-shimmer">{label}</span></div>;
}

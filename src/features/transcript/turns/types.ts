import type { TranscriptNode } from "../parse/types";

export type TurnOutcome = "worked" | "stopped" | "failed";

export interface TurnWork {
  id: string;
  source?: "history";
  identities?: readonly string[];
  nativeId?: string;
  startedAt?: number;
  endedAt?: number;
  outcome?: TurnOutcome;
  userNodeKey?: string;
  firstNodeKey?: string;
  firstNodeKind?: TranscriptNode["kind"];
  firstNodeText?: string;
}

export interface TurnEvent {
  key: string;
  phase: "start" | "activity" | "finish" | "content";
  identity?: string;
  aliases?: string[];
  at?: number;
  startedAt?: number;
  endedAt?: number;
  outcome?: TurnOutcome;
  active?: boolean;
  source?: "history";
  anchor?: Pick<TurnWork, "firstNodeKey" | "firstNodeKind" | "firstNodeText" | "userNodeKey">;
}

export function turnCompleted(turn: TurnWork): boolean {
  return turn.outcome !== undefined || turn.endedAt !== undefined;
}

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import i18next from "i18next";
import { loadFixture, FixtureReplayer, fixtureToSessionSeed } from "@/daemon/fixtures";
import type { HarnessKind } from "@/daemon/types/ws";
import { dispatchFrame } from "@/app/framePipeline";
import { agentsStore } from "@/stores/agents";
import { sessionsStore } from "@/stores/sessions";
import type { SessionFilters, SessionView } from "@/stores/sessions";

export function seedStore(
  sessions: SessionView[],
  filters: SessionFilters = {},
  syncState: "idle" | "syncing" = "idle",
): void {
  agentsStore.setState({
    agents: {},
    parentCapabilities: {},
    classifiedSessionIds: sessions.map((session) => session.id),
    loaded: true,
    error: null,
    drafts: {},
  });
  sessionsStore.setState({
    sessions: Object.fromEntries(sessions.map((session) => [session.id, session])),
    order: sessions.map((session) => session.id),
    filters,
    syncState,
  });
}

export function StoryGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(() => i18next.isInitialized);
  useEffect(() => {
    const onReady = (): void => {
      setReady(true);
    };
    if (i18next.isInitialized) {
      setReady(true);
      return;
    }
    i18next.on("initialized", onReady);
    return () => {
      i18next.off("initialized", onReady);
    };
  }, []);
  return ready ? <>{children}</> : null;
}

export function SeedStore({
  sessions,
  filters,
  syncState,
}: {
  sessions: SessionView[];
  filters?: SessionFilters;
  syncState?: "idle" | "syncing";
}) {
  useEffect(() => {
    seedStore(sessions, filters, syncState);
  }, [sessions, filters, syncState]);
  return null;
}

export function FixtureReplay({ harness, scenario }: { harness: HarnessKind; scenario: string }) {
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const fixture = await loadFixture(harness, scenario);
      if (fixture === null || cancelled) {
        return;
      }
      dispatchFrame({
        type: "snapshot",
        topic: "sessions.all",
        sessions: [fixtureToSessionSeed(fixture)],
        runtimes: [],
      });
      const replayer = new FixtureReplayer((frame) => {
        dispatchFrame(frame);
      });
      await replayer.replay(fixture, { speed: "realtime", timeScale: 0.25, maxDelayMs: 500 });
    })();
    return () => {
      cancelled = true;
    };
  }, [harness, scenario]);
  return null;
}

export const badgeSessions: SessionView[] = [
  {
    id: "live-active",
    harness: "claude",
    state: "live",
    deleted: false,
    title: "Refactor the auth module",
    model: "openrouter/z-ai/glm-5.3-flash",
    projectPath: "D:/Projects/example-app",
    activity: "active",
    lastActivityAt: 400,
    pendingApprovals: 0,
  },
  {
    id: "live-idle",
    harness: "codex",
    state: "live",
    deleted: false,
    title: "Migrate the database schema",
    model: "openrouter/gpt",
    projectPath: "D:/Projects/example-app",
    activity: "idle",
    lastActivityAt: 300,
    pendingApprovals: 0,
  },
  {
    id: "approvals",
    harness: "claude",
    state: "live",
    deleted: false,
    title: "Run the deploy pipeline",
    model: "openrouter/gpt",
    projectPath: "D:/Dev/api",
    activity: "active",
    lastActivityAt: 200,
    pendingApprovals: 2,
  },
  {
    id: "stopped",
    harness: "opencode",
    state: "stopped",
    deleted: false,
    title: "Fix the flaky integration test",
    projectPath: "D:/Dev/api",
    activity: "idle",
    lastActivityAt: 100,
    lastStopCause: "viewer_stop",
    pendingApprovals: 0,
  },
  {
    id: "discovered",
    harness: "claude",
    state: "discovered",
    deleted: false,
    title: "Import the legacy workspace",
    pendingApprovals: 0,
  },
];

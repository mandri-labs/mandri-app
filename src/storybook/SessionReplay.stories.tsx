import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import { Shell } from "@/app/Shell";
import { SessionView } from "@/features/transcript/SessionView";
import { StoryGate } from "@/features/sessions/storyHelpers";
import { dispatchFrame } from "@/app/framePipeline";
import { initI18n } from "@/i18n";
import { loadFixture, type FixtureFile } from "@/daemon/fixtures";
import { FixturePlayback, fixtureTimeline, fixtureNativeId } from "@/daemon/fixtures/playback";
import type { HarnessKind, ActionResultMap, RequestAction } from "@/daemon/types/ws";
import { DaemonError } from "@/daemon/errors";
import { sessionFeed } from "@/daemon/ws/sessionFeed";
import { keepAlive } from "@/daemon/ws/keepAlive";
import { sessionsStore, transcriptStore } from "@/stores/sessions";
import { agentsStore } from "@/stores/agents";
import { approvalsStore } from "@/stores/approvals";
import { connectionStore } from "@/stores/connection";
import { panesStore } from "@/stores/panes";
import { installReplaySocket } from "./replayConnection";
import "./sessionReplay.css";

void initI18n("en");

function clearSessionState() {
  for (const id of new Set([
    ...Object.keys(sessionsStore.getState().sessions),
    ...Object.keys(transcriptStore.getState().transcripts),
  ])) {
    keepAlive.forget(id);
    sessionFeed.closeSession(id);
  }
  sessionsStore.setState(sessionsStore.getInitialState());
  transcriptStore.getState().resetTranscripts();
  approvalsStore.getState().reset();
  panesStore.getState().closeAll();
  agentsStore.setState(agentsStore.getInitialState());
}

function RecordedSession({ fixture }: { fixture: FixtureFile }) {
  const [player, setPlayer] = useState<FixturePlayback>();
  const [sessionId, setSessionId] = useState("");
  const [, refresh] = useState(0);
  const [error, setError] = useState<string>();
  useEffect(() => {
    const frames = fixtureTimeline(fixture);
    const topic = fixture.frames.find((entry) => entry.topic?.startsWith("session."))?.topic;
    if (!topic) {
      setError("No recorded session topic");
      return;
    }
    const id = topic.slice("session.".length);
    clearSessionState();
    const originalNow = Date.now;
    const originalFetch = window.fetch;
    const previousConnection = connectionStore.getState();
    const origin = fixture.frames[0]?.ts ?? 0;
    const playback = new FixturePlayback(frames, ({ frame }) => {
      dispatchFrame(frame);
      refresh((value) => value + 1);
    });
    // Native UI deadlines and elapsed timers share the capture's clock. Payloads stay unchanged.
    Date.now = () => origin + playback.elapsed;
    const unavailable = () =>
      new DaemonError({
        code: "service_unavailable",
        message: "Read-only recording: this action was not captured.",
      });
    const restoreSocket = installReplaySocket({
      request: async <A extends RequestAction>(action: A): Promise<ActionResultMap[A]> => {
        // A final history snapshot would reveal future events and overwrite live state.
        if (action === "session.history")
          return {
            entries: [],
            next_cursor: null,
            has_more: false,
          } as unknown as ActionResultMap[A];
        if (action === "session.list") return { sessions: [] } as unknown as ActionResultMap[A];
        if (action === "agent.list") return { agents: [] } as unknown as ActionResultMap[A];
        throw unavailable();
      },
      subscribe: () => undefined,
      unsubscribe: () => undefined,
    });
    // Legacy captures contain no REST traffic. These are explicit environment stand-ins.
    window.fetch = async (input, init) => {
      const url = new URL(
        input instanceof Request ? input.url : String(input),
        window.location.href,
      );
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      if (!url.pathname.startsWith("/v1/")) return originalFetch(input, init);
      let body: unknown;
      if (method === "GET" && url.pathname.endsWith("/availability")) {
        body = {
          owner: "mandri",
          activity: "unknown",
          can_resume: false,
          can_release: false,
          can_restore: false,
          reason: null,
        };
      } else if (
        method === "GET" &&
        (url.pathname === "/v1/runtimes" ||
          url.pathname.endsWith("/models") ||
          url.pathname === "/v1/providers")
      ) {
        body = [];
      } else {
        return new Response(
          JSON.stringify({
            error: { code: "service_unavailable", message: unavailable().message },
          }),
          { status: 409 },
        );
      }
      return new Response(JSON.stringify(body), { status: 200 });
    };
    sessionsStore.setState({
      sessions: {
        [id]: {
          id,
          harness: fixture.harness,
          state: "live",
          deleted: false,
          title: `${fixture.harness} / ${fixture.scenario}`,
          model: fixture.modelRef,
          nativeId: fixtureNativeId(fixture),
          projectPath: "/recorded-workspace",
          pendingApprovals: 0,
        },
      },
      order: [id],
    });
    agentsStore.setState({ loaded: true, classifiedSessionIds: [id] });
    connectionStore.getState().setStatus("online");
    sessionFeed.ensureSession(id, fixture.harness);
    setSessionId(id);
    setPlayer(playback);
    playback.play();
    const timer = setInterval(() => refresh((value) => value + 1), 100);
    return () => {
      playback.dispose();
      clearInterval(timer);
      restoreSocket();
      Date.now = originalNow;
      window.fetch = originalFetch;
      clearSessionState();
      connectionStore.setState(previousConnection);
    };
  }, [fixture]);
  if (error) return <p role="alert">{error}</p>;
  if (!player || !sessionId) return <p>Loading recording…</p>;
  const latest = player.frames[player.delivered - 1];
  const session = sessionsStore.getState().sessions[sessionId];
  return (
    <div className="session-replay">
      <div className="session-replay-controls" aria-label="Recording playback">
        <button
          onClick={() => {
            if (player.playing) player.pause();
            else player.play();
            refresh((v) => v + 1);
          }}
          disabled={player.finished}
        >
          {player.playing ? "Pause" : "Play"}
        </button>
        <button
          onClick={() => {
            player.step();
            refresh((v) => v + 1);
          }}
          disabled={player.finished}
        >
          Next event
        </button>
        <span>
          {(player.elapsed / 1000).toFixed(1)} / {(player.duration / 1000).toFixed(1)} s (1×,{" "}
          {player.delivered}/{player.frames.length} frames)
          {player.finished ? ". Recording ended" : ""}
        </span>
        <details>
          <summary>Capture details</summary>
          <p>
            Recorded {fixture.capturedAt}. Every frame uses its capture timestamp; silences are
            preserved.
          </p>
          <p>
            Legacy capture: initial live session and REST availability are stand-ins.
            Startup/execution metadata and outgoing requests were not captured. Final history is not
            preloaded. Actions are read-only; recorded approvals resolve at their recorded time. End
            of recording does not mean the session stopped.
          </p>
          <pre>{JSON.stringify({ session, latestFrame: latest }, null, 2)}</pre>
        </details>
      </div>
      <Shell route={{ name: "session", id: sessionId }}>
        <SessionView sessionId={sessionId} />
      </Shell>
    </div>
  );
}

function ReplayStory({ harness, scenario }: { harness: HarnessKind; scenario: string }) {
  const [fixture, setFixture] = useState<FixtureFile>();
  const [error, setError] = useState<string>();
  const [run, setRun] = useState(0);
  useEffect(() => {
    let active = true;
    setFixture(undefined);
    setError(undefined);
    void loadFixture(harness, scenario)
      .then((value) => {
        if (!active) return;
        if (!value) throw new Error("Recording not found");
        fixtureTimeline(value);
        setFixture(value);
      })
      .catch((caught: unknown) => {
        if (active) setError(String(caught));
      });
    return () => {
      active = false;
    };
  }, [harness, scenario]);
  return (
    <StoryGate>
      <button className="session-replay-restart" onClick={() => setRun((value) => value + 1)}>
        Restart recording
      </button>
      {error ? (
        <p role="alert">{error}</p>
      ) : fixture ? (
        <RecordedSession key={`${harness}/${scenario}/${run}`} fixture={fixture} />
      ) : (
        <p>Loading recording…</p>
      )}
    </StoryGate>
  );
}
const meta = {
  title: "App/Session Replay",
  component: ReplayStory,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ReplayStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const ClaudeChat: Story = { args: { harness: "claude", scenario: "chat" } };
export const ClaudeToolsDiff: Story = { args: { harness: "claude", scenario: "tools-diff" } };
export const ClaudeApproval: Story = { args: { harness: "claude", scenario: "approval" } };
export const ClaudeError: Story = { args: { harness: "claude", scenario: "error" } };
export const CodexChat: Story = { args: { harness: "codex", scenario: "chat" } };
export const CodexToolsDiff: Story = { args: { harness: "codex", scenario: "tools-diff" } };
export const CodexApproval: Story = { args: { harness: "codex", scenario: "approval" } };
export const CodexError: Story = { args: { harness: "codex", scenario: "error" } };
export const OpencodeChat: Story = { args: { harness: "opencode", scenario: "chat" } };
export const OpencodeToolsDiff: Story = { args: { harness: "opencode", scenario: "tools-diff" } };
export const OpencodeApproval: Story = { args: { harness: "opencode", scenario: "approval" } };
export const OpencodeError: Story = { args: { harness: "opencode", scenario: "error" } };

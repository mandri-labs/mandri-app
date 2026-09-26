# Mandri App — Stories

Two story modes coexist:

1. **Hardcoded stories** — every interactive component gets plain-props stories
   for each visual state so it can be tweaked directly in Storybook.
2. **Fixture-replay stories** — real recorded events from the Mandri daemon
   (`tests/fixtures/{claude,codex,opencode}/*.json`) are pushed through the same
   ingestion path as the live socket (`src/daemon/fixtures/replay.ts`), rendering
   genuine transcripts, dashboards and approval flows without any daemon.

Theme toggle (dark default / light) is in the Storybook toolbar.
Never hand-write harness events: re-capture fixtures with
`scripts/capture-fixtures/` when harness behavior changes.

## Session Replay

Open **App / Session Replay** (`npm run storybook`). Twelve stories replay the
existing Claude, Codex and OpenCode captures inside the production `Shell` and
`SessionView`, including the composer and approval cards. Playback starts
automatically at **1×**, using each capture envelope's `ts`, including responses
without an internal timestamp. Long silences are not capped. Wire order wins
when timestamps move backwards (one existing capture has a 1 ms inversion).

Pause, advance one frame, or restart from a clean session. Capture details show
the most recent frame and the current session state. The iframe's `Date.now`
follows the recording clock so approval deadlines and elapsed indicators do not
immediately expire. It is restored on unmount, as are the REST and socket adapters.
Storybook uses an offline connection module; production keeps its real transport.

These are **legacy WebSocket captures**, not complete recordings of today's
session lifecycle. The initial live session and REST availability are explicit
stand-ins; startup/execution polling, outgoing prompt requests and optimistic
composer state were not recorded. Frames are unchanged and pass through
`dispatchFrame`, the same ingestion pipeline used by the live socket. Final
history snapshots are deliberately not preloaded: doing so would expose future
messages before their events arrive. Finishing playback does not fabricate a
session-stopped event. Some named scenarios end in rate limits or an incomplete
turn. Actions that would mutate a session are rejected locally; approval outcomes
follow the recorded events. No daemon or inference is needed.

Browser verification (with Storybook running and Playwright Chromium installed):

```sh
STORYBOOK_URL=http://127.0.0.1:6007 node tests/browser-smoke/session-replay.spec.mjs
```

The smoke test advances browser time through all twelve recordings, checks pause
and restart, and rejects browser errors or real `/v1/` requests. Screenshots go to
`../artifacts/runs/session-replay` (override with `REPLAY_ARTIFACTS`).

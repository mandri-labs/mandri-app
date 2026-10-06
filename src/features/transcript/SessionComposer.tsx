import { NativeSessionExtras } from "./NativeSessionExtras";
import { useStore } from "@/app/useStore";
import { sessionsStore } from "@/stores/sessions";
import { WorktreeIntegration } from "@/features/sessions/WorktreeIntegration";
import { CommandHistory } from "@/features/commands/CommandHistory";
import { Composer, type ComposerProps } from "./Composer";
import "./session-view.css";

export function SessionComposer(props: ComposerProps & { sessionId: string }) {
  const session = useStore(sessionsStore, (state) => state.sessions[props.sessionId]);
  return (
    <div className="session-view-composer">
      {session?.worktree ? <WorktreeIntegration session={session} /> : null}
      {session?.worktree?.state !== "closed" ? (
        <>
          <div className="session-command-dock">
            <CommandHistory
              sessionId={props.sessionId}
              transport={props.commands}
              placement="composer"
            />
          </div>
          <NativeSessionExtras sessionId={props.sessionId} placement="aboveEditor" />
          <Composer {...props} />
          <NativeSessionExtras sessionId={props.sessionId} placement="belowEditor" />
        </>
      ) : null}
    </div>
  );
}

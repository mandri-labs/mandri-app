// Storybook-only replacement. No story can open a live daemon socket.
import type { SocketLike } from "@/daemon/ws/sessionFeed";
import type { ServerMessage } from "@/daemon/types/ws";
export { buildWsUrl } from "../app/connection";
type ReplaySocket = SocketLike & {
  onFrame?: (handler: (frame: ServerMessage) => void) => () => void;
};
let socket: ReplaySocket | null = null;
export function getDaemonSocket(): ReplaySocket | null {
  return socket;
}
export function connectDaemon(): void {
  /* Offline stories own their transport. */
}
export function installReplaySocket(next: ReplaySocket): () => void {
  socket = next;
  return () => {
    if (socket === next) socket = null;
  };
}

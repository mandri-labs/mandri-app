// Storybook-only replacement. No story can open a live daemon socket.
import type { SocketLike } from "@/daemon/ws/sessionFeed";
export { buildWsUrl } from "../app/connection";
let socket: SocketLike | null = null;
export function getDaemonSocket(): SocketLike | null {
  return socket;
}
export function connectDaemon(): void {
  /* Offline stories own their transport. */
}
export function installReplaySocket(next: SocketLike): () => void {
  socket = next;
  return () => {
    if (socket === next) socket = null;
  };
}

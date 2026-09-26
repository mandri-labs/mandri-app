import type { ConnectionStatus } from "@/stores/connection";

export function StatusDot({ status }: { status: ConnectionStatus }) {
  return <span className={`status-dot status-dot--${status}`} aria-hidden="true" />;
}

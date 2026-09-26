import { Monitor, Server } from "lucide-react";

export function EndpointIcon({ local, size = 16 }: { local: boolean; size?: number }) {
  const Icon = local ? Monitor : Server;
  return <Icon size={size} aria-hidden="true" />;
}

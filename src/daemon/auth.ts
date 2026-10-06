let credentials: { origin: string; token: string } | null = null;

export function setDaemonCredentials(baseUrl: string, token: string): void {
  credentials = { origin: new URL(baseUrl).origin, token };
}

export function daemonToken(url: string): string | undefined {
  const target = new URL(url);
  target.protocol =
    target.protocol === "ws:" ? "http:" : target.protocol === "wss:" ? "https:" : target.protocol;
  return credentials?.origin === target.origin ? credentials.token : undefined;
}

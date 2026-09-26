import { describe, expect, it } from "vitest";
import { daemonToken, setDaemonCredentials } from "../../src/daemon/auth";

describe("desktop daemon credentials", () => {
  it("limits the token to the exact local HTTP and WebSocket origin", () => {
    setDaemonCredentials("http://127.0.0.1:45678", "synthetic-token");
    expect(daemonToken("http://127.0.0.1:45678/v1/sessions")).toBe("synthetic-token");
    expect(daemonToken("ws://127.0.0.1:45678/v1/ws")).toBe("synthetic-token");
    expect(daemonToken("http://127.0.0.1:45679/v1/sessions")).toBeUndefined();
    expect(daemonToken("https://example.org/v1/sessions")).toBeUndefined();
    expect(daemonToken("http://127.0.0.1.attacker.example:45678/v1/sessions")).toBeUndefined();
  });
});

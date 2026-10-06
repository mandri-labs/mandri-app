import { sessionFeed } from "@/daemon/ws/sessionFeed";
import { sessionsStore } from "@/stores/sessions";
import { createDebugLogger } from "@/lib/debug";
import { isSessionBusy } from "@/features/transcript/turnActivity";

const log = createDebugLogger("keepAlive");

export type KeepAliveReason = "pane" | "pin" | "session";

export interface KeepAliveDeps {
  subscribe: (sessionId: string) => void;
  unsubscribe: (sessionId: string) => void;
  isBusy: (sessionId: string) => boolean;
  onFinalRelease?: (sessionId: string) => void;
}

function defaultIsBusy(sessionId: string): boolean {
  const session = sessionsStore.getState().sessions[sessionId];
  return isSessionBusy(session);
}

function defaultDeps(): KeepAliveDeps {
  return {
    subscribe: (sessionId) => {
      sessionFeed.subscribeSession(sessionId);
    },
    unsubscribe: (sessionId) => {
      sessionFeed.unsubscribeSession(sessionId);
    },
    isBusy: defaultIsBusy,
    onFinalRelease: (sessionId) => {
      sessionFeed.closeSession(sessionId);
    },
  };
}

export class KeepAliveManager {
  private readonly deps: KeepAliveDeps;
  private readonly refs = new Map<string, Set<KeepAliveReason>>();
  private readonly pins = new Set<string>();
  private readonly pendingRelease = new Set<string>();
  private storeUnsubscribe: (() => void) | null = null;

  constructor(deps?: Partial<KeepAliveDeps>) {
    const resolved = defaultDeps();
    this.deps = {
      subscribe: deps?.subscribe ?? resolved.subscribe,
      unsubscribe: deps?.unsubscribe ?? resolved.unsubscribe,
      isBusy: deps?.isBusy ?? resolved.isBusy,
      onFinalRelease: deps?.onFinalRelease ?? resolved.onFinalRelease,
    };
  }

  acquire(sessionId: string, reason: KeepAliveReason): void {
    let reasons = this.refs.get(sessionId);
    if (reasons === undefined) {
      reasons = new Set<KeepAliveReason>();
      this.refs.set(sessionId, reasons);
    }
    if (reasons.has(reason)) {
      log.trace("acquire no-op, already held", { sessionId, reason, refs: [...reasons] });
      return;
    }
    const wasEmpty = reasons.size === 0;
    reasons.add(reason);
    this.pendingRelease.delete(sessionId);
    log.debug("acquire", { sessionId, reason, wasEmpty, refs: [...reasons] });
    if (wasEmpty) {
      this.deps.subscribe(sessionId);
    }
  }

  release(sessionId: string, reason: KeepAliveReason): void {
    const reasons = this.refs.get(sessionId);
    if (reasons === undefined || !reasons.has(reason)) {
      log.warn("release no-op, reason not held", { sessionId, reason });
      return;
    }
    reasons.delete(reason);
    log.debug("release", { sessionId, reason, remaining: [...reasons] });
    if (reasons.size > 0) {
      return;
    }
    this.refs.delete(sessionId);
    if (this.pins.has(sessionId) || this.deps.isBusy(sessionId)) {
      log.debug("release deferred", { sessionId, pinned: this.pins.has(sessionId), busy: true });
      this.pendingRelease.add(sessionId);
      this.ensureWatch();
      return;
    }
    this.deps.unsubscribe(sessionId);
  }

  pin(sessionId: string): void {
    this.pins.add(sessionId);
    this.pendingRelease.delete(sessionId);
    if (!this.refs.has(sessionId)) {
      this.deps.subscribe(sessionId);
    }
  }

  unpin(sessionId: string): void {
    if (!this.pins.delete(sessionId)) {
      return;
    }
    if (!this.refs.has(sessionId) && !this.deps.isBusy(sessionId)) {
      this.deps.unsubscribe(sessionId);
    }
  }

  isHeld(sessionId: string): boolean {
    return (
      this.refs.has(sessionId) || this.pendingRelease.has(sessionId) || this.pins.has(sessionId)
    );
  }

  refCount(sessionId: string): number {
    return this.refs.get(sessionId)?.size ?? 0;
  }

  forget(sessionId: string): void {
    this.refs.delete(sessionId);
    this.pins.delete(sessionId);
    this.pendingRelease.delete(sessionId);
  }

  private ensureWatch(): void {
    if (this.storeUnsubscribe !== null) {
      return;
    }
    this.storeUnsubscribe = sessionsStore.subscribe(() => {
      this.reapPending();
    });
  }

  private reapPending(): void {
    for (const sessionId of [...this.pendingRelease]) {
      if (this.deps.isBusy(sessionId) || this.pins.has(sessionId)) {
        continue;
      }
      this.pendingRelease.delete(sessionId);
      this.deps.unsubscribe(sessionId);
      this.deps.onFinalRelease?.(sessionId);
    }
    if (this.pendingRelease.size === 0) {
      this.storeUnsubscribe?.();
      this.storeUnsubscribe = null;
    }
  }
}

export const keepAlive = new KeepAliveManager();

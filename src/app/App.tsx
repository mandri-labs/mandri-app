import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { DashboardPage } from "@/features/sessions/DashboardPage";
import { UsagePage } from "@/features/usage/UsagePage";
import { ProvidersPage } from "@/features/providers/ProvidersPage";
import { RoutesPage } from "@/features/providers/RoutesPage";
import { SessionView } from "@/features/transcript/SessionView";
import { SettingsModal } from "@/features/settings/SettingsModal";
import { CommandPaletteHost } from "./CommandPalette";
import { ErrorBoundary } from "./ErrorBoundary";
import { ShortcutSheetHost } from "./ShortcutSheet";
import { registerWindowKeyboardShortcuts } from "./keyboard";
import { PaneManager } from "./panes/PaneManager";
import { Shell } from "./Shell";
import { ConnectionOverlay } from "./ConnectionOverlay";
import { connectDaemon } from "./connection";
import { daemonIdentity } from "@/daemon/identity";
import { watchMcp } from "@/stores/mcp";
import { useStore } from "./useStore";
import { agentsStore } from "@/stores/agents";
import { useAgentsSync } from "@/features/agents/useAgentsSync";
import { AgentView } from "@/features/agents/AgentView";
import { useHashRoute, navigate, routeTitleKey, type Route } from "./useHashRoute";

function RoutePlaceholder({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation();
  return (
    <div className="shell-placeholder">
      <h1>{t(titleKey)}</h1>
    </div>
  );
}

export function App() {
  const locationRoute = useHashRoute();
  const [pageRoute, setPageRoute] = useState<Exclude<Route, { name: "settings" }>>(() =>
    locationRoute.name === "settings" ? { name: "dashboard" } : locationRoute,
  );
  // Settings is an overlay: keep the underlying page and its local state mounted.
  if (locationRoute.name !== "settings" && locationRoute !== pageRoute) {
    setPageRoute(locationRoute);
  }
  const route = locationRoute.name === "settings" ? pageRoute : locationRoute;
  const parentSessionId = useStore(agentsStore, (state) =>
    route.name === "agent" ? state.agents[route.id]?.parent_session_id : undefined,
  );
  useAgentsSync(route.name === "session" ? route.id : (parentSessionId ?? null));
  const daemonGeneration = useStore(daemonIdentity, (state) => state.generation);
  useEffect(() => registerWindowKeyboardShortcuts(), []);
  useEffect(watchMcp, []);
  const content =
    route.name === "dashboard" ? (
      <DashboardPage
        key={`${route.cwd ?? ""}:${route.worktree}:${route.surrogate}`}
        initialCwd={route.cwd}
        initialProtection={
          route.worktree ? (route.surrogate ? "worktree_surrogate" : "worktree") : undefined
        }
      />
    ) : route.name === "session" || route.name === "agent" ? (
      <PaneManager
        target={{ kind: route.name, id: route.id }}
        workspace={route.workspace ?? null}
        onActivate={(target) => navigate({ name: target.kind, id: target.id })}
      >
        {route.name === "session" ? (
          <SessionView sessionId={route.id} />
        ) : (
          <AgentView key={route.id} agentId={route.id} />
        )}
      </PaneManager>
    ) : route.name === "providers" ? (
      <ProvidersPage />
    ) : route.name === "usage" ? (
      <UsagePage
        key={`${route.sessionId ?? ""}|${route.projectPath ?? ""}`}
        sessionId={route.sessionId}
        projectPath={route.projectPath}
      />
    ) : route.name === "routes" ? (
      <RoutesPage />
    ) : (
      <RoutePlaceholder titleKey={routeTitleKey(route)} />
    );
  return (
    <ConnectionOverlay onRetry={connectDaemon}>
      <Shell route={route}>
        <ErrorBoundary key={daemonGeneration}>{content}</ErrorBoundary>
      </Shell>
      {locationRoute.name === "settings" && (
        <SettingsModal
          open
          initialSection={locationRoute.section}
          onClose={() => navigate(pageRoute)}
        />
      )}
      <CommandPaletteHost />
      <ShortcutSheetHost />
    </ConnectionOverlay>
  );
}

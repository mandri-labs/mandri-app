import { Folder } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CommandPalette, type PaletteAction } from "@/app/CommandPalette";
import { useStore } from "@/app/useStore";
import { flattenAgentTree } from "@/features/agents/agentTree";
import { lastSegment } from "@/features/sessions/SessionRow";
import { isTemporaryPath } from "@/lib/temporaryPath";
import { agentsStore } from "@/stores/agents";
import { panesStore, paneKey, MAX_PANES, type PaneTarget } from "@/stores/panes";
import { sessionsStore, selectByProject, UNGROUPED_PROJECT } from "@/stores/sessions";
import { sidebarPreferencesStore } from "@/stores/sidebarPreferences";
import { rootSessionIds } from "./targets";
import { PaneIdentity } from "./PaneIdentity";

export function PanePicker({
  onSelect,
  onClose,
  currentTarget,
}: {
  onSelect: (target: PaneTarget) => void;
  onClose: () => void;
  currentTarget?: PaneTarget;
}) {
  const { t } = useTranslation();
  const agents = useStore(agentsStore, (state) => state.agents);
  const loaded = useStore(agentsStore, (state) => state.loaded);
  useStore(agentsStore, (state) => state.classifiedSessionIds);
  const sessions = useStore(sessionsStore, (state) => state.sessions);
  const order = useStore(sessionsStore, (state) => state.order);
  const filters = useStore(sessionsStore, (state) => state.filters);
  const hideTemporaryFolders = useStore(
    sidebarPreferencesStore,
    (state) => state.hideTemporaryFolders,
  );
  const panes = useStore(panesStore, (state) => state.panes);
  const roots = new Set(rootSessionIds());
  const opened = new Set(panes.map((pane) => pane.sessionId));
  if (currentTarget) opened.add(paneKey(currentTarget));
  const items: PaletteAction[] = [];
  for (const group of selectByProject({ sessions, order, filters })) {
    if (hideTemporaryFolders && isTemporaryPath(group.project)) continue;
    const section = {
      id: group.project,
      label:
        group.project === UNGROUPED_PROJECT
          ? t("core.sessions.ungrouped")
          : lastSegment(group.project),
      icon: <Folder size={14} aria-hidden="true" />,
    };
    for (const session of group.sessions) {
      if (!roots.has(session.id)) continue;
      const children = flattenAgentTree(
        Object.values(agents).filter((agent) => agent.parent_session_id === session.id),
      );
      const add = (target: PaneTarget, title: string, depth: number, searchText: string) => {
        items.push({
          id: paneKey(target),
          label: title,
          section,
          depth,
          searchText,
          content: <PaneIdentity target={target} />,
          disabled: panes.length >= MAX_PANES || opened.has(paneKey(target)),
          run: () => onSelect(target),
        });
      };
      add(
        { kind: "session", id: session.id },
        session.title,
        0,
        `${session.title} ${group.project} ${children.map(({ agent }) => agent.title).join(" ")}`,
      );
      for (const { agent, depth } of children)
        add(
          { kind: "agent", id: agent.id },
          agent.title,
          depth + 1,
          `${agent.title} ${session.title} ${group.project}`,
        );
    }
  }
  return (
    <CommandPalette
      open
      onClose={onClose}
      items={items}
      title={t("core.panes.add")}
      inputLabel={t("core.panes.search")}
      placeholder={t("core.panes.search")}
      emptyLabel={t(loaded ? "core.panes.no_results" : "core.agents.loading")}
    />
  );
}

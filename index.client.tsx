import type { PluginClientContext } from "@getpaseo/plugin/client";
import { BeadsWorkspacePanel } from "./client/beads";

export default function contribute(client: PluginClientContext) {
  // Scoped to whichever workspace you're in, auto-resolved from its project.
  client.addWorkspacePanel({
    id: "beads",
    title: "Beads",
    icon: "ListChecks",
    context: "workspace",
    locations: ["workspace", "explorer"],
    Component: BeadsWorkspacePanel,
  });

  client.addCommandCenterItem({
    id: "open-beads",
    title: "Open Beads",
    icon: "ListChecks",
    keywords: ["tasks", "issues", "backlog", "bd"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("beads");
    },
  });

  return () => {};
}

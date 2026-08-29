import type { PluginContext } from "@getpaseo/plugin";
import { BeadsWorkspacePanel } from "./beads.client";
import { createBead, deleteBead, getBead, listBeads, updateBead } from "./beads.server";
import { createBeadRpc, deleteBeadRpc, getBeadRpc, listBeadsRpc, updateBeadRpc } from "./beads.shared";

export default function contribute(plugin: PluginContext) {
  plugin.handle(listBeadsRpc, listBeads);
  plugin.handle(updateBeadRpc, updateBead);
  plugin.handle(createBeadRpc, createBead);
  plugin.handle(getBeadRpc, getBead);
  plugin.handle(deleteBeadRpc, deleteBead);

  // Scoped to whichever workspace you're in, auto-resolved from its project.
  plugin.addWorkspacePanel({
    id: "beads",
    title: "Beads",
    icon: "ListChecks",
    context: "workspace",
    locations: ["workspace", "explorer"],
    Component: BeadsWorkspacePanel,
  });

  plugin.addCommandCenterItem({
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

import type { PluginServerContext } from "@getpaseo/plugin/server";
import { beadsMeta, createBead, deleteBead, getBead, initBead, listBeads, updateBead } from "./server/beads";
import {
  beadsMetaRpc,
  createBeadRpc,
  deleteBeadRpc,
  getBeadRpc,
  initBeadsRpc,
  listBeadsRpc,
  updateBeadRpc,
} from "./shared/beads";

export default function contribute(server: PluginServerContext) {
  server.handle(listBeadsRpc, listBeads);
  server.handle(updateBeadRpc, updateBead);
  server.handle(createBeadRpc, createBead);
  server.handle(getBeadRpc, getBead);
  server.handle(deleteBeadRpc, deleteBead);
  server.handle(initBeadsRpc, initBead);
  server.handle(beadsMetaRpc, beadsMeta);
  return () => {};
}

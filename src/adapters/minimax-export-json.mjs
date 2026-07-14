import { discoverJsonConversations } from "./conversation-json.mjs";

export const adapter = {
  id: "minimax-export-json",
  version: "minimax-export-json-v1",
  discover
};

function discover(channel) {
  return discoverJsonConversations(channel, {
    adapterVersion: adapter.version,
    label: "MiniMax CLI export",
    defaultProject: "MiniMax CLI",
    sourceAppVersion: "export"
  });
}

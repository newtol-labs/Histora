import { discoverJsonConversations } from "./conversation-json.mjs";

export const adapter = {
  id: "claude-export-json",
  version: "claude-export-json-v1",
  discover
};

function discover(channel) {
  return discoverJsonConversations(channel, {
    adapterVersion: adapter.version,
    label: "Claude Desktop export",
    defaultProject: "Claude Desktop",
    sourceAppVersion: "export"
  });
}

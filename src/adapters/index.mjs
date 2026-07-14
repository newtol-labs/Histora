import { adapter as accioJsonl } from "./accio-jsonl.mjs";
import { adapter as codexJsonl } from "./codex-jsonl.mjs";
import { adapter as claudeExportJson } from "./claude-export-json.mjs";
import { adapter as claudeJsonl } from "./claude-jsonl.mjs";
import { adapter as geminiJson } from "./gemini-json.mjs";
import { adapter as grokJsonl } from "./grok-jsonl.mjs";
import { adapter as hermesSqlite } from "./hermes-sqlite.mjs";
import { adapter as kimiJsonl } from "./kimi-jsonl.mjs";
import { adapter as mimoSqlite } from "./mimo-sqlite.mjs";
import { adapter as minimaxExportJson } from "./minimax-export-json.mjs";
import { adapter as openclawJson } from "./openclaw-json.mjs";
import { adapter as opencodeSqlite } from "./opencode-sqlite.mjs";
import { adapter as qoderJsonl } from "./qoder-jsonl.mjs";
import { adapter as qoderworkSqlite } from "./qoderwork-sqlite.mjs";
import { adapter as traeVscodeJson } from "./trae-vscode-json.mjs";
import { adapter as workbuddyJsonl } from "./workbuddy-jsonl.mjs";
import { adapter as zcodeSqlite } from "./zcode-sqlite.mjs";

const adapters = new Map([
  [accioJsonl.id, accioJsonl],
  [codexJsonl.id, codexJsonl],
  [claudeExportJson.id, claudeExportJson],
  [claudeJsonl.id, claudeJsonl],
  [geminiJson.id, geminiJson],
  [grokJsonl.id, grokJsonl],
  [hermesSqlite.id, hermesSqlite],
  [kimiJsonl.id, kimiJsonl],
  [mimoSqlite.id, mimoSqlite],
  [minimaxExportJson.id, minimaxExportJson],
  [openclawJson.id, openclawJson],
  [opencodeSqlite.id, opencodeSqlite],
  [qoderJsonl.id, qoderJsonl],
  [qoderworkSqlite.id, qoderworkSqlite],
  [traeVscodeJson.id, traeVscodeJson],
  [workbuddyJsonl.id, workbuddyJsonl],
  [zcodeSqlite.id, zcodeSqlite]
]);

export function getAdapter(id) {
  return adapters.get(id) || null;
}

export function supportedAdapters() {
  return [...adapters.keys()];
}

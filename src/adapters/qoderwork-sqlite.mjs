import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { extractTextContent, parseMaybeEpoch, projectNameFromPath, statSummary, titleFromMessages } from "../utils.mjs";
import { sqlString } from "../state.mjs";

export const adapter = {
  id: "qoderwork-sqlite",
  version: "qoderwork-sqlite-v1",
  discover
};

function discover(channel) {
  const dbPath = channel.source;
  if (!fs.existsSync(dbPath)) return [];
  const chats = sqliteJson(
    dbPath,
    `select c.id, c.name, c.created_at, c.updated_at, c.worktree_path,
            p.name as project_name, p.path as project_path
     from chats c
     left join projects p on p.id = c.project_id
     where c.deleted_at is null
     order by c.updated_at asc;`
  );
  const stat = statSummary(dbPath);
  return chats.map((chat) => parseChat(channel, dbPath, chat, stat));
}

function parseChat(channel, dbPath, chat, stat) {
  const rows = sqliteJson(
    dbPath,
    `select role, parts, searchable_text, created_at, updated_at, sequence
     from messages
     where chat_id = ${sqlString(chat.id)}
     order by created_at asc, sequence asc;`
  );
  const messages = rows
    .filter((row) => ["user", "assistant"].includes(row.role))
    .map((row) => {
      const parts = parseJson(row.parts);
      const content = extractTextContent(parts).trim() || String(row.searchable_text || "").trim();
      const createdAt = parseMaybeEpoch(row.created_at);
      return { role: row.role, createdAt, updatedAt: parseMaybeEpoch(row.updated_at) || createdAt, content };
    })
    .filter((message) => message.content);
  const projectSource = chat.project_name || chat.project_path || chat.worktree_path || "Qoder Work";

  return {
    channelId: channel.id,
    channelLabel: channel.label,
    client: channel.client,
    adapterVersion: adapter.version,
    sourceType: "sqlite",
    sourcePath: dbPath,
    sourceKey: `${channel.id}:${chat.id}`,
    sourceMtime: stat.sourceMtime,
    sourceSize: stat.sourceSize,
    sessionId: chat.id,
    project: projectNameFromPath(projectSource),
    title: chat.name || titleFromMessages(messages, "Qoder Work session"),
    createdAt: parseMaybeEpoch(chat.created_at) || messages[0]?.createdAt || stat.sourceMtime,
    updatedAt: parseMaybeEpoch(chat.updated_at) || messages.at(-1)?.updatedAt || stat.sourceMtime,
    sourceAppVersion: "Qoder Work",
    messages
  };
}

function parseJson(value) {
  try {
    return JSON.parse(value || "[]");
  } catch {
    return [];
  }
}

function sqliteJson(dbPath, sql) {
  const output = execFileSync("sqlite3", ["-json", dbPath, sql], { encoding: "utf8" }).trim();
  return output ? JSON.parse(output) : [];
}

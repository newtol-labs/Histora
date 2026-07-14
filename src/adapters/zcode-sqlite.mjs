import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parseMaybeEpoch, projectNameFromPath, statSummary, titleFromMessages } from "../utils.mjs";
import { sqlString } from "../state.mjs";

export const adapter = {
  id: "zcode-sqlite",
  version: "zcode-sqlite-v1",
  discover
};

function discover(channel) {
  const dbPath = channel.source;
  if (!fs.existsSync(dbPath)) return [];
  const sessions = sqliteJson(
    dbPath,
    `select id, title, version, directory, time_created, time_updated
     from session
     order by time_updated asc;`
  );
  const stat = statSummary(dbPath);
  return sessions.map((session) => parseSession(channel, dbPath, session, stat));
}

function parseSession(channel, dbPath, session, stat) {
  const messages = sqliteJson(
    dbPath,
    `select id, json_extract(data, '$.role') as role, time_created, time_updated
     from message
     where session_id = ${sqlString(session.id)}
     order by time_created asc, id asc;`
  );
  const parts = sqliteJson(
    dbPath,
    `select message_id, json_extract(data, '$.type') as type,
            json_extract(data, '$.text') as text
     from part
     where session_id = ${sqlString(session.id)}
     order by time_created asc, id asc;`
  );
  const partsByMessage = new Map();
  for (const part of parts) {
    if (part.type !== "text" || !part.text) continue;
    const texts = partsByMessage.get(part.message_id) || [];
    texts.push(part.text);
    partsByMessage.set(part.message_id, texts);
  }
  const renderedMessages = messages
    .filter((message) => ["user", "assistant"].includes(message.role))
    .map((message) => ({
      role: message.role,
      createdAt: parseMaybeEpoch(message.time_created),
      updatedAt: parseMaybeEpoch(message.time_updated),
      content: (partsByMessage.get(message.id) || []).join("\n\n").trim()
    }))
    .filter((message) => message.content);

  return {
    channelId: channel.id,
    channelLabel: channel.label,
    client: channel.client,
    adapterVersion: adapter.version,
    sourceType: "sqlite",
    sourcePath: dbPath,
    sourceKey: `${channel.id}:${session.id}`,
    sourceMtime: stat.sourceMtime,
    sourceSize: stat.sourceSize,
    sessionId: session.id,
    project: projectNameFromPath(session.directory || "ZCode"),
    title: session.title || titleFromMessages(renderedMessages, "ZCode session"),
    createdAt: parseMaybeEpoch(session.time_created) || stat.sourceMtime,
    updatedAt: parseMaybeEpoch(session.time_updated) || stat.sourceMtime,
    sourceAppVersion: session.version || "ZCode",
    messages: renderedMessages
  };
}

function sqliteJson(dbPath, sql) {
  const output = execFileSync("sqlite3", ["-json", dbPath, sql], { encoding: "utf8" }).trim();
  return output ? JSON.parse(output) : [];
}

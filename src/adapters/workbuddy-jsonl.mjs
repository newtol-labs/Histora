import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  extractTextContent,
  parseJsonLines,
  parseMaybeEpoch,
  projectNameFromPath,
  statSummary,
  titleFromMessages,
  walkFiles
} from "../utils.mjs";
import { sqlString } from "../state.mjs";

export const adapter = {
  id: "workbuddy-jsonl",
  version: "workbuddy-jsonl-v1",
  discover
};

function discover(channel) {
  const root = sourceRoot(channel.source);
  const dbPath = path.join(root, "workbuddy.db");
  const projectsPath = path.join(root, "projects");
  if (!fs.existsSync(dbPath) || !fs.existsSync(projectsPath)) return [];

  const transcripts = new Map(
    walkFiles(projectsPath, (filePath) => filePath.endsWith(".jsonl") && !filePath.includes(`${path.sep}subagents${path.sep}`))
      .map((filePath) => [path.basename(filePath, ".jsonl"), filePath])
  );
  const sessions = sqliteJson(
    dbPath,
    `select id, cwd, title, custom_title, status, created_at, updated_at, model
     from sessions
     where deleted_at is null
     order by updated_at asc;`
  );

  return sessions
    .map((session) => parseWorkBuddySession(channel, session, transcripts.get(session.id)))
    .filter(Boolean);
}

function parseWorkBuddySession(channel, session, transcriptPath) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return null;
  const messages = parseJsonLines(transcriptPath)
    .filter((row) => row.type === "message" && ["user", "assistant"].includes(row.role))
    .map((row) => ({
      role: row.role,
      createdAt: parseMaybeEpoch(row.timestamp),
      updatedAt: parseMaybeEpoch(row.timestamp),
      content: extractTextContent(row.content)
    }))
    .filter((message) => message.content.trim());
  const stat = statSummary(transcriptPath);
  const createdAt = parseMaybeEpoch(session.created_at) || messages[0]?.createdAt || stat.sourceMtime;
  const updatedAt =
    parseMaybeEpoch(session.updated_at) ||
    [...messages].reverse().find((message) => message.updatedAt)?.updatedAt ||
    createdAt;

  return {
    channelId: channel.id,
    channelLabel: channel.label,
    client: channel.client,
    adapterVersion: adapter.version,
    sourceType: "jsonl",
    sourcePath: transcriptPath,
    sourceKey: `${channel.id}:${session.id}`,
    sourceMtime: stat.sourceMtime,
    sourceSize: stat.sourceSize,
    sessionId: session.id,
    project: projectNameFromPath(session.cwd || path.dirname(transcriptPath)),
    title: session.custom_title || session.title || titleFromMessages(messages, "WorkBuddy session"),
    createdAt,
    updatedAt,
    sourceAppVersion: session.model || "WorkBuddy",
    messages
  };
}

function sourceRoot(source) {
  return path.extname(source) === ".db" ? path.dirname(source) : source;
}

function sqliteJson(dbPath, sql) {
  const output = execFileSync("sqlite3", ["-json", dbPath, sql], { encoding: "utf8" }).trim();
  return output ? JSON.parse(output) : [];
}

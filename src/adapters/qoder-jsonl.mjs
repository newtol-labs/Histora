import fs from "node:fs";
import path from "node:path";
import {
  extractTextContent,
  parseJsonLines,
  parseMaybeEpoch,
  projectNameFromPath,
  statSummary,
  titleFromMessages,
  walkFiles
} from "../utils.mjs";

export const adapter = {
  id: "qoder-jsonl",
  version: "qoder-jsonl-v1",
  discover
};

function discover(channel) {
  if (!channel.source || !fs.existsSync(channel.source)) return [];
  const files = transcriptFiles(channel.source);
  return files.map((filePath) => parseTranscript(channel, filePath)).filter(Boolean);
}

function transcriptFiles(source) {
  if (fs.statSync(source).isFile()) return source.endsWith(".jsonl") ? [source] : [];
  return walkFiles(
    source,
    (filePath) => filePath.endsWith(".jsonl") && path.basename(path.dirname(filePath)) === "transcript"
  );
}

function parseTranscript(channel, filePath) {
  const rows = parseJsonLines(filePath).filter((row) => row && typeof row === "object" && row.type !== "parse_error");
  if (!rows.length) return null;
  const messages = rows.map(messageFromRow).filter(Boolean);
  const metadata = rows.find((row) => row.type === "session_meta") || {};
  const firstMessage = messages[0];
  const lastMessage = messages.at(-1);
  const stat = statSummary(filePath);
  const sessionId =
    rows.find((row) => typeof row.sessionId === "string")?.sessionId || path.basename(filePath, ".jsonl");
  const cwd = rows.find((row) => typeof row.cwd === "string")?.cwd || "Qoder CLI";

  return {
    channelId: channel.id,
    channelLabel: channel.label,
    client: channel.client,
    adapterVersion: adapter.version,
    sourceType: "jsonl",
    sourcePath: filePath,
    sourceKey: `${channel.id}:${sessionId}`,
    sourceMtime: stat.sourceMtime,
    sourceSize: stat.sourceSize,
    sessionId,
    project: projectNameFromPath(cwd),
    title:
      metadata.data?.content?.title || metadata.data?.title || titleFromMessages(messages, "Qoder CLI session"),
    createdAt: firstMessage?.createdAt || stat.sourceMtime,
    updatedAt: lastMessage?.updatedAt || lastMessage?.createdAt || firstMessage?.createdAt || stat.sourceMtime,
    sourceAppVersion: "Qoder CLI",
    messages
  };
}

function messageFromRow(row) {
  if (!["user", "assistant"].includes(row.type)) return null;
  const role = row.message?.role || row.type;
  if (!["user", "assistant"].includes(role)) return null;
  const rawContent = row.message?.content;
  // Qoder represents tool results as user messages too. Preserve only real user prompts.
  if (role === "user" && typeof rawContent !== "string") return null;
  const content = extractTextContent(rawContent).trim();
  if (!content) return null;
  const createdAt = parseMaybeEpoch(row.timestamp);
  return { role, createdAt, updatedAt: createdAt, content };
}

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
  id: "grok-jsonl",
  version: "grok-jsonl-v1",
  discover
};

function discover(channel) {
  const summaries = walkFiles(channel.source, (filePath) => path.basename(filePath) === "summary.json");
  return summaries.map((summaryPath) => parseGrokSession(channel, summaryPath)).filter(Boolean);
}

function parseGrokSession(channel, summaryPath) {
  const sessionDir = path.dirname(summaryPath);
  const summary = readJson(summaryPath);
  if (!summary) return null;

  const updatesPath = path.join(sessionDir, "updates.jsonl");
  const historyPath = path.join(sessionDir, "chat_history.jsonl");
  const messages = fs.existsSync(updatesPath)
    ? messagesFromUpdates(updatesPath)
    : fs.existsSync(historyPath)
      ? messagesFromHistory(historyPath)
      : [];
  const sourcePath = fs.existsSync(updatesPath) ? updatesPath : summaryPath;
  const stat = statSummary(sourcePath);
  const sessionId = summary.info?.id || path.basename(sessionDir);
  const createdAt = parseMaybeEpoch(summary.created_at) || messages[0]?.createdAt || stat.sourceMtime;
  const updatedAt =
    parseMaybeEpoch(summary.updated_at || summary.last_active_at) ||
    [...messages].reverse().find((message) => message.updatedAt)?.updatedAt ||
    createdAt;

  return {
    channelId: channel.id,
    channelLabel: channel.label,
    client: channel.client,
    adapterVersion: adapter.version,
    sourceType: "jsonl",
    sourcePath,
    sourceKey: `${channel.id}:${sessionId}`,
    sourceMtime: stat.sourceMtime,
    sourceSize: stat.sourceSize,
    sessionId,
    project: projectNameFromPath(summary.info?.cwd || "Grok CLI"),
    title: summary.generated_title || titleFromMessages(messages, "Grok CLI session"),
    createdAt,
    updatedAt,
    sourceAppVersion: summary.chat_format_version || "unknown",
    messages
  };
}

function messagesFromUpdates(filePath) {
  const messages = [];
  let user = "";
  let assistant = "";
  let turnStartedAt = null;
  let lastTimestamp = null;

  const flushTurn = () => {
    if (user.trim()) {
      messages.push({
        role: "user",
        createdAt: turnStartedAt || lastTimestamp,
        updatedAt: lastTimestamp || turnStartedAt,
        content: user.trim()
      });
    }
    if (assistant.trim()) {
      messages.push({
        role: "assistant",
        createdAt: turnStartedAt || lastTimestamp,
        updatedAt: lastTimestamp || turnStartedAt,
        content: assistant.trim()
      });
    }
    user = "";
    assistant = "";
    turnStartedAt = null;
  };

  for (const row of parseJsonLines(filePath)) {
    const update = row.params?.update;
    if (!update || typeof update !== "object") continue;
    const timestamp = parseMaybeEpoch(row.timestamp);
    if (timestamp) lastTimestamp = timestamp;

    if (update.sessionUpdate === "turn_started") {
      flushTurn();
      turnStartedAt = timestamp;
      continue;
    }
    if (update.sessionUpdate === "user_message_chunk") {
      user += extractTextContent(update.content);
      continue;
    }
    if (update.sessionUpdate === "agent_message_chunk") {
      assistant += extractTextContent(update.content);
      continue;
    }
    if (update.sessionUpdate === "turn_completed") flushTurn();
  }
  flushTurn();
  return messages;
}

function messagesFromHistory(filePath) {
  return parseJsonLines(filePath)
    .filter((row) => ["user", "assistant"].includes(row.type))
    .map((row) => ({
      role: row.type,
      createdAt: parseMaybeEpoch(row.timestamp),
      updatedAt: parseMaybeEpoch(row.timestamp),
      content: extractTextContent(row.content)
    }))
    .filter((message) => message.content.trim());
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

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
  id: "kimi-jsonl",
  version: "kimi-jsonl-v1",
  discover
};

function discover(channel) {
  if (!channel.source || !fs.existsSync(channel.source)) return [];
  return walkFiles(channel.source, (filePath) => path.basename(filePath) === "state.json")
    .map((statePath) => parseSession(channel, statePath))
    .filter(Boolean);
}

function parseSession(channel, statePath) {
  const sessionDir = path.dirname(statePath);
  const state = readJson(statePath) || {};
  const transcriptPath = firstTranscriptPath(sessionDir);
  if (!transcriptPath) return null;
  let messages = parseJsonLines(transcriptPath).map(messageFromRow).filter(Boolean);
  if (!messages.length) {
    const contextPath = path.join(sessionDir, "context.jsonl");
    if (contextPath !== transcriptPath && fs.existsSync(contextPath)) {
      messages = parseJsonLines(contextPath).map(messageFromRow).filter(Boolean);
    }
  }
  const stat = statSummary(transcriptPath);
  const sessionId = state.session_id || state.sessionId || state.id || path.basename(sessionDir);
  const projectSource = state.cwd || state.work_dir || state.workDir || state.directory || "Kimi Code";

  return {
    channelId: channel.id,
    channelLabel: channel.label,
    client: channel.client,
    adapterVersion: adapter.version,
    sourceType: "jsonl",
    sourcePath: transcriptPath,
    sourceKey: `${channel.id}:${sessionId}`,
    sourceMtime: stat.sourceMtime,
    sourceSize: stat.sourceSize,
    sessionId,
    project: projectNameFromPath(projectSource),
    title: state.title || titleFromMessages(messages, "Kimi Code session"),
    createdAt:
      parseMaybeEpoch(state.created_at || state.createdAt || state.time_created) || messages[0]?.createdAt || stat.sourceMtime,
    updatedAt:
      parseMaybeEpoch(state.updated_at || state.updatedAt || state.time_updated) ||
      messages.at(-1)?.updatedAt ||
      messages.at(-1)?.createdAt ||
      stat.sourceMtime,
    sourceAppVersion: state.version || "Kimi Code",
    messages
  };
}

function firstTranscriptPath(sessionDir) {
  const candidates = [
    path.join(sessionDir, "agents", "main", "wire.jsonl"),
    path.join(sessionDir, "wire.jsonl"),
    path.join(sessionDir, "context.jsonl")
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
}

function messageFromRow(row) {
  if (!row || typeof row !== "object" || row.type === "parse_error") return null;
  const event = row.event && typeof row.event === "object" ? row.event : {};
  const params = row.params && typeof row.params === "object" ? row.params : {};
  const rawMessage = row.message || event.message || params.message || {};
  const role = normalizeRole(rawMessage.role || row.role || event.role || params.role || event.type || row.type);
  let content = rawMessage.content ?? rawMessage.text ?? row.content ?? event.content ?? params.content;
  if (!role && row.method === "prompt" && params.user_input !== undefined) {
    content = params.user_input;
    return renderMessage("user", content, row);
  }
  if (!role) return null;
  return renderMessage(role, content, row);
}

function renderMessage(role, content, row) {
  const text = extractTextContent(content).trim();
  if (!text) return null;
  const createdAt = parseMaybeEpoch(row.timestamp || row.time || row.created_at || row.createdAt);
  return { role, createdAt, updatedAt: parseMaybeEpoch(row.updated_at || row.updatedAt) || createdAt, content: text };
}

function normalizeRole(value) {
  const role = String(value || "").toLowerCase().replace(/[^a-z]/g, "");
  if (["user", "human", "usermessage", "prompt"].includes(role)) return "user";
  if (["assistant", "ai", "model", "assistantmessage", "response"].includes(role)) return "assistant";
  return "";
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

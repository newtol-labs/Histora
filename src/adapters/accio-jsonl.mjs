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
  id: "accio-jsonl",
  version: "accio-jsonl-v1",
  discover
};

function discover(channel) {
  return walkFiles(channel.source, (filePath) => filePath.endsWith(".messages.jsonl"))
    .map((filePath) => parseAccioSession(channel, filePath))
    .filter(Boolean);
}

function parseAccioSession(channel, filePath) {
  const meta = readJsonc(filePath.replace(/\.messages\.jsonl$/, ".meta.jsonc")) || {};
  const messages = parseJsonLines(filePath)
    .filter((row) => row.messageType === "normal" && ["user", "assistant"].includes(row.role))
    .map((row) => ({
      role: row.role,
      createdAt: parseMaybeEpoch(row.timestamp),
      updatedAt: parseMaybeEpoch(row.timestamp),
      content: extractTextContent(row.content)
    }))
    .filter((message) => message.content.trim());
  const stat = statSummary(filePath);
  const sessionId = meta.sessionKey || path.basename(filePath, ".messages.jsonl");
  const createdAt = parseMaybeEpoch(meta.createdAt) || messages[0]?.createdAt || stat.sourceMtime;
  const updatedAt =
    parseMaybeEpoch(meta.updatedAt || meta.lastActiveAt) ||
    [...messages].reverse().find((message) => message.updatedAt)?.updatedAt ||
    createdAt;
  const agentId = meta.agentId || path.basename(path.dirname(path.dirname(filePath)));

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
    project: projectNameFromPath(agentId),
    title: meta.label || titleFromMessages(messages, "Accio Work session"),
    createdAt,
    updatedAt,
    sourceAppVersion: "Accio Work",
    messages
  };
}

function readJsonc(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(stripJsonc(fs.readFileSync(filePath, "utf8")));
  } catch {
    return null;
  }
}

function stripJsonc(input) {
  let output = "";
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < input.length; index += 1) {
    const current = input[index];
    const next = input[index + 1];
    if (lineComment) {
      if (current === "\n") {
        lineComment = false;
        output += current;
      }
      continue;
    }
    if (blockComment) {
      if (current === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (inString) {
      output += current;
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if (current === '"') inString = false;
      continue;
    }
    if (current === '"') {
      inString = true;
      output += current;
      continue;
    }
    if (current === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (current === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    output += current;
  }
  return output.replace(/,\s*([}\]])/g, "$1");
}

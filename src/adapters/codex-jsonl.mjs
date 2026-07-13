import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  extractTextContent,
  parseJsonLines,
  projectNameFromPath,
  statSummary,
  titleFromMessages,
  walkFiles
} from "../utils.mjs";

export const adapter = {
  id: "codex-jsonl",
  version: "codex-jsonl-v2",
  discover
};

function discover(channel) {
  const files = discoverCodexFiles(channel.source);
  return files.map((filePath) => parseCodexFile(channel, filePath)).filter(Boolean);
}

function discoverCodexFiles(source) {
  if (!source || !fs.existsSync(source)) return [];
  try {
    if (fs.statSync(source).isFile()) return source.endsWith(".jsonl") ? [source] : [];
  } catch {
    return [];
  }

  const baseName = path.basename(source);
  let roots = [source];
  let codexHome = "";
  if (baseName === "sessions") {
    codexHome = path.dirname(source);
    roots = [source, path.join(codexHome, "archived_sessions")];
  } else if (isCodexHome(source)) {
    codexHome = source;
    roots = [path.join(source, "sessions"), path.join(source, "archived_sessions")];
  }

  const indexedFiles = codexHome ? indexedRolloutFiles(codexHome) : [];
  const scannedFiles = roots.flatMap((root) => walkFiles(root, (filePath) => filePath.endsWith(".jsonl")));
  return [...new Set([...indexedFiles, ...scannedFiles])].sort();
}

function isCodexHome(source) {
  return (
    fs.existsSync(path.join(source, "sessions")) ||
    fs.existsSync(path.join(source, "archived_sessions")) ||
    fs.existsSync(path.join(source, "state_5.sqlite")) ||
    fs.existsSync(path.join(source, "sqlite", "state_5.sqlite"))
  );
}

function indexedRolloutFiles(codexHome) {
  const databases = [path.join(codexHome, "state_5.sqlite"), path.join(codexHome, "sqlite", "state_5.sqlite")];
  const files = [];
  for (const database of databases) {
    if (!fs.existsSync(database)) continue;
    try {
      const output = execFileSync("sqlite3", ["-json", database, "select rollout_path from threads;"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5000
      }).trim();
      const rows = output ? JSON.parse(output) : [];
      for (const row of rows) {
        const filePath = row?.rollout_path;
        if (typeof filePath === "string" && filePath.endsWith(".jsonl") && fs.existsSync(filePath)) {
          files.push(filePath);
        }
      }
    } catch {
      continue;
    }
  }
  return files;
}

function parseCodexFile(channel, filePath) {
  const rows = parseJsonLines(filePath);
  const meta = rows.find((row) => row.type === "session_meta")?.payload || {};
  const messages = [];
  let createdAt = meta.timestamp || null;
  let updatedAt = meta.timestamp || null;

  for (const row of rows) {
    const timestamp = row.timestamp || row.payload?.timestamp || null;
    if (timestamp && (!createdAt || timestamp < createdAt)) createdAt = timestamp;
    if (timestamp && (!updatedAt || timestamp > updatedAt)) updatedAt = timestamp;

    if (row.type !== "response_item") continue;
    const payload = row.payload || {};
    if (payload.type !== "message") continue;
    if (!["user", "assistant"].includes(payload.role)) continue;
    const content = extractTextContent(payload.content);
    if (!content.trim()) continue;
    messages.push({
      role: payload.role,
      createdAt: timestamp,
      updatedAt: timestamp,
      content
    });
  }

  const stat = statSummary(filePath);
  const sessionId = meta.id || path.basename(filePath, ".jsonl");
  const cwd = meta.cwd || rows.find((row) => row.type === "turn_context")?.payload?.cwd || "";
  const project = projectNameFromPath(cwd);

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
    project,
    title: titleFromMessages(messages, path.basename(filePath, ".jsonl")),
    createdAt: createdAt || stat.sourceMtime,
    updatedAt: updatedAt || stat.sourceMtime,
    sourceAppVersion: meta.cli_version || "unknown",
    messages
  };
}

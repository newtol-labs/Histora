import fs from "node:fs";
import path from "node:path";
import { parseMaybeEpoch, projectNameFromPath, statSummary, titleFromMessages } from "../utils.mjs";

export const adapter = {
  id: "trae-vscode-json",
  version: "trae-vscode-json-v1",
  discover
};

function discover(channel) {
  const roots = traeRoots(channel.source);
  return roots.flatMap((root) => discoverRoot(channel, root));
}

function discoverRoot(channel, appRoot) {
  const storageRoot = path.join(appRoot, "User", "workspaceStorage");
  if (!fs.existsSync(storageRoot)) return [];
  const records = [];
  for (const entry of fs.readdirSync(storageRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const workspaceDir = path.join(storageRoot, entry.name);
    const chatRoot = path.join(workspaceDir, "chatSessions");
    if (!fs.existsSync(chatRoot)) continue;
    const project = projectForWorkspace(workspaceDir);
    for (const chat of fs.readdirSync(chatRoot, { withFileTypes: true })) {
      if (!chat.isFile() || !chat.name.endsWith(".json")) continue;
      const record = parseChatFile(channel, path.join(chatRoot, chat.name), project, path.basename(appRoot));
      if (record) records.push(record);
    }
  }
  return records;
}

function parseChatFile(channel, filePath, project, appName) {
  const session = readJson(filePath);
  if (!session || typeof session !== "object") return null;
  const messages = [];
  for (const request of Array.isArray(session.requests) ? session.requests : []) {
    const userContent = textFrom(request.message || request.userMessage || request.prompt);
    const createdAt = parseMaybeEpoch(request.timestamp || request.createdAt || request.time);
    if (userContent) messages.push({ role: "user", createdAt, updatedAt: createdAt, content: userContent });

    const assistantContent = textFrom(request.response || request.responseParts || request.result);
    const updatedAt = parseMaybeEpoch(request.response?.timestamp || request.updatedAt || request.timestamp) || createdAt;
    if (assistantContent) messages.push({ role: "assistant", createdAt: updatedAt, updatedAt, content: assistantContent });
  }
  const stat = statSummary(filePath);
  const sessionId = session.sessionId || session.id || path.basename(filePath, ".json");

  return {
    channelId: channel.id,
    channelLabel: channel.label,
    client: channel.client,
    adapterVersion: adapter.version,
    sourceType: "json",
    sourcePath: filePath,
    sourceKey: `${channel.id}:${sessionId}`,
    sourceMtime: stat.sourceMtime,
    sourceSize: stat.sourceSize,
    sessionId,
    project,
    title: session.customTitle || session.title || titleFromMessages(messages, "Trae session"),
    createdAt: parseMaybeEpoch(session.creationDate || session.createdAt) || messages[0]?.createdAt || stat.sourceMtime,
    updatedAt:
      parseMaybeEpoch(session.lastMessageDate || session.updatedAt) ||
      messages.at(-1)?.updatedAt ||
      messages.at(-1)?.createdAt ||
      stat.sourceMtime,
    sourceAppVersion: appName,
    messages
  };
}

function traeRoots(source) {
  if (!source || !fs.existsSync(source)) return [];
  const root = path.resolve(source);
  const name = path.basename(root).toLowerCase();
  if (["trae cn", "trae solo"].includes(name)) {
    const parent = path.dirname(root);
    return [path.join(parent, "Trae CN"), path.join(parent, "TRAE SOLO")].filter(fs.existsSync);
  }
  return [root];
}

function projectForWorkspace(workspaceDir) {
  const workspace = readJson(path.join(workspaceDir, "workspace.json")) || {};
  const folder = workspace.folder || workspace.workspace?.folder || "Trae";
  return projectNameFromPath(decodeFileUrl(String(folder)));
}

function decodeFileUrl(value) {
  if (!value.startsWith("file://")) return value;
  try {
    return decodeURIComponent(value.replace(/^file:\/\//, ""));
  } catch {
    return value;
  }
}

function textFrom(value) {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map(textFrom).filter(Boolean).join("\n\n").trim();
  if (!value || typeof value !== "object") return "";
  for (const key of ["text", "value", "markdown", "content", "message", "parts"]) {
    const text = textFrom(value[key]);
    if (text) return text;
  }
  return "";
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

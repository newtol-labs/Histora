import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { defaultCodexHome } from "./codex-storage.mjs";
import { displayPath, expandHome } from "./utils.mjs";

export function detectAgents(config = {}) {
  const channels = new Map((config.channels || []).map((channel) => [channel.id, channel]));
  return agentDefinitions().map((definition) => detectAgent(definition, channels.get(definition.id)));
}

export function applyDetectedSources(config) {
  const detected = new Map(detectAgents(config).map((agent) => [agent.id, agent]));
  return {
    ...config,
    channels: (config.channels || []).map((channel) => {
      const agent = detected.get(channel.id);
      if (!agent) return channel;
      return {
        ...channel,
        adapter: channel.adapter || agent.adapter,
        source: channel.source || agent.rawSyncableSource || ""
      };
    })
  };
}

function detectAgent(definition, channel = {}) {
  const commandPath = firstCommand(definition.commands || []);
  const appPath = firstExisting(definition.apps || []);
  const configuredSource = channel.source || "";
  const sourceCandidates = [configuredSource, ...(definition.sources || [])].filter(Boolean).map(expandHome);
  const detectedSource = firstExisting(sourceCandidates);
  const syncableSource = isSyncablePath(detectedSource, definition) ? detectedSource : "";
  const installed = Boolean(commandPath || appPath || detectedSource);
  const sourcePath = configuredSource || detectedSource || definition.sources?.[0] || "";

  return {
    id: definition.id,
    label: definition.label,
    client: definition.client,
    adapter: channel.adapter || definition.adapter,
    installed,
    commandPath: displayPath(commandPath),
    appPath: displayPath(appPath),
    rawDetectedSource: detectedSource,
    rawSyncableSource: syncableSource,
    sourcePath: displayPath(sourcePath),
    detectedSource: displayPath(detectedSource),
    syncableSource: displayPath(syncableSource),
    sourceExists: Boolean(configuredSource && fs.existsSync(expandHome(configuredSource))),
    detectedSourceExists: Boolean(detectedSource),
    syncable: Boolean(syncableSource),
    note: noteFor(definition, installed, syncableSource)
  };
}

function agentDefinitions() {
  return [
    {
      id: "codex",
      label: "ChatGPT Codex",
      client: "ChatGPT Desktop/CLI",
      adapter: "codex-jsonl",
      commands: ["codex"],
      apps: macApps("ChatGPT.app", "Codex.app"),
      sources: [defaultCodexHome()]
    },
    {
      id: "claude-code",
      label: "Claude Code",
      client: "CLI",
      adapter: "claude-jsonl",
      commands: ["claude"],
      apps: macApps("Claude Code URL Handler.app"),
      sources: ["~/.claude/projects"]
    },
    {
      id: "claude-desktop",
      label: "Claude Desktop (Export)",
      client: "Desktop export",
      adapter: "claude-export-json",
      apps: macApps("Claude.app"),
      sources: [],
      noteWhenInstalledWithoutSource:
        "Claude Desktop 会话应通过导出文件导入 / Import Claude Desktop sessions from an export file."
    },
    {
      id: "opencode",
      label: "OpenCode",
      client: "CLI",
      adapter: "opencode-sqlite",
      commands: ["opencode"],
      sources: [defaultOpenCodePath()]
    },
    {
      id: "gemini-cli",
      label: "Gemini CLI",
      client: "CLI",
      adapter: "gemini-json",
      commands: ["gemini"],
      sources: ["~/.gemini/sessions", "~/.gemini/history.jsonl", "~/Downloads/gemini-export.json"],
      noteWhenInstalledWithoutSource:
        "已检测到 Gemini CLI；未找到默认会话导出路径 / Gemini CLI detected; no default session export found."
    },
    {
      id: "openclaw",
      label: "OpenClaw",
      client: "CLI",
      adapter: "openclaw-json",
      commands: ["openclaw"],
      sources: ["~/.openclaw/sessions", "~/.openclaw/history.jsonl", "~/Downloads/openclaw-export.json"]
    },
    {
      id: "hermes-agent",
      label: "Hermes Agent",
      client: "CLI/Desktop",
      adapter: "hermes-sqlite",
      commands: ["hermes"],
      apps: macApps("Hermes.app"),
      sources: ["~/.hermes/state.db"]
    },
    {
      id: "grok-cli",
      label: "Grok CLI",
      client: "CLI",
      adapter: "grok-jsonl",
      commands: ["grok"],
      sources: ["~/.grok/sessions"]
    },
    {
      id: "accio-work",
      label: "Accio Work",
      client: "Desktop",
      adapter: "accio-jsonl",
      apps: macApps("Accio.app"),
      sources: ["~/.accio/accounts"]
    },
    {
      id: "workbuddy",
      label: "WorkBuddy",
      client: "Desktop",
      adapter: "workbuddy-jsonl",
      apps: macApps("WorkBuddy.app", "Workbuddy.app"),
      sources: ["~/.workbuddy"]
    },
    {
      id: "zcode",
      label: "ZCode",
      client: "Desktop/CLI",
      adapter: "zcode-sqlite",
      apps: macApps("ZCode.app"),
      commands: ["zcode"],
      sources: ["~/.zcode/cli/db/db.sqlite"]
    },
    {
      id: "kimi-code",
      label: "Kimi Code",
      client: "CLI",
      adapter: "kimi-jsonl",
      commands: ["kimi"],
      sources: ["~/.kimi-code/sessions", "~/.kimi/sessions"]
    },
    {
      id: "mimo-code",
      label: "Mimo Code",
      client: "CLI",
      adapter: "mimo-sqlite",
      commands: ["mimo"],
      sources: ["~/.local/share/mimocode/mimocode.db"]
    },
    {
      id: "qoder-cli",
      label: "Qoder CLI",
      client: "CLI",
      adapter: "qoder-jsonl",
      commands: ["qodercli", "qoder"],
      sources: ["~/.qoder/projects"]
    },
    {
      id: "qoder-work",
      label: "Qoder Work",
      client: "Desktop",
      adapter: "qoderwork-sqlite",
      apps: macApps("QoderWork.app"),
      sources: ["~/Library/Application Support/QoderWork/data/agents.db"]
    },
    {
      id: "trae",
      label: "Trae",
      client: "Desktop",
      adapter: "trae-vscode-json",
      apps: macApps("Trae CN.app", "TRAE SOLO.app", "Trae.app"),
      sources: ["~/Library/Application Support/Trae CN", "~/Library/Application Support/TRAE SOLO"]
    },
    {
      id: "minimax-cli",
      label: "MiniMax CLI (Import)",
      client: "CLI export",
      adapter: "minimax-export-json",
      commands: ["mmx"],
      sources: [],
      noteWhenInstalledWithoutSource:
        "MiniMax CLI 已安装；当前版本未提供可自动读取的本地会话库，请配置导出的 JSON/JSONL 文件。"
    }
  ];
}

function noteFor(definition, installed, syncableSource) {
  if (syncableSource) return "可同步 / Syncable";
  if (installed && definition.noteWhenInstalledWithoutSource) return definition.noteWhenInstalledWithoutSource;
  if (installed) return "已安装，但未找到可同步来源 / Installed, no syncable source found";
  return "未检测到安装 / Not detected";
}

function isSyncablePath(filePath, definition) {
  if (!filePath) return false;
  if (definition.id === "gemini-cli") return fs.statSync(filePath).isDirectory() || /\.(json|jsonl)$/i.test(filePath);
  return true;
}

function macApps(...names) {
  if (process.platform !== "darwin") return [];
  return names.flatMap((name) => [path.join("/Applications", name), path.join(os.homedir(), "Applications", name)]);
}

function defaultOpenCodePath() {
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, "opencode", "opencode.db");
  }
  return "~/.local/share/opencode/opencode.db";
}

function firstExisting(candidates) {
  return candidates.map(expandHome).find((candidate) => candidate && fs.existsSync(candidate)) || "";
}

function firstCommand(commands) {
  for (const command of commands) {
    try {
      const tool = process.platform === "win32" ? "where" : "which";
      const output = execFileSync(tool, [command], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean);
      if (output) return output;
    } catch {
      continue;
    }
  }
  return "";
}

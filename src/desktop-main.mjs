import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, dialog, Menu, shell } from "electron";
import { defaultCodexHome } from "./codex-storage.mjs";
import { CONFIG_FILE, LEGACY_CONFIG_FILE, readConfig, renderConfig } from "./config.mjs";
import { installLaunchd, launchdPlistPath } from "./launchd.mjs";
import { runSync } from "./sync.mjs";
import { ensureDir } from "./utils.mjs";
import { startServer } from "./server.mjs";
import { createUpdater } from "./updater.mjs";
import { hasWorkspaceConfig, managedWorkspaceRoot, migrateWorkspace } from "./workspace.mjs";

const isSyncOnly = process.argv.includes("--histora-sync") || process.argv.includes("--chathub-sync");

if (!app.requestSingleInstanceLock() && !isSyncOnly) {
  app.quit();
}

app.setName("Histora");

if (isSyncOnly) {
  runSyncOnly();
} else {
  let mainWindow = null;
  let serverHandle = null;
  let updater = null;

  const openMainWindow = () => {
    if (!serverHandle) return null;
    mainWindow = createWindow(serverHandle.url);
    mainWindow.on("closed", () => {
      mainWindow = null;
    });
    return mainWindow;
  };

  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      openMainWindow();
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    const workspace = resolveWorkspace();
    const workspaceRoot = workspace.root;
    ensureDesktopWorkspace(workspaceRoot);
    const schedulerOptions = desktopSchedulerOptions();
    if (workspace.migrated && app.isPackaged && fs.existsSync(launchdPlistPath())) {
      installLaunchd(workspaceRoot, schedulerOptions);
    }
    updater = createUpdater({ app, shell, isPackaged: app.isPackaged });
    serverHandle = await startServer({
      root: workspaceRoot,
      publicDir: path.join(app.getAppPath(), "public"),
      port: 0,
      updater,
      schedulerOptions,
      openPath: openDesktopPath
    });

    openMainWindow();
    setApplicationMenu(mainWindow, workspaceRoot, updater);
    updater.autoCheck();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      openMainWindow();
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", () => {
    serverHandle?.server?.close();
  });
}

async function runSyncOnly() {
  let exitCode = 0;
  const timer = setTimeout(() => {
    console.error("[Histora sync] timed out after 10 minutes");
    app.exit(124);
    process.exit(124);
  }, 10 * 60 * 1000);
  timer.unref?.();

  try {
    const workspaceRoot = resolveWorkspace().root;
    console.log(`[Histora sync] start ${new Date().toISOString()} root=${workspaceRoot}`);
    ensureDesktopWorkspace(workspaceRoot);
    const run = await runSync({ root: workspaceRoot });
    console.log(JSON.stringify(run.summary, null, 2));
    console.log(`[Histora sync] finish ${run.finishedAt} status=${run.status}`);
  } catch (error) {
    exitCode = 1;
    console.error(error.stack || error.message);
  } finally {
    clearTimeout(timer);
    app.exit(exitCode);
    process.exit(exitCode);
  }
}

function createWindow(url) {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 660,
    title: "Histora",
    backgroundColor: "#f7f8fa",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  window.loadURL(url);
  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  return window;
}

function setApplicationMenu(window, workspaceRoot, updater) {
  const template = [
    {
      label: "Histora",
      submenu: [
        {
          label: "Open Histora Folder / 打开 Histora 文件夹",
          click: () => openDesktopPath(workspaceRoot).catch(showOpenError)
        },
        {
          label: "Reload / 重新载入",
          accelerator: "CmdOrCtrl+R",
          click: () => window.reload()
        },
        {
          label: "Check for Updates / 检查更新",
          click: () => updater?.check()
        },
        { type: "separator" },
        {
          label: "Quit / 退出",
          accelerator: "CmdOrCtrl+Q",
          click: () => app.quit()
        }
      ]
    },
    {
      label: "View / 视图",
      submenu: [
        { role: "toggleDevTools", label: "Developer Tools / 开发者工具" },
        { role: "resetZoom", label: "Actual Size / 实际大小" },
        { role: "zoomIn", label: "Zoom In / 放大" },
        { role: "zoomOut", label: "Zoom Out / 缩小" }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function openDesktopPath(target) {
  const error = await shell.openPath(target);
  if (error) throw new Error(error);
}

function showOpenError(error) {
  dialog.showErrorBox(
    "无法打开 / Unable to Open",
    error?.message || String(error)
  );
}

function resolveWorkspace() {
  if (process.env.HISTORA_WORKSPACE) return { root: path.resolve(process.env.HISTORA_WORKSPACE), migrated: false };
  if (process.env.CHATHUB_WORKSPACE) return { root: path.resolve(process.env.CHATHUB_WORKSPACE), migrated: false };
  if (app.isPackaged) return resolvePackagedWorkspace();
  return { root: process.cwd(), migrated: false };
}

function resolvePackagedWorkspace() {
  const root = managedWorkspaceRoot(app.getPath("userData"));
  if (hasWorkspaceConfig(root)) return { root, migrated: false };
  const documents = app.getPath("documents");
  const candidates = [
    path.join(documents, "Chathub"),
    path.join(documents, "Histora")
  ];
  const legacyRoot = candidates.find(hasWorkspaceConfig);
  return legacyRoot ? migrateWorkspace(legacyRoot, root) : { root, migrated: false };
}

function desktopSchedulerOptions() {
  if (!app.isPackaged) return {};
  return {
    runner: {
      programArguments: [app.getPath("exe"), "--histora-sync"]
    }
  };
}

function ensureDesktopWorkspace(workspaceRoot) {
  ensureDir(workspaceRoot);
  const configPath = path.join(workspaceRoot, CONFIG_FILE);
  const legacyConfigPath = path.join(workspaceRoot, LEGACY_CONFIG_FILE);
  if (fs.existsSync(legacyConfigPath)) return;
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, renderConfig(defaultConfig(workspaceRoot)), "utf8");
    return;
  }
  const config = readConfig(workspaceRoot);
  const existing = new Set(config.channels.map((channel) => channel.id));
  const additions = defaultConfig(workspaceRoot).channels.filter((channel) => !existing.has(channel.id));
  if (!additions.length) return;
  fs.writeFileSync(configPath, renderConfig({ ...config, channels: [...config.channels, ...additions] }), "utf8");
}

function defaultConfig(workspaceRoot) {
  return {
    workspace: workspaceRoot,
    sync: {
      schedule: "23:00",
      cadence: "daily",
      interval_minutes: 0,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      redact: true
    },
    channels: [
      {
        id: "codex",
        label: "ChatGPT Codex",
        client: "ChatGPT Desktop/CLI",
        adapter: "codex-jsonl",
        source: defaultCodexHome(),
        enabled: true
      },
      {
        id: "claude-code",
        label: "Claude Code",
        client: "CLI",
        adapter: "claude-jsonl",
        source: "~/.claude/projects",
        enabled: true
      },
      {
        id: "claude-desktop",
        label: "Claude Desktop (Export)",
        client: "Desktop export",
        adapter: "claude-export-json",
        source: "",
        enabled: false
      },
      {
        id: "opencode",
        label: "OpenCode",
        client: "CLI",
        adapter: "opencode-sqlite",
        source: defaultOpenCodePath(),
        enabled: true
      },
      {
        id: "gemini-cli",
        label: "Gemini CLI",
        client: "CLI",
        adapter: "gemini-json",
        source: defaultGeminiCliPath(),
        enabled: true
      },
      {
        id: "openclaw",
        label: "OpenClaw",
        client: "CLI",
        adapter: "openclaw-json",
        source: defaultOpenClawPath(),
        enabled: true
      },
      {
        id: "hermes-agent",
        label: "Hermes Agent",
        client: "CLI/Desktop",
        adapter: "hermes-sqlite",
        source: defaultHermesPath(),
        enabled: true
      },
      {
        id: "grok-cli",
        label: "Grok CLI",
        client: "CLI",
        adapter: "grok-jsonl",
        source: defaultGrokCliPath(),
        enabled: true
      },
      {
        id: "accio-work",
        label: "Accio Work",
        client: "Desktop",
        adapter: "accio-jsonl",
        source: defaultAccioWorkPath(),
        enabled: true
      },
      {
        id: "workbuddy",
        label: "WorkBuddy",
        client: "Desktop",
        adapter: "workbuddy-jsonl",
        source: defaultWorkBuddyPath(),
        enabled: true
      },
      {
        id: "zcode",
        label: "ZCode",
        client: "Desktop/CLI",
        adapter: "zcode-sqlite",
        source: defaultZCodePath(),
        enabled: true
      },
      {
        id: "kimi-code",
        label: "Kimi Code",
        client: "CLI",
        adapter: "kimi-jsonl",
        source: defaultKimiCodePath(),
        enabled: true
      },
      {
        id: "mimo-code",
        label: "Mimo Code",
        client: "CLI",
        adapter: "mimo-sqlite",
        source: defaultMimoCodePath(),
        enabled: true
      },
      {
        id: "qoder-cli",
        label: "Qoder CLI",
        client: "CLI",
        adapter: "qoder-jsonl",
        source: defaultQoderCliPath(),
        enabled: true
      },
      {
        id: "qoder-work",
        label: "Qoder Work",
        client: "Desktop",
        adapter: "qoderwork-sqlite",
        source: defaultQoderWorkPath(),
        enabled: true
      },
      {
        id: "trae",
        label: "Trae",
        client: "Desktop",
        adapter: "trae-vscode-json",
        source: defaultTraePath(),
        enabled: true
      },
      {
        id: "minimax-cli",
        label: "MiniMax CLI (Import)",
        client: "CLI export",
        adapter: "minimax-export-json",
        source: "",
        enabled: false
      }
    ]
  };
}

function defaultOpenCodePath() {
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, "opencode", "opencode.db");
  }
  return "~/.local/share/opencode/opencode.db";
}

function defaultGeminiCliPath() {
  return "~/.gemini/sessions";
}

function defaultOpenClawPath() {
  return "~/.openclaw/sessions";
}

function defaultHermesPath() {
  return "~/.hermes/state.db";
}

function defaultGrokCliPath() {
  return "~/.grok/sessions";
}

function defaultAccioWorkPath() {
  return "~/.accio/accounts";
}

function defaultWorkBuddyPath() {
  return "~/.workbuddy";
}

function defaultZCodePath() {
  return "~/.zcode/cli/db/db.sqlite";
}

function defaultKimiCodePath() {
  return "~/.kimi-code/sessions";
}

function defaultMimoCodePath() {
  return "~/.local/share/mimocode/mimocode.db";
}

function defaultQoderCliPath() {
  return "~/.qoder/projects";
}

function defaultQoderWorkPath() {
  return "~/Library/Application Support/QoderWork/data/agents.db";
}

function defaultTraePath() {
  return "~/Library/Application Support/Trae CN";
}

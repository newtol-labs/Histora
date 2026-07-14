import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { adapter as codexJsonlAdapter } from "./adapters/codex-jsonl.mjs";
import { adapter as accioJsonlAdapter } from "./adapters/accio-jsonl.mjs";
import { adapter as geminiJsonAdapter } from "./adapters/gemini-json.mjs";
import { adapter as grokJsonlAdapter } from "./adapters/grok-jsonl.mjs";
import { adapter as hermesSqliteAdapter } from "./adapters/hermes-sqlite.mjs";
import { adapter as kimiJsonlAdapter } from "./adapters/kimi-jsonl.mjs";
import { adapter as mimoSqliteAdapter } from "./adapters/mimo-sqlite.mjs";
import { adapter as openclawJsonAdapter } from "./adapters/openclaw-json.mjs";
import { adapter as qoderJsonlAdapter } from "./adapters/qoder-jsonl.mjs";
import { adapter as qoderworkSqliteAdapter } from "./adapters/qoderwork-sqlite.mjs";
import { adapter as traeVscodeJsonAdapter } from "./adapters/trae-vscode-json.mjs";
import { adapter as workbuddyJsonlAdapter } from "./adapters/workbuddy-jsonl.mjs";
import { adapter as zcodeSqliteAdapter } from "./adapters/zcode-sqlite.mjs";
import { detectAgents } from "./discovery.mjs";
import { CONFIG_FILE, LEGACY_CONFIG_FILE, parseConfig, updateSyncConfig } from "./config.mjs";
import { assertSafeBackgroundWorkspace, launchdRunner } from "./launchd.mjs";
import { renderSessionMarkdown } from "./markdown.mjs";
import { ensureState } from "./state.mjs";
import { normalizeRecord } from "./sync.mjs";
import { readConfig } from "./config.mjs";
import { migrateWorkspace } from "./workspace.mjs";

const parsed = parseConfig(`
workspace: /tmp/histora
sync:
  schedule: "23:00"
  cadence: interval
  interval_minutes: 30
  redact: true
channels:
  - id: codex
    label: Codex
    enabled: true
`);

assert.equal(parsed.workspace, "/tmp/histora");
assert.equal(parsed.sync.schedule, "23:00");
assert.equal(parsed.sync.cadence, "interval");
assert.equal(parsed.sync.interval_minutes, 30);
assert.equal(parsed.sync.redact, true);
assert.equal(parsed.channels[0].id, "codex");
assert.equal(parsed.channels[0].enabled, true);

const normalized = normalizeRecord(
  {
    project: "Test",
    title: "Secret",
    messages: [
      {
        role: "user",
        content: "token: abcdefghijklmnopqrstuvwxyz"
      },
      {
        role: "system",
        content: "hidden"
      }
    ]
  },
  { sync: { redact: true } }
);
assert.equal(normalized.messages.length, 1);
assert.match(normalized.messages[0].content, /\[REDACTED\]/);

const markdown = renderSessionMarkdown(
  {
    channelLabel: "Codex",
    client: "CLI",
    project: "Test",
    sessionId: "abc",
    title: "Hello",
    sourceType: "jsonl",
    sourcePath: "/tmp/source.jsonl",
    sourceAppVersion: "1.0.0",
    adapterVersion: "test-v1",
    createdAt: "2026-06-03T00:00:00.000Z",
    updatedAt: "2026-06-03T00:00:00.000Z",
    messages: [{ role: "user", createdAt: "2026-06-03T00:00:00.000Z", content: "Hi" }]
  },
  1,
  "hash",
  "2026-06-03T01:00:00.000Z"
);
assert.match(markdown, /^---/);
assert.match(markdown, /histora_schema: 1/);
assert.match(markdown, /version: 1/);
assert.match(markdown, /### User/);

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "histora-test-"));
fs.writeFileSync(
  path.join(tempRoot, LEGACY_CONFIG_FILE),
  `workspace: ${tempRoot}

sync:
  schedule: "23:00"
  cadence: daily
  interval_minutes: 0
  timezone: Asia/Shanghai
  redact: true

channels:
  - id: codex
    label: Codex
    client: CLI/Desktop
    adapter: codex-jsonl
    source: ~/.codex/sessions
    enabled: true
`,
  "utf8"
);
const updatedConfig = updateSyncConfig(tempRoot, { cadence: "interval", intervalMinutes: 17, schedule: "7:05" });
assert.equal(updatedConfig.sync.cadence, "interval");
assert.equal(updatedConfig.sync.interval_minutes, 17);
assert.equal(updatedConfig.sync.schedule, "07:05");

const state = ensureState(tempRoot);
assert.ok(fs.existsSync(state.db));

const codexHome = path.join(tempRoot, ".codex");
const activeCodexDir = path.join(codexHome, "sessions", "2026", "07", "14");
const archivedCodexDir = path.join(codexHome, "archived_sessions");
const relocatedCodexDir = path.join(codexHome, "relocated_threads");
fs.mkdirSync(activeCodexDir, { recursive: true });
fs.mkdirSync(archivedCodexDir, { recursive: true });
fs.mkdirSync(relocatedCodexDir, { recursive: true });
writeCodexSession(path.join(activeCodexDir, "active.jsonl"), "codex-active", "Active Codex task");
writeCodexSession(path.join(archivedCodexDir, "archived.jsonl"), "codex-archived", "Archived Codex task");
const relocatedCodexPath = path.join(relocatedCodexDir, "relocated.jsonl");
writeCodexSession(relocatedCodexPath, "codex-relocated", "Relocated Codex task");
const codexIndexDir = path.join(codexHome, "sqlite");
const codexIndex = path.join(codexIndexDir, "state_5.sqlite");
fs.mkdirSync(codexIndexDir, { recursive: true });
execFileSync("sqlite3", [codexIndex, `create table threads (rollout_path text); insert into threads values ('${relocatedCodexPath}');`]);

const codexHomeRecords = codexJsonlAdapter.discover({
  id: "codex",
  label: "ChatGPT Codex",
  client: "ChatGPT Desktop/CLI",
  source: codexHome
});
assert.deepEqual(codexHomeRecords.map((record) => record.sessionId).sort(), [
  "codex-active",
  "codex-archived",
  "codex-relocated"
]);
assert.ok(codexHomeRecords.every((record) => record.adapterVersion === "codex-jsonl-v2"));

const legacyCodexRecords = codexJsonlAdapter.discover({
  id: "codex",
  label: "Codex",
  client: "CLI/Desktop",
  source: path.join(codexHome, "sessions")
});
assert.deepEqual(legacyCodexRecords.map((record) => record.sessionId).sort(), [
  "codex-active",
  "codex-archived",
  "codex-relocated"
]);

const geminiExportPath = path.join(tempRoot, "gemini-export.json");
fs.writeFileSync(
  geminiExportPath,
  JSON.stringify({
    conversations: [
      {
        id: "gemini-session-1",
        title: "Gemini CLI export test",
        project_name: "Gemini Project",
        messages: [
          { role: "user", content: "Hello Gemini", created_at: "2026-06-03T00:00:00.000Z" },
          { role: "assistant", content: "Hello from Gemini", created_at: "2026-06-03T00:01:00.000Z" }
        ]
      }
    ]
  }),
  "utf8"
);
const geminiRecords = geminiJsonAdapter.discover({
  id: "gemini-cli",
  label: "Gemini CLI",
  client: "CLI",
  source: geminiExportPath
});
assert.equal(geminiRecords.length, 1);
assert.equal(geminiRecords[0].adapterVersion, "gemini-json-v1");
assert.equal(geminiRecords[0].project, "Gemini Project");
assert.equal(geminiRecords[0].messages.length, 2);

const openclawPath = path.join(tempRoot, "openclaw.jsonl");
fs.writeFileSync(
  openclawPath,
  [
    JSON.stringify({ session_id: "openclaw-1", role: "user", content: "Hello OpenClaw", timestamp: 1780502400 }),
    JSON.stringify({ session_id: "openclaw-1", role: "assistant", content: "Hello from OpenClaw", timestamp: 1780502460 })
  ].join("\n"),
  "utf8"
);
const openclawRecords = openclawJsonAdapter.discover({
  id: "openclaw",
  label: "OpenClaw",
  client: "CLI",
  source: openclawPath
});
assert.equal(openclawRecords.length, 1);
assert.equal(openclawRecords[0].adapterVersion, "openclaw-json-v1");
assert.equal(openclawRecords[0].messages.length, 2);

const hermesDb = path.join(tempRoot, "hermes-state.db");
execFileSync("sqlite3", [
  hermesDb,
  `create table sessions (
      id text primary key, source text, model text, title text, cwd text,
      started_at real, ended_at real, end_reason text, message_count integer
    );
    create table messages (
      id integer primary key autoincrement, session_id text, role text, content text,
      timestamp real, active integer default 1
    );
    insert into sessions (id, source, model, title, cwd, started_at, ended_at, message_count)
      values ('hermes-1', 'cli', 'test-model', 'Hermes export test', '/tmp/demo', 1780502400, 1780502460, 2);
    insert into messages (session_id, role, content, timestamp, active)
      values ('hermes-1', 'user', 'Hello Hermes', 1780502400, 1),
             ('hermes-1', 'assistant', 'Hello from Hermes', 1780502460, 1);`
]);
const hermesRecords = hermesSqliteAdapter.discover({
  id: "hermes-agent",
  label: "Hermes Agent",
  client: "CLI/Desktop",
  source: hermesDb
});
assert.equal(hermesRecords.length, 1);
assert.equal(hermesRecords[0].adapterVersion, "hermes-sqlite-v1");
assert.equal(hermesRecords[0].messages.length, 2);

const grokSessions = path.join(tempRoot, ".grok", "sessions", "%2Ftmp", "grok-session-1");
fs.mkdirSync(grokSessions, { recursive: true });
fs.writeFileSync(
  path.join(grokSessions, "summary.json"),
  JSON.stringify({
    info: { id: "grok-session-1", cwd: "/tmp/grok-project" },
    generated_title: "Grok adapter test",
    created_at: "2026-07-14T00:00:00.000Z",
    updated_at: "2026-07-14T00:02:00.000Z",
    chat_format_version: "1"
  }),
  "utf8"
);
fs.writeFileSync(
  path.join(grokSessions, "updates.jsonl"),
  [
    { timestamp: "2026-07-14T00:00:00.000Z", params: { update: { sessionUpdate: "turn_started" } } },
    {
      timestamp: "2026-07-14T00:00:01.000Z",
      params: { update: { sessionUpdate: "user_message_chunk", content: { type: "text", text: "Hello" } } }
    },
    {
      timestamp: "2026-07-14T00:00:02.000Z",
      params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hi" } } }
    },
    {
      timestamp: "2026-07-14T00:00:03.000Z",
      params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: " there" } } }
    },
    { timestamp: "2026-07-14T00:00:04.000Z", params: { update: { sessionUpdate: "turn_completed" } } }
  ]
    .map(JSON.stringify)
    .join("\n"),
  "utf8"
);
const grokRecords = grokJsonlAdapter.discover({
  id: "grok-cli",
  label: "Grok CLI",
  client: "CLI",
  source: path.join(tempRoot, ".grok", "sessions")
});
assert.equal(grokRecords.length, 1);
assert.equal(grokRecords[0].title, "Grok adapter test");
assert.deepEqual(grokRecords[0].messages.map((message) => [message.role, message.content]), [
  ["user", "Hello"],
  ["assistant", "Hi there"]
]);

const accioSessions = path.join(tempRoot, ".accio", "accounts", "account-1", "agents", "agent-1", "sessions");
fs.mkdirSync(accioSessions, { recursive: true });
const accioBase = path.join(accioSessions, "agent-1_session-1");
fs.writeFileSync(
  `${accioBase}.meta.jsonc`,
  `// Accio session metadata
{
  "sessionKey": "session-1",
  "agentId": "agent-1",
  "label": "Accio adapter test",
  "createdAt": "2026-07-14T00:00:00.000Z",
  "updatedAt": "2026-07-14T00:01:00.000Z",
}
`,
  "utf8"
);
fs.writeFileSync(
  `${accioBase}.messages.jsonl`,
  [
    { timestamp: "2026-07-14T00:00:00.000Z", role: "user", messageType: "normal", content: { type: "text", text: "Hello Accio" } },
    { timestamp: "2026-07-14T00:00:01.000Z", role: "assistant", messageType: "normal", content: { type: "text", text: "Hello user" } },
    { timestamp: "2026-07-14T00:00:02.000Z", role: "assistant", messageType: "tool_call", content: { type: "text", text: "ignore" } }
  ]
    .map(JSON.stringify)
    .join("\n"),
  "utf8"
);
const accioRecords = accioJsonlAdapter.discover({
  id: "accio-work",
  label: "Accio Work",
  client: "Desktop",
  source: path.join(tempRoot, ".accio", "accounts")
});
assert.equal(accioRecords.length, 1);
assert.equal(accioRecords[0].title, "Accio adapter test");
assert.equal(accioRecords[0].messages.length, 2);

const workBuddyRoot = path.join(tempRoot, ".workbuddy");
const workBuddySessionId = "workbuddy-session-1";
const workBuddyProject = path.join(workBuddyRoot, "projects", "tmp-workbuddy-project");
fs.mkdirSync(workBuddyProject, { recursive: true });
const workBuddyDb = path.join(workBuddyRoot, "workbuddy.db");
execFileSync("sqlite3", [
  workBuddyDb,
  `create table sessions (
      id text primary key, cwd text, title text, custom_title text, status text,
      created_at integer, updated_at integer, model text, deleted_at integer
    );
    insert into sessions values (
      '${workBuddySessionId}', '/tmp/workbuddy-project', 'WorkBuddy adapter test', null,
      'Completed', 1783987200, 1783987260, 'workbuddy-model', null
    );`
]);
fs.writeFileSync(
  path.join(workBuddyProject, `${workBuddySessionId}.jsonl`),
  [
    { id: "1", timestamp: 1783987200, type: "message", role: "user", content: [{ type: "text", text: "Hello WorkBuddy" }] },
    { id: "2", timestamp: 1783987260, type: "reasoning", role: "assistant", content: [{ type: "text", text: "ignore" }] },
    { id: "3", timestamp: 1783987261, type: "message", role: "assistant", content: [{ type: "text", text: "Hello user" }] }
  ]
    .map(JSON.stringify)
    .join("\n"),
  "utf8"
);
const workBuddyRecords = workbuddyJsonlAdapter.discover({
  id: "workbuddy",
  label: "WorkBuddy",
  client: "Desktop",
  source: workBuddyRoot
});
assert.equal(workBuddyRecords.length, 1);
assert.equal(workBuddyRecords[0].title, "WorkBuddy adapter test");
assert.equal(workBuddyRecords[0].messages.length, 2);

const zcodeDb = path.join(tempRoot, "zcode.db");
execFileSync("sqlite3", [
  zcodeDb,
  `create table session (id text primary key, title text, version text, directory text, time_created integer, time_updated integer);
   create table message (id text primary key, session_id text, time_created integer, time_updated integer, data text);
   create table part (id text primary key, message_id text, session_id text, time_created integer, time_updated integer, data text);
   insert into session values ('zcode-1', 'ZCode adapter test', '3.2.5', '/tmp/zcode-project', 1783987200, 1783987260);
   insert into message values
     ('zcode-message-1', 'zcode-1', 1783987200, 1783987200, '{"role":"user"}'),
     ('zcode-message-2', 'zcode-1', 1783987260, 1783987260, '{"role":"assistant"}');
   insert into part values
     ('zcode-part-1', 'zcode-message-1', 'zcode-1', 1783987200, 1783987200, '{"type":"text","text":"Hello ZCode"}'),
     ('zcode-part-2', 'zcode-message-2', 'zcode-1', 1783987260, 1783987260, '{"type":"text","text":"Hello user"}');`
]);
const zcodeRecords = zcodeSqliteAdapter.discover({
  id: "zcode",
  label: "ZCode",
  client: "Desktop/CLI",
  source: zcodeDb
});
assert.equal(zcodeRecords.length, 1);
assert.equal(zcodeRecords[0].title, "ZCode adapter test");
assert.equal(zcodeRecords[0].messages.length, 2);

const mimoDb = path.join(tempRoot, "mimocode.db");
execFileSync("sqlite3", [
  mimoDb,
  `create table project (id text primary key, name text, worktree text);
   create table session (id text primary key, project_id text, title text, version text, directory text, time_created integer, time_updated integer);
   create table message (id text primary key, session_id text, time_created integer, time_updated integer, data text);
   create table part (id text primary key, message_id text, session_id text, time_created integer, time_updated integer, data text);
   insert into project values ('mimo-project', 'Mimo Project', '/tmp/mimo-project');
   insert into session values ('mimo-1', 'mimo-project', 'Mimo adapter test', '0.1.0', '/tmp/mimo-project', 1783987200, 1783987260);
   insert into message values
     ('mimo-message-1', 'mimo-1', 1783987200, 1783987200, '{"role":"user"}'),
     ('mimo-message-2', 'mimo-1', 1783987260, 1783987260, '{"role":"assistant"}');
   insert into part values
     ('mimo-part-1', 'mimo-message-1', 'mimo-1', 1783987200, 1783987200, '{"type":"text","text":"Hello Mimo"}'),
     ('mimo-part-2', 'mimo-message-2', 'mimo-1', 1783987260, 1783987260, '{"type":"text","text":"Hello user"}');`
]);
const mimoRecords = mimoSqliteAdapter.discover({
  id: "mimo-code",
  label: "Mimo Code",
  client: "CLI",
  source: mimoDb
});
assert.equal(mimoRecords.length, 1);
assert.equal(mimoRecords[0].project, "Mimo Project");
assert.equal(mimoRecords[0].messages.length, 2);

const qoderTranscript = path.join(tempRoot, ".qoder", "projects", "demo", "transcript");
fs.mkdirSync(qoderTranscript, { recursive: true });
fs.writeFileSync(
  path.join(qoderTranscript, "qoder-1.jsonl"),
  [
    { type: "session_meta", sessionId: "qoder-1", cwd: "/tmp/qoder-project", data: { content: { title: "Qoder adapter test" } } },
    { type: "user", sessionId: "qoder-1", timestamp: "2026-07-14T00:00:00.000Z", message: { role: "user", content: "Hello Qoder" } },
    { type: "assistant", sessionId: "qoder-1", timestamp: "2026-07-14T00:01:00.000Z", message: { role: "assistant", content: [{ type: "text", text: "Hello user" }] } },
    { type: "user", sessionId: "qoder-1", timestamp: "2026-07-14T00:02:00.000Z", message: { role: "user", content: [{ type: "tool_result", content: "ignore" }] } }
  ]
    .map(JSON.stringify)
    .join("\n"),
  "utf8"
);
const qoderRecords = qoderJsonlAdapter.discover({
  id: "qoder-cli",
  label: "Qoder CLI",
  client: "CLI",
  source: path.join(tempRoot, ".qoder", "projects")
});
assert.equal(qoderRecords.length, 1);
assert.equal(qoderRecords[0].title, "Qoder adapter test");
assert.equal(qoderRecords[0].messages.length, 2);

const qoderWorkDb = path.join(tempRoot, "agents.db");
execFileSync("sqlite3", [
  qoderWorkDb,
  `create table projects (id text primary key, name text, path text);
   create table chats (id text primary key, name text, project_id text, created_at integer, updated_at integer, worktree_path text, deleted_at integer);
   create table messages (id text primary key, chat_id text, role text, parts text, searchable_text text, created_at integer, updated_at integer, sequence integer);
   insert into projects values ('qoder-work-project', 'Qoder Work Project', '/tmp/qoder-work-project');
   insert into chats values ('qoder-work-1', 'Qoder Work adapter test', 'qoder-work-project', 1783987200, 1783987260, '/tmp/qoder-work-project', null);
   insert into messages values
     ('qoder-work-message-1', 'qoder-work-1', 'user', '[{"type":"text","text":"Hello Qoder Work"}]', '', 1783987200, 1783987200, 1),
     ('qoder-work-message-2', 'qoder-work-1', 'assistant', '[{"type":"text","text":"Hello user"}]', '', 1783987260, 1783987260, 2);`
]);
const qoderWorkRecords = qoderworkSqliteAdapter.discover({
  id: "qoder-work",
  label: "Qoder Work",
  client: "Desktop",
  source: qoderWorkDb
});
assert.equal(qoderWorkRecords.length, 1);
assert.equal(qoderWorkRecords[0].project, "Qoder Work Project");
assert.equal(qoderWorkRecords[0].messages.length, 2);

const kimiSessionDir = path.join(tempRoot, ".kimi-code", "sessions", "workdir", "kimi-1");
fs.mkdirSync(path.join(kimiSessionDir, "agents", "main"), { recursive: true });
fs.writeFileSync(
  path.join(kimiSessionDir, "state.json"),
  JSON.stringify({ id: "kimi-1", title: "Kimi adapter test", cwd: "/tmp/kimi-project", createdAt: 1783987200, updatedAt: 1783987260 }),
  "utf8"
);
fs.writeFileSync(
  path.join(kimiSessionDir, "agents", "main", "wire.jsonl"),
  [
    { type: "event", timestamp: 1783987200, event: { type: "UserMessage", message: { content: "Hello Kimi" } } },
    { type: "event", timestamp: 1783987260, event: { type: "AssistantMessage", message: { content: "Hello user" } } }
  ]
    .map(JSON.stringify)
    .join("\n"),
  "utf8"
);
const kimiRecords = kimiJsonlAdapter.discover({
  id: "kimi-code",
  label: "Kimi Code",
  client: "CLI",
  source: path.join(tempRoot, ".kimi-code", "sessions")
});
assert.equal(kimiRecords.length, 1);
assert.equal(kimiRecords[0].title, "Kimi adapter test");
assert.equal(kimiRecords[0].messages.length, 2);

const traeRoot = path.join(tempRoot, "Trae CN");
const traeWorkspace = path.join(traeRoot, "User", "workspaceStorage", "workspace-1");
const traeChats = path.join(traeWorkspace, "chatSessions");
fs.mkdirSync(traeChats, { recursive: true });
fs.writeFileSync(path.join(traeWorkspace, "workspace.json"), JSON.stringify({ folder: "file:///tmp/trae-project" }), "utf8");
fs.writeFileSync(
  path.join(traeChats, "trae-1.json"),
  JSON.stringify({
    sessionId: "trae-1",
    customTitle: "Trae adapter test",
    creationDate: 1783987200000,
    lastMessageDate: 1783987260000,
    requests: [
      {
        timestamp: 1783987200000,
        message: { text: "Hello Trae" },
        response: [{ kind: "markdownContent", content: { value: "Hello user" } }]
      }
    ]
  }),
  "utf8"
);
const traeRecords = traeVscodeJsonAdapter.discover({
  id: "trae",
  label: "Trae",
  client: "Desktop",
  source: traeRoot
});
assert.equal(traeRecords.length, 1);
assert.equal(traeRecords[0].title, "Trae adapter test");
assert.equal(traeRecords[0].project, "trae-project");
assert.equal(traeRecords[0].messages.length, 2);

const legacyWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "histora-legacy-"));
const managedWorkspace = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "histora-managed-")), "workspace");
fs.writeFileSync(
  path.join(legacyWorkspace, CONFIG_FILE),
  `workspace: ""
sync:
  schedule: "23:00"
  cadence: daily
  interval_minutes: 0
  timezone: UTC
  redact: true
channels: []
`,
  "utf8"
);
fs.mkdirSync(path.join(legacyWorkspace, "channels", "codex"), { recursive: true });
fs.writeFileSync(path.join(legacyWorkspace, "channels", "codex", "session.md"), "saved", "utf8");
fs.mkdirSync(path.join(legacyWorkspace, ".histora"), { recursive: true });
const legacyStateDb = path.join(legacyWorkspace, ".histora", "state.sqlite");
execFileSync("sqlite3", [
  legacyStateDb,
  `create table sessions (markdown_path text);
   insert into sessions values ('${path.join(legacyWorkspace, "channels", "codex", "session.md")}');`
]);
const migration = migrateWorkspace(legacyWorkspace, managedWorkspace);
assert.equal(migration.migrated, true);
assert.equal(readConfig(managedWorkspace).workspace, managedWorkspace);
assert.equal(fs.readFileSync(path.join(managedWorkspace, "channels", "codex", "session.md"), "utf8"), "saved");
const migratedPath = execFileSync(
  "sqlite3",
  [path.join(managedWorkspace, ".histora", "state.sqlite"), "select markdown_path from sessions limit 1;"],
  { encoding: "utf8" }
).trim();
assert.equal(migratedPath, path.join(managedWorkspace, "channels", "codex", "session.md"));

if (process.platform === "darwin") {
  assert.throws(
    () => assertSafeBackgroundWorkspace(path.join(os.homedir(), "Documents", "Histora")),
    /Background sync cannot use Documents/
  );
  assert.throws(
    () =>
      launchdRunner("/tmp/histora", {
        runner: { programArguments: [path.join(os.homedir(), "Documents", "Histora.app", "Contents", "MacOS", "Histora"), "--histora-sync"] }
      }),
    /must run the installed Histora.app/
  );
  assert.deepEqual(
    launchdRunner("/tmp/histora", {
      runner: { programArguments: ["/Applications/Histora.app/Contents/MacOS/Histora", "--histora-sync"] }
    }).environment,
    { HISTORA_WORKSPACE: "/tmp/histora" }
  );
}

const historaRoot = fs.mkdtempSync(path.join(os.tmpdir(), "histora-config-"));
fs.writeFileSync(
  path.join(historaRoot, CONFIG_FILE),
  `workspace: ${historaRoot}
channels: []
`,
  "utf8"
);
const detected = detectAgents({ channels: [{ id: "hermes-agent", source: hermesDb, adapter: "hermes-sqlite" }] });
assert.ok(detected.some((agent) => agent.id === "hermes-agent"));

console.log("ok");

function writeCodexSession(filePath, id, title) {
  fs.writeFileSync(
    filePath,
    [
      JSON.stringify({
        timestamp: "2026-07-14T00:00:00.000Z",
        type: "session_meta",
        payload: { id, cwd: "/tmp/codex-project", cli_version: "0.144.2" }
      }),
      JSON.stringify({
        timestamp: "2026-07-14T00:00:01.000Z",
        type: "response_item",
        payload: { type: "message", role: "user", content: [{ type: "input_text", text: title }] }
      }),
      JSON.stringify({
        timestamp: "2026-07-14T00:00:02.000Z",
        type: "response_item",
        payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Done" }] }
      })
    ].join("\n"),
    "utf8"
  );
}

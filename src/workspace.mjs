import fs from "node:fs";
import path from "node:path";
import { CONFIG_FILE, LEGACY_CONFIG_FILE, readConfig, renderConfig } from "./config.mjs";
import { runSql, sqlString } from "./state.mjs";
import { atomicWriteFile, ensureDir } from "./utils.mjs";

const MIGRATED_ENTRIES = [CONFIG_FILE, LEGACY_CONFIG_FILE, ".histora", ".chathub", "channels"];

export function managedWorkspaceRoot(userDataPath) {
  return path.join(userDataPath, "workspace");
}

export function hasWorkspaceConfig(root) {
  return fs.existsSync(path.join(root, CONFIG_FILE)) || fs.existsSync(path.join(root, LEGACY_CONFIG_FILE));
}

export function migrateWorkspace(legacyRoot, destinationRoot) {
  if (!legacyRoot || !fs.existsSync(legacyRoot)) {
    return { migrated: false, root: destinationRoot };
  }

  if (hasWorkspaceConfig(destinationRoot)) {
    rewriteMarkdownPaths(legacyRoot, destinationRoot);
    return { migrated: false, root: destinationRoot };
  }

  ensureDir(destinationRoot);
  for (const entry of MIGRATED_ENTRIES) {
    const source = path.join(legacyRoot, entry);
    const destination = path.join(destinationRoot, entry);
    if (!fs.existsSync(source) || fs.existsSync(destination)) continue;
    fs.cpSync(source, destination, { recursive: true, errorOnExist: false });
  }

  if (!hasWorkspaceConfig(destinationRoot)) return { migrated: false, root: destinationRoot };
  const config = readConfig(destinationRoot);
  config.workspace = destinationRoot;
  atomicWriteFile(path.join(destinationRoot, CONFIG_FILE), renderConfig(config));
  if (fs.existsSync(path.join(destinationRoot, LEGACY_CONFIG_FILE))) {
    fs.unlinkSync(path.join(destinationRoot, LEGACY_CONFIG_FILE));
  }
  rewriteMarkdownPaths(legacyRoot, destinationRoot);
  return { migrated: true, root: destinationRoot };
}

function rewriteMarkdownPaths(legacyRoot, destinationRoot) {
  const dbPath = path.join(destinationRoot, ".histora", "state.sqlite");
  if (!fs.existsSync(dbPath)) return;
  const legacyPrefix = `${path.resolve(legacyRoot)}${path.sep}`;
  const destinationPrefix = `${path.resolve(destinationRoot)}${path.sep}`;
  try {
    runSql(
      dbPath,
      `update sessions
       set markdown_path = replace(markdown_path, ${sqlString(legacyPrefix)}, ${sqlString(destinationPrefix)})
       where markdown_path like ${sqlString(`${legacyPrefix}%`)};`
    );
  } catch {
    // A partially-created state database can be safely repaired on the next launch.
  }
}

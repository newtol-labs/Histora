export function defaultCodexHome() {
  const configured = String(process.env.CODEX_HOME || "").trim();
  return configured || "~/.codex";
}

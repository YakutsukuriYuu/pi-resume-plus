import { existsSync } from "node:fs";
import { SessionManager, type ExtensionAPI, type ExtensionCommandContext, type SessionInfo } from "@earendil-works/pi-coding-agent";
import { SessionSelectorComponent } from "./session-selector.ts";
import { readConfig } from "./config.ts";
import { launchInTerminal } from "./terminal-launcher.ts";
import { canonicalizePath, defaultSessionDir } from "./paths.ts";
import { registerActiveSession, unregisterActiveSession, isSessionActive } from "./active-sessions.ts";

type Selection = { action: "resume" | "terminal"; path: string } | { action: "exit" } | null;

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    try { registerActiveSession(ctx.sessionManager.getSessionFile(), ctx.cwd); }
    catch (error) { ctx.ui.notify(`resume-plus 活跃登记失败：${String(error)}`, "warning"); }
  });
  pi.on("session_shutdown", () => {
    try { unregisterActiveSession(); } catch { /* Must not block pi shutdown. */ }
  });

  const open = async (_args: string, ctx: ExtensionCommandContext) => {
    if (ctx.mode !== "tui") {
      ctx.ui.notify("resume-plus 只能在交互式 TUI 中使用", "error");
      return;
    }
    let config;
    try { config = readConfig(); }
    catch (error) { ctx.ui.notify(String(error), "error"); return; }
    const shiftEnter = config.shiftEnter;
    const cwd = ctx.sessionManager.getCwd();
    const sessionDir = ctx.sessionManager.getSessionDir();
    const currentFile = ctx.sessionManager.getSessionFile();
    // Exact native usesDefaultSessionDir comparison, using a copied pure helper
    // because that method is not part of ReadonlySessionManager's public API.
    const usesDefault = sessionDir === defaultSessionDir(cwd);
    const known = new Map<string, SessionInfo>();
    const remember = (sessions: SessionInfo[]) => {
      for (const session of sessions) known.set(session.path, session);
      return sessions;
    };
    const selected = await ctx.ui.custom<Selection>((tui, theme, keybindings, done) =>
      new SessionSelectorComponent(
        async (progress) => remember(await SessionManager.list(cwd, sessionDir, progress)),
        async (progress) => remember(await (usesDefault ? SessionManager.listAll(progress) : SessionManager.listAll(sessionDir, progress))),
        (path) => done({ action: "resume", path }),
        () => done(null),
        () => done({ action: "exit" }),
        () => tui.requestRender(),
        {
          theme, keybindings,
          renameSession: async (path, name) => {
            const next = name?.trim();
            if (!next) return;
            if (currentFile && canonicalizePath(path) === canonicalizePath(currentFile)) pi.setSessionName(next);
            else SessionManager.open(path).appendSessionInfo(next);
          },
          showRenameHint: true,
          currentCwd: cwd,
          onOpenInNew: shiftEnter.enabled ? (path) => done({ action: "terminal", path }) : undefined,
        },
        currentFile,
      ),
    );
    if (!selected) return;
    if (selected.action === "exit") { ctx.shutdown(); return; }
    if (selected.action === "resume") {
      // This is the native handleResumeSession path: trust, missing cwd prompt,
      // extension veto, replacement lifecycle and error handling stay with pi.
      await ctx.switchSession(selected.path);
      return; // Old pi/ctx are stale after replacement.
    }
    if (!shiftEnter.enabled) return;
    const target = known.get(selected.path);
    if (!target || !existsSync(target.path)) {
      ctx.ui.notify("目标 session 已不存在", "warning");
      return;
    }
    try {
      let mode = shiftEnter.mode;
      if (mode === "same" && isSessionActive(target.path, currentFile)) {
        if (!await ctx.ui.confirm("Session 已经打开", "这个 session 正在使用。是否创建 fork 后在新终端打开？（否／取消不会打开）")) return;
        mode = "fork";
      }
      await launchInTerminal(shiftEnter.terminal, target.cwd || cwd, target.path, mode, shiftEnter.piPath);
      // Spawn acceptance isn't proof that the terminal's pi finished startup.
      ctx.ui.notify(`已提交新终端启动请求（${mode === "fork" ? "独立副本" : "原会话"}）`, "info");
    } catch (error) {
      ctx.ui.notify(`无法启动新终端：${error instanceof Error ? error.message : String(error)}`, "error");
    }
  };
  pi.registerCommand("r", { description: "原生会话选择器＋项目目录树", handler: open });
  pi.registerCommand("resume-tree", { description: "原生会话选择器＋项目目录树", handler: open });
}

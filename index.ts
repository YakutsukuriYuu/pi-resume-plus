import { existsSync, statSync, writeFileSync } from "node:fs";
import { SessionManager, type ExtensionAPI, type ExtensionCommandContext, type SessionInfo } from "@earendil-works/pi-coding-agent";
import { SessionSelectorComponent } from "./session-selector.ts";
import { readConfig } from "./config.ts";
import { launchInTerminal } from "./terminal-launcher.ts";
import { canonicalizePath, defaultSessionDir } from "./paths.ts";
import { registerActiveSession, unregisterActiveSession, isSessionActive } from "./active-sessions.ts";

type Selection =
  | { action: "resume" | "terminal"; path: string }
  | { action: "new-in-folder"; folder: string }
  | { action: "exit" }
  | null;

/** CLI flags that open the picker on startup, e.g. `pi --rr` (single-dash `-rr` is rejected by pi's parser). */
const STARTUP_FLAGS = ["rr", "resume-plus"] as const;

/**
 * pi's startup sequence installs its editor AFTER extensions get session_start
 * and clears the editor container, which wipes any non-overlay custom UI opened
 * that early. Overlays live outside the editor container and survive, so the
 * startup-triggered picker must open as an overlay. Module state survives
 * runtime rebinds (extension factories are cached), so one pending flag is
 * enough and is always consumed by the dispatched /r handler.
 */
let startupOverlayPending = false;

export default function (pi: ExtensionAPI) {
  for (const name of STARTUP_FLAGS) {
    pi.registerFlag(name, {
      description: "启动后立即打开 resume-plus 选择器（相当于启动时自动执行 /r）",
      type: "boolean",
    });
  }

  pi.on("session_start", (event, ctx) => {
    try { registerActiveSession(ctx.sessionManager.getSessionFile(), ctx.cwd); }
    catch (error) { ctx.ui.notify(`resume-plus 活跃登记失败：${String(error)}`, "warning"); }

    if (event.reason !== "startup" || ctx.mode !== "tui") return;
    if (!STARTUP_FLAGS.some((name) => pi.getFlag(name) === true)) return;
    // Only for a brand-new session: `-c`/`-r` already chose a session, keep their priority.
    if (ctx.sessionManager.getEntries().some((entry) => entry.type === "message")) return;
    // Event contexts cannot switch sessions; dispatch the command so the picker
    // runs with a full command context (same code path as typing /r).
    startupOverlayPending = true;
    pi.sendUserMessage("/r", { expandPromptTemplates: true });
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
    const searchMode = config.searchMode;
    const folderNewSession = config.folderNewSession;
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
    const overlay = startupOverlayPending;
    startupOverlayPending = false;
    // Closing an overlay restores focus to the target captured when it was shown.
    // During pi's startup that target is undefined or the since-replaced editor
    // instance, so nothing owns the keyboard afterwards. Re-installing the current
    // editor (public API; its setEditorComponent path ends with setFocus(editor))
    // hands focus back to the live editor. Only the startup/overlay path needs it.
    const restoreEditorFocus = () => {
      if (!overlay) return;
      try {
        const previous = ctx.ui.getEditorComponent();
        ctx.ui.setEditorComponent(undefined);
        if (previous) ctx.ui.setEditorComponent(previous);
      } catch { /* best effort: never fail the command because of focus repair */ }
    };
    let picker: SessionSelectorComponent | undefined;
    let focusWatchdog: ReturnType<typeof setInterval> | undefined;
    const selected = await (async (): Promise<Selection> => {
      try {
        return await ctx.ui.custom<Selection>(
          (tui, theme, keybindings, done) => {
            picker = new SessionSelectorComponent(
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
                searchMode,
                newSessionInFolder: folderNewSession.enabled ? (folder: string) => done({ action: "new-in-folder", folder }) : undefined,
                onOpenInNew: shiftEnter.enabled ? (path) => done({ action: "terminal", path }) : undefined,
              },
              currentFile,
            );
            return picker;
          },
          overlay
            ? {
                overlay: true,
                overlayOptions: { width: "100%", maxHeight: "90%" },
                onHandle: (handle) => {
                  // pi's startup continues after session_start and steals keyboard
                  // focus (editor install clears the editor container). Overlays
                  // survive the wipe but lose focus; reclaim it until it stays.
                  handle.focus();
                  let stable = 0;
                  let ticks = 0;
                  focusWatchdog = setInterval(() => {
                    ticks++;
                    if (picker?.focused) {
                      stable++;
                      if (stable >= 13) { // ~2s of uninterrupted focus: startup is done
                        if (focusWatchdog) clearInterval(focusWatchdog);
                        focusWatchdog = undefined;
                      }
                    } else {
                      stable = 0;
                      handle.focus();
                    }
                    if (ticks >= 70) { // ~10s hard cap; never outlives the picker
                      if (focusWatchdog) clearInterval(focusWatchdog);
                      focusWatchdog = undefined;
                    }
                  }, 150);
                },
              }
            : undefined,
        );
      } finally {
        if (focusWatchdog) clearInterval(focusWatchdog);
      }
    })();
    if (!selected) { restoreEditorFocus(); return; }
    if (selected.action === "exit") { ctx.shutdown(); return; }
    if (selected.action === "new-in-folder") {
      const folder = selected.folder;
      if (!existsSync(folder) || !statSync(folder).isDirectory()) {
        ctx.ui.notify(`目录不存在，无法新建会话：${folder}`, "error");
        restoreEditorFocus();
        return;
      }
      try {
        // Create the file in the directory pi would use for a new session in that
        // folder: the per-project default, or the configured custom sessionDir if
        // this process uses one. Using the *current* session's directory would store
        // e.g. a pi-hub session inside the Qwen directory, and since pi then reports
        // sessionDir != default(dir,cwd), the picker's All scope would degrade to
        // that single directory.
        const currentDir = ctx.sessionManager.getSessionDir();
        const usesDefaultDirs = !currentDir || currentDir === defaultSessionDir(ctx.sessionManager.getCwd());
        const targetDir = usesDefaultDirs ? defaultSessionDir(folder) : currentDir;
        const created = SessionManager.create(folder, targetDir || undefined);
        const file = created.getSessionFile();
        const header = created.getHeader();
        if (!file || !header) throw new Error("无法创建会话文件");
        // pi defers writing a new session file until the first assistant message,
        // and switching reads the target cwd from the file header. Without a file,
        // open() would fall back to process.cwd() (the current directory). Persist
        // the generated header, which makes it a valid session file for that cwd.
        writeFileSync(file, `${JSON.stringify(header)}\n`, { flag: "wx" });
        await ctx.switchSession(file);
      } catch (error) {
        ctx.ui.notify(`无法在 ${folder} 新建会话：${error instanceof Error ? error.message : String(error)}`, "error");
        restoreEditorFocus();
      }
      return; // The replaced context is stale after a successful switch.
    }
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
    restoreEditorFocus(); // we stayed in this session, so typing must work again
  };
  pi.registerCommand("r", { description: "原生会话选择器＋项目目录树", handler: open });
  pi.registerCommand("resume-tree", { description: "原生会话选择器＋项目目录树", handler: open });
}

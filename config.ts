import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type TerminalConfig = {
  type?: "system" | "Terminal.app" | "iTerm2" | "WezTerm" | "Kitty" | "Ghostty" | "Alacritty" | "x-terminal-emulator" | "gnome-terminal" | "konsole" | "xterm" | "custom";
  /** Terminal binary path, or .app path for macOS AppleScript terminals. */
  path?: string;
  executable?: string;
  args?: string[];
};
export type ShiftEnterConfig = {
  enabled: boolean;
  mode: "fork" | "same";
  piPath: string;
  terminal: TerminalConfig;
};
export type ResumePlusConfig = { shiftEnter: ShiftEnterConfig };
export const configPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "config.json");
const terminals = ["system", "Terminal.app", "iTerm2", "WezTerm", "Kitty", "Ghostty", "Alacritty", "x-terminal-emulator", "gnome-terminal", "konsole", "xterm", "custom"];
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} 必须为对象`);
  return value as Record<string, unknown>;
}
export function parseConfig(value: unknown): ResumePlusConfig {
  const root = object(value, "config");
  const shift = root.shiftEnter === undefined ? {} : object(root.shiftEnter, "shiftEnter");
  const terminal = shift.terminal === undefined ? {} : object(shift.terminal, "shiftEnter.terminal");
  if (shift.enabled !== undefined && typeof shift.enabled !== "boolean") throw new Error("shiftEnter.enabled 必须为 boolean");
  if (shift.mode !== undefined && shift.mode !== "same" && shift.mode !== "fork") throw new Error("shiftEnter.mode 必须为 same 或 fork");
  for (const [key, value] of [["piPath", shift.piPath], ["terminal.path", terminal.path], ["terminal.executable", terminal.executable]] as const) {
    if (value !== undefined && (typeof value !== "string" || !value.trim() || /[\0\r\n]/.test(value))) throw new Error(`${key} 必须为非空路径且不能含换行`);
  }
  if (terminal.type !== undefined && !terminals.includes(String(terminal.type))) throw new Error("不支持的 terminal.type");
  if (terminal.args !== undefined && (!Array.isArray(terminal.args) || terminal.args.some((arg) => typeof arg !== "string" || arg.includes("\0")))) throw new Error("terminal.args 必须为字符串数组");
  return { shiftEnter: {
    enabled: shift.enabled === undefined ? true : shift.enabled as boolean,
    mode: shift.mode === "fork" ? "fork" : "same",
    piPath: shift.piPath as string ?? "pi",
    terminal: { type: "system", ...terminal } as TerminalConfig,
  } };
}
export function readConfig(file = configPath): ResumePlusConfig {
  try { return parseConfig(JSON.parse(readFileSync(file, "utf8"))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return parseConfig({});
    throw new Error(`resume-plus 配置错误（${file}）：${error instanceof Error ? error.message : String(error)}`);
  }
}

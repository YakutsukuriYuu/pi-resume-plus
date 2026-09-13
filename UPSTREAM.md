# Upstream provenance

This extension is derived from pi (`@earendil-works/pi-coding-agent`) **0.85.1**, MIT License.
Copies preserve upstream behavior; enhancements are additive and marked in comments.

| File | Derived from (installed package `dist/…` + `.js.map` sources) |
|---|---|
| `session-selector.ts` | `modes/interactive/components/session-selector.ts` |
| `session-selector-search.ts` | `modes/interactive/components/session-selector-search.ts` |
| `dynamic-border.ts` | `modes/interactive/components/dynamic-border.ts` |
| `keybinding-hints.ts` | `modes/interactive/components/keybinding-hints.ts` |
| `paths.ts` (`defaultSessionDir`) | `core/session-manager.ts` (pure helper, version-attributed copy) |
| `paths.ts` (`canonicalizePath`) | `utils/paths.ts` |

Deviations required by the public extension API (pi does not expose these internals):

1. **Theme**: upstream imports a global theme singleton; this extension uses the `theme`
   instance injected by `ctx.ui.custom((tui, theme, keybindings, done) => …)` (see `theme.ts`).
2. **Keybindings**: upstream uses `KeybindingsManager.create()`; this extension uses the
   injected manager so remapped keys behave identically inside custom UI.
3. **All-scope listing**: upstream branches on `sessionManager.usesDefaultSessionDir()`,
   which is not on the public `ReadonlySessionManager` interface. The extension reproduces
   the identical comparison with the copied pure helper `defaultSessionDir(cwd)`.
4. **Exit action**: upstream calls its private shutdown; this extension returns a distinct
   `exit` action and the command handler calls public `ctx.shutdown()`.
5. **Current-session rename**: upstream appends via a separate `SessionManager`; the extension
   uses public `pi.setSessionName()` for the live file (updates state + emits
   `session_info_changed`) and the native separate-manager path for other files.
6. **Default scope and pinning** (resume-plus enhancements, not upstream behavior): the selector
   opens in the All scope (upstream opens Current Folder; All loads immediately and Current
   lazy-loads on first Tab instead), and the grouped view pins the current cwd folder first
   using canonical path comparison. The Alt+G native-order view has no pinning.

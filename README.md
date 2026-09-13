# resume-plus

原生 `/resume` 的完整复制 + 项目目录树增强。**不修改 pi 本体，不覆盖 `/resume`**，提供独立命令：

- `/r` 或 `/resume-tree` — 打开选择器（默认直接进入 **All 面板**，当前目录的文件夹置顶；Tab 切到 Current Folder 与原生逐行一致）

## 与原生 `/resume` 的一致性

选择器组件直接复制自 pi 0.85.1 源码（见 `UPSTREAM.md`），并已用对照测试逐项回归：

- 搜索：fuzzy、`"phrase"` 精确、`re:` 正则、多词 AND、无效正则，与原生算法**逐结果相等**
- 排序：threaded（子树最新活动驱动）/ recent / relevance，与原生逐行相等
- 命名过滤 Ctrl+N、路径显示 Ctrl+P、删除 Ctrl+D（trash 优先，回退 unlink）、重命名 Ctrl+R
- 加载进度、错误提示、空列表提示、删除确认吞键、IME 焦点传播
- 普通 Enter 恢复直接走公开 `ctx.switchSession()`，即原生 `handleResumeSession`：
  项目信任、缺失 cwd 提示、扩展否决、会话替换生命周期、错误处理全部归 pi 原生
- 主题/键位绑定使用宿主注入实例：自定义主题、自定义键位映射（含把 Shift+Enter
  重绑定为其他动作）全部生效

## 增强（仅 All 模式）

- **默认 All 面板**：打开 `/r` 即进入全部项目视图；Current Folder 作用域保留，Tab 切换，首次切换时才懒加载
- **当前目录置顶**：`ctx.cwd` 对应的文件夹固定排在分组第一位（按 realpath 规范路径匹配，符号链接别名也能识别）；其余文件夹保持原生全局线程活动顺序

- **目录分组**：会话按 `session.cwd` 折叠为项目根；文件夹顺序由**全局**线程活动决定
  （不会按 mtime 重排搜索结果，不丢原生排序/相关度）
- **跨目录线程**：父链跨越目录时，外目录祖先显示为 `↗ [目录] 名称` 引用行，
  保留真实树深度与全部父子边（A→B→A 回环 fork 也不断链）；引用行不计入项目会话数
- **Alt+G**：在「目录分组」与「原生全局顺序」之间切换，原生视图与 `/resume` 逐行一致
- **←/→**：折叠 / 展开选中的项目（有方向性，幂等）；**Enter** 在文件夹上只折叠，不会误恢复
- **Shift+↑/↓**：在项目根之间跳转
- **Shift+Enter**：在新终端打开选中会话（不影响当前会话；见下方配置）
- 快捷键提示随终端宽度自动换行（24/40/80/120 列均验证）

## 配置

配置位于插件目录 `config.json`（旁边有 `config.example.json`），编辑后 `/reload` 生效。
格式错误会**关闭加载并给出错误通知**（fail-closed），不会静默退回默认值。

```json
{
  "shiftEnter": {
    "enabled": true,
    "mode": "same",
    "piPath": "/opt/homebrew/bin/pi",
    "terminal": { "type": "system", "path": "/Applications/iTerm.app" }
  }
}
```

| 字段 | 说明 |
|---|---|
| `enabled` | `false` 时 Shift+Enter 完全无效（即使被重绑定为确认/删除也不会触发），提示也不显示 |
| `mode` | `same`（`pi --session`，默认）或 `fork`（`pi --fork`） |
| `piPath` | pi 可执行文件；不存在时明确报错。建议绝对路径 |
| `terminal.type` | `system`（自动检测）/ `Terminal.app` / `iTerm2` / `WezTerm` / `Kitty` / `Ghostty` / `Alacritty` / `gnome-terminal` / `konsole` / `xterm` / `x-terminal-emulator` / `custom` |
| `terminal.path` | 终端二进制路径（macOS AppleScript 终端可为 `.app` 路径） |
| `custom` | `terminal.executable` + `terminal.args`，占位符 `{cwd}` `{session}` `{pi}` `{mode}`，按 argv 逐项传递（不经 shell，注入安全） |

- 自动检测依据 `TERM_PROGRAM`/`KITTY_WINDOW_ID` 等环境变量，正常操作**没有终端选择器**
- 目标会话已活跃（含当前会话）时询问是否 fork；取消则不打开
- 活跃追踪为每 PID 一个原子文件（`~/.pi/agent/resume-plus-active/<pid>.json`），崩溃残留自动清理
- 启动命令经 `/bin/sh` + 严格单引号转义，不依赖用户登录 shell；macOS 用 AppleScript，
  iTerm2 先建普通窗口再写入命令（启动失败可见）；Linux 用 argv 直接启动，不回退 macOS 方案
- 启动器立即非零退出（如 osascript 权限被拒）会报告错误；但「已提交启动请求」不等于
  新窗口内 pi 已完成初始化（终端侧还需自行读盘/联网）

## 测试

```bash
npm install        # 仅开发依赖（typescript/@types），运行时不需要
npm run typecheck  # 对照本机安装的 pi 类型
npm test           # 30 项：原生逐项对照 + 分组/键位/配置/启动器/注册表
npm run test:tui   # 真实 PTY 驱动 pi，验证 /r 打开、Tab 分组、文件夹渲染
```

## 已知限制

- 新终端中 pi 的可用性取决于目标机器 PATH/权限；`piPath` 用绝对路径最稳
- 活跃追踪只覆盖加载了本扩展的 pi 进程（外部手工 `pi --session` 打开的同文件会话不可见）

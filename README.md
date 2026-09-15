# resume-plus

原生 `/resume` 的完整复制 + 项目目录树增强。**不修改 pi 本体，不覆盖 `/resume`**，提供独立命令：

- `/r` 或 `/resume-tree` — 打开选择器（默认直接进入 **All 面板**，当前目录的文件夹置顶；Tab 切到 Current Folder 与原生逐行一致）
- `pi --rr`（或 `pi --resume-plus`）— 启动后立即自动打开选择器（见下节）

## 启动时自动打开（`pi --rr`）

```bash
pi --rr            # 启动后无需输入，选择器自动打开
```

- 选中会话即切换；**Esc / Ctrl+C 取消则留在当前会话**（不像 `pi -r` 那样退出 pi），且焦点立即回到输入框，可以继续打字。
- **为什么不是 `pi -rr`**：pi 的参数解析器会拒绝无法识别的单横杠参数（`-rr` 直接报错），扩展只能注册 `--xxx` 长参数；`-r` 也已被原生 resume 占用。
- 与 `-c` / `-r` 同用时以它们为准：`--rr` 只在「全新空会话」上触发（`-r` 本身就有原生选择器）。
- 提示：`pi --rr` 会先创建一个空会话文件再切走（与平时直接 `pi` 一致）；想完全不留痕迹用 `pi --no-session --rr`。

实现说明：pi 在扩展收到 `session_start` 之后才完成编辑器安装并清空编辑器容器，因此启动期打开的普通自定义 UI 会被抹掉。`--rr` 的选择器以 **overlay** 渲染（overlay 不在编辑器容器内，天然免疫），并用一个约 2 秒的看门狗在键盘焦点被启动流程抢走时自动夺回（焦点稳定即停止，选择器关闭时必然清理）。

关闭 overlay 时，TUI 会把焦点还给「打开之前的目标」，而启动期的那个目标（尚未安装或已被替换的编辑器实例）已失效，会出现「选择器关了但什么都输不进去」。因此 `--rr` 在不切换会话地关闭选择器后，会用公开 API 重新安装当前编辑器把焦点交还给输入框（已用 PTY 回归：Esc 与 Ctrl+C 两种退出方式关闭后都能立即输入）。

## 安装

要求：pi（`@earendil-works/pi-coding-agent`），无运行时依赖。本扩展在 **pi 0.85.1** 上开发并逐项对照验证；其他 pi 版本的原生组件可能不同，不保证兼容。

### 方式一：克隆到扩展目录（推荐）

```bash
# HTTPS（无需 SSH key）
git clone https://github.com/YakutsukuriYuu/pi-resume-plus.git ~/.pi/agent/extensions/resume-plus

# 或 SSH
git clone git@github.com:YakutsukuriYuu/pi-resume-plus.git ~/.pi/agent/extensions/resume-plus
```

目录名必须是 `resume-plus`（自动发现规则：`~/.pi/agent/extensions/*/index.ts`），不需要 `npm install`。
安装后重启 pi，或在 pi 里执行 `/reload` 热重载；更新用 `git -C ~/.pi/agent/extensions/resume-plus pull`。

### 方式二：交给 pi 管理（git 包）

```bash
pi install git:github.com/YakutsukuriYuu/pi-resume-plus   # 安装
pi update --extensions                                   # 更新
pi remove git:github.com/YakutsukuriYuu/pi-resume-plus   # 卸载
```

包会克隆到 `~/.pi/agent/git/github.com/YakutsukuriYuu/pi-resume-plus` 并登记进 `~/.pi/agent/settings.json`。
注意：这种方式下 `config.json` 位于克隆目录内，而 `pi update --extensions` 在重置/校验克隆时可能覆盖它；
需要自定义配置（Shift+Enter 等）就用方式一。

### 验证安装

在 pi 里输入 `/r`（或 `/resume-tree`）能打开选择器即成功；按 `ctrl+o` 查看启动信息，扩展列表中应包含 `resume-plus`。

## 与原生 `/resume` 的一致性

选择器组件直接复制自 pi 0.85.1 源码（见 `UPSTREAM.md`），并已用对照测试逐项回归：

- 搜索：默认**严格子串**（大小写不敏感，多词 AND）；`"文本"` 双引号 = **模糊匹配**；`re:` 正则。设 `searchMode: "fuzzy"` 可切回原生语义（此时裸词是模糊、`"文本"` 是精确子串），该模式下与原生算法**逐结果相等**
- 排序：threaded（子树最新活动驱动）/ recent / relevance，与原生逐行相等
- 命名过滤 Ctrl+N、路径显示 Ctrl+P、删除 Ctrl+D（trash 优先，回退 unlink）、重命名 Ctrl+R
- 加载进度、错误提示、空列表提示、删除确认吞键、IME 焦点传播
- 普通 Enter 恢复直接走公开 `ctx.switchSession()`，即原生 `handleResumeSession`：
  项目信任、缺失 cwd 提示、扩展否决、会话替换生命周期、错误处理全部归 pi 原生
- 主题/键位绑定使用宿主注入实例：自定义主题、自定义键位映射（含把 Shift+Enter
  重绑定为其他动作）全部生效

## 增强（仅 All 模式）

- **默认 All 面板**：打开 `/r` 即进入全部项目视图；Current Folder 作用域保留，Tab 切换，首次切换时才懒加载
- **当前目录置顶（仅未搜索时）**：`ctx.cwd` 对应的文件夹排在分组第一位（按 realpath 规范路径匹配，符号链接别名也能识别）；其余文件夹保持原生全局线程活动顺序
- **搜索时按匹配度排**：一旦输入查询词，取消置顶，文件夹顺序完全跟随匹配度（最佳匹配所在目录自然靠前）。因为搜索文本包含全部对话内容，置顶会把当前目录里的弱命中顶到精确匹配前面——一屏只有 10 行，精确匹配就会被埋在下面看不到了
- **按文件夹名搜索**：输入目录名（如 `pi-hub`）会优先显示该目录并**展开它的全部会话**（不要求每个会话都命中关键词）。排序规则：目录名精确 > 前缀 > 模糊 > 路径**字面**命中 > 仅内容命中；**同一层内先按该目录最佳会话的匹配分、再按时间**。路径匹配特意使用字面包含而非模糊匹配——否则 `ssh` 会因 `/Users/<用户名>/…/Harness/…` 凑出 s-s-h 而误命中几乎所有目录，导致层级失效、只剩时间排序。被命中而展开的目录行会标注 `· name match` / `· path match`。`Ctrl+N`（Named）过滤照常叠加
- **目录分组**：会话按 `session.cwd` 折叠为项目根；文件夹顺序由**全局**线程活动决定
  （不会按 mtime 重排搜索结果，不丢原生排序/相关度）
- **跨目录线程**：父链跨越目录时，外目录祖先显示为 `↗ [目录] 名称` 引用行，
  保留真实树深度与全部父子边（A→B→A 回环 fork 也不断链）；引用行不计入项目会话数
- **Alt+G**：在「目录分组」与「原生全局顺序」之间切换，原生视图与 `/resume` 逐行一致
- **←/→**：折叠 / 展开选中的项目（有方向性，幂等）；**Enter** 在文件夹上只折叠，不会误恢复
- **Shift+↑/↓**：在项目根之间跳转
- **Shift+← / Shift+→**：**全部折叠 / 全部展开**所有项目文件夹（只对分组视图生效，仅影响本次打开的选择器）
- **Shift+Enter**：会话行 = 在新终端打开该会话（不影响当前会话；见下方配置）；文件夹行 = **在该项目下新建会话并切过去**（等价于进到那个目录执行 `/new`；当前会话与编辑器草稿都不会丢，目标目录不存在时报错不切换）。新建后**如果一直没产生任何内容**，在你离开它或退出 pi 时会**自动清理**（并在 pi 被强杀后于下次启动清理），不会在会话库里留下空会话
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
  },
  "searchMode": "substring",
  "folderNewSession": { "enabled": true, "cleanupUnused": true }
}
```

| 字段 | 说明 |
|---|---|
| `folderNewSession.enabled` | 文件夹行 `Shift+Enter` 新建会话（默认 `true`）。**独立于 `shiftEnter`**：两者只是共用同一个按键，互不影响 |
| `folderNewSession.cleanupUnused` | 自动清理“建了但从未产生任何内容”的新会话（默认 `true`）。只要它有过消息、或你给它命名、或打过标签，就永不清理；清理方式优先 `trash`（可回收），不可用则删除 |
| `searchMode` | `substring`（默认）：裸词必须**字面包含**；`"文本"` = 模糊子序列。`fuzzy`：裸词 = 模糊子序列（原生 pi 行为），`"文本"` = 精确子串。`re:` 正则两种模式都可用 |
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
npm test           # 50 项：原生逐项对照 + 目录分组/名字搜索/键位/配置/启动器/注册表/新建会话/空会话清理
npm run test:tui   # 真实 PTY：/r 流程、--rr 自动打开并恢复会话、--rr 取消后能输入、Shift+←/→ 全折叠与全展开、文件夹行 Shift+Enter 新建会话（含切走/退出后的自动清理，全程隔离 agent 目录）
```

## 已知限制

- 新终端中 pi 的可用性取决于目标机器 PATH/权限；`piPath` 用绝对路径最稳
- 活跃追踪只覆盖加载了本扩展的 pi 进程（外部手工 `pi --session` 打开的同文件会话不可见）

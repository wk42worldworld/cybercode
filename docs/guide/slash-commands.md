# 斜杠命令参考

这里的斜杠命令指输入 `/` 触发的 Slash Commands，不是 Windows 路径里的反斜杠 `\`。

## 三种入口

| 入口 | 怎么用 | 说明 |
|------|--------|------|
| 终端 TUI | 运行 `cybercode` 后，在输入框里输入 `/` | 最完整的交互式命令入口，适合会话、上下文、插件、MCP、权限等操作。 |
| 桌面端输入框 | 在桌面端聊天输入框里输入 `/` | 先处理桌面 UI 快捷入口，比如打开设置、模型、MCP、Skills、记忆面板；不支持的 TUI 命令会提示切到终端使用。 |
| 普通 shell | 直接运行 `cybercode <subcommand>` | 不是 Slash Command。用于脚本、CI 或不进入 TUI 的管理操作，比如 `cybercode mcp list`。 |

## 终端 TUI 内置命令

| 命令 | 别名 / 参数 | 作用 |
|------|-------------|------|
| `/help` | - | 显示帮助和当前可用命令。 |
| `/status` | - | 查看版本、模型、账号、API 连通性和工具状态。 |
| `/add-dir` | `<path>` | 给当前会话增加一个可访问的工作目录。 |
| `/context` | - | 查看当前上下文占用。交互模式会显示可视化网格。 |
| `/cost` | - | 查看当前会话的耗时和费用统计。 |
| `/clear` | `/reset`, `/new` | 清空当前对话历史，释放上下文。 |
| `/compact` | `[总结要求]` | 压缩对话历史，保留摘要继续工作。 |
| `/resume` | `/continue [会话 ID 或搜索词]` | 恢复历史会话。 |
| `/rename` | `[名称]` | 重命名当前会话。 |
| `/branch` | `/fork [名称]` | 从当前点创建会话分支。 |
| `/rewind` | `/checkpoint` | 回到之前的代码或对话检查点。 |
| `/exit` | `/quit` | 退出 REPL。 |
| `/copy` | `[N]` | 复制最近一次或第 N 条 AI 回复。 |
| `/export` | `[文件名]` | 导出当前对话到文件或剪贴板。 |
| `/diff` | - | 查看未提交改动和每轮对话产生的 diff。 |
| `/tasks` | `/bashes` | 查看和管理后台任务。 |
| `/buddy` | `[hatch|pet|mute|unmute|info]` | 打开陪伴/提示类交互功能。 |
| `/btw` | `<问题>` | 不打断主线任务，快速问一个旁路问题。 |
| `/plan` | `[open 或描述]` | 开启计划模式，或查看当前会话计划。 |
| `/review` | `[PR 编号]` | 让 Agent 审查 Pull Request。 |
| `/pr-comments` | `[PR 编号]` | 获取并整理 GitHub Pull Request 评论。 |
| `/security-review` | - | 对当前分支改动做安全审查。 |
| `/init` | - | 初始化项目的 `CYBER.md` 说明文件。 |
| `/statusline` | `[要求]` | 配置状态栏展示内容。 |
| `/insights` | - | 生成会话使用分析报告。 |
| `/model` | `[模型]` | 切换当前会话使用的模型。 |
| `/provider` | `/providers` | 配置或切换模型厂商，OpenAI 兼容接口会自动使用内置协议桥接。 |
| `/effort` | `low`, `medium`, `high`, `max`, `auto` | 调整模型推理强度。 |
| `/fast` | `on`, `off` | 在支持环境中切换快速模式。 |
| `/config` | `/settings` | 打开配置面板。 |
| `/permissions` | `/allowed-tools` | 管理工具允许和拒绝规则。 |
| `/sandbox` | `exclude "命令模式"` | 配置沙箱和命令排除规则。 |
| `/theme` | - | 切换终端主题。 |
| `/color` | `<颜色或 default>` | 设置当前会话提示栏颜色。 |
| `/vim` | - | 在 Vim 和普通编辑模式之间切换。 |
| `/terminal-setup` | - | 配置终端换行快捷键。 |
| `/keybindings` | - | 打开或创建键位配置文件。 |
| `/memory` | `status`, `log`, `edit`, `add`, `remove`, `replace`, `write` | 管理 CyberCode 长期记忆和指令文件。 |
| `/skills` | - | 查看当前可用 Skills。 |
| `/agents` | - | 管理自定义 Agent 配置。 |
| `/mcp` | `[enable 或 disable <server>]` | 管理 MCP 服务器和工具。 |
| `/plugin` | `/plugins`, `/marketplace` | 安装、启用、禁用、更新和管理插件。 |
| `/reload-plugins` | - | 让当前会话加载刚安装或修改的插件。 |
| `/hooks` | - | 查看工具事件 Hook 配置。 |
| `/ide` | `[open]` | 管理 IDE 集成并查看状态。 |
| `/doctor` | - | 诊断安装、配置和运行环境。 |
| `/login` | - | 登录或切换 Anthropic 账号。 |
| `/logout` | - | 退出 Anthropic 账号。 |
| `/release-notes` | - | 查看版本更新说明。 |
| `/feedback` | `/bug [内容]` | 提交反馈或问题报告。 |

## 条件启用命令

这些命令只会在对应平台、账号、功能开关或策略允许时出现。

| 命令 | 作用 |
|------|------|
| `/desktop` | 在支持的平台上把当前会话继续到桌面端。 |
| `/mobile` | 显示移动端下载二维码。 |
| `/chrome` | 配置 Claude in Chrome 集成。 |
| `/advisor` | 配置辅助 Advisor 模型。 |
| `/install-github-app` | 为仓库配置 GitHub Actions 集成。 |
| `/install-slack-app` | 安装 Slack 应用集成。 |
| `/privacy-settings` | 查看和更新隐私设置。 |
| `/stats` | 查看使用统计和活动数据。 |
| `/usage` | 查看订阅计划使用额度。 |
| `/extra-usage` | 在额度不足时配置额外使用量。 |
| `/upgrade` | 查看升级到更高额度方案的入口。 |
| `/remote-env` | 配置远程会话默认环境。 |
| `/remote-control` | 连接本地终端到远程控制会话，别名是 `/rc`。 |
| `/web-setup` | 配置网页版远程会话能力。 |
| `/session` | 查看远程会话 URL 和二维码。 |
| `/voice` | 切换语音模式。 |
| `/files` | 查看当前上下文里的文件列表。 |
| `/tag` | 给当前会话切换可搜索标签。 |
| `/ultrareview` | 在可用时启动更深入的远程 Bug 查找和验证流程。 |
| `/passes` | 分享 Claude Code 试用权益。 |
| `/stickers` | 打开贴纸申请入口。 |
| `/think-back` | 年度回顾类功能，只有功能开关开启时显示。 |

## 桌面端输入框快捷命令

桌面端输入框会提供下面这些固定命令。本地面板、设置和模型命令由前端直接处理，其余命令会发送到当前 Agent 会话执行。

| 命令 | 作用 |
|------|------|
| `/mcp` | 打开当前聊天可用的 MCP 工具面板。 |
| `/skills` | 打开 Skills 浏览面板。 |
| `/help` | 显示桌面端和 Agent 命令帮助。 |
| `/status` | 查看会话状态、用量和上下文。 |
| `/cost` | 查看会话用量和费用。 |
| `/context` | 查看当前上下文占用。 |
| `/doctor` | 打开桌面端诊断信息。 |
| `/memory` | 查看当前会话相关记忆文件。 |
| `/bug` | 打开反馈和问题报告入口。 |
| `/plugin` | 打开设置里的插件页面。 |
| `/config` | 打开桌面端配置。 |
| `/permissions` | 打开权限设置。 |
| `/terminal-setup` | 打开终端集成设置。 |
| `/login` | 打开模型厂商和账号登录设置。 |
| `/logout` | 打开账号退出相关设置。 |
| `/agents` | 打开 Agent 配置。 |
| `/compact` | 压缩对话上下文。 |
| `/clear` | 清空对话历史。 |
| `/review` | 发起代码审查类任务。 |
| `/commit` | 创建 Git commit。 |
| `/pr` | 创建 Pull Request。 |
| `/init` | 初始化项目 `CYBER.md`。 |
| `/model` | 打开模型切换入口。 |

桌面端别名：`/plugins` 等同 `/plugin`，`/feedback` 等同 `/bug`。

## 动态命令

下面几类命令不是固定写死的，所以不同项目、插件和 MCP 配置里会不一样。

| 来源 | 形式 | 说明 |
|------|------|------|
| 项目 Skills | `/skill-name` | 来自项目或用户目录里的 Skill。 |
| 插件 Skills | `/plugin-skill` | 插件安装后提供的 Skill。 |
| MCP Skills | `/mcp-skill` | MCP 服务器暴露的 Prompt 或 Skill。 |
| Workflow | `/workflow-name` | 工作流脚本转换出的命令。 |

如果命令列表和文档不一致，以当前会话里 `/help`、`/skills` 和输入 `/` 后的候选列表为准。

## 普通 shell 等价命令

这些不是 Slash Command，适合写脚本或在不进入 TUI 时使用。

| Shell 命令 | 作用 |
|------------|------|
| `cybercode mcp list` | 查看 MCP 服务器。 |
| `cybercode mcp add ...` | 添加 MCP 服务器。 |
| `cybercode mcp remove <name>` | 移除 MCP 服务器。 |
| `cybercode plugin list` | 查看已安装插件。 |
| `cybercode plugin install <plugin>` | 安装插件。 |
| `cybercode plugin uninstall <plugin>` | 卸载插件。 |
| `cybercode plugin marketplace list` | 查看插件市场。 |
| `cybercode agents` | 列出自定义 Agent。 |
| `cybercode doctor` | 检查运行环境和更新器状态。 |
| `cybercode auth login` | 登录 Anthropic 账号。 |
| `cybercode auth status` | 查看登录状态。 |
| `cybercode auth logout` | 退出登录。 |
| `cybercode update` | 检查并安装 CLI 更新。 |
| `cybercode --help` | 查看当前安装版本的完整 shell 命令。 |

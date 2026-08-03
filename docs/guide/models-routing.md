# 模型接入、同步与智能体路由

CyberCode 把模型接入分成清晰的目录，并让桌面端与终端 TUI 共用同一份本地配置。自定义提供商独立放在最前面，随后依次是官方 API Key、大型聚合站、OAuth、网页会话、图像/视频/音频与本地模型。自定义兼容端点不会再和 LM Studio、Ollama 等本地服务混在同一组。

## 选择接入方式

| 类型 | 适合场景 | 说明 |
| --- | --- | --- |
| 自定义提供商 | 已有兼容端点或自建网关 | 可填写 Base URL、协议、自定义模型 ID 和可选 API Key。 |
| 官方 API Key | 追求稳定、明确计费和官方服务保障 | Key 只保存在本机；不同产品线会保留独立入口，例如 Kimi Code 与 Kimi。 |
| 大型聚合站 | 希望用一套 Key 访问多个模型 | 可配置 OpenAI 或 Anthropic 兼容地址。 |
| OAuth | 提供商支持网页登录授权 | CyberCode 保存授权结果，并在提供商支持时自动刷新令牌。 |
| 网页会话 | 需要使用已有网站登录态 | 使用 Cookie、JWT 或网页令牌，稳定性、限流和账号条款风险高于官方 API。 |
| 图像/视频/音频 | 管理媒体模型目录和连接凭据 | 中国提供商优先展示；连接检查不会发起付费生成任务，媒体模型也不会自动成为聊天默认模型。 |
| 本地模型 | LM Studio、Ollama 等本地推理服务 | 直接连接本机服务；CyberCode 不会代替本地推理程序本身。 |

桌面端入口是 **设置 → 大模型与路由配置 → 大模型提供商**。服务商名称会跟随 CyberCode 的界面语言显示。

## OAuth 登录

打开 OAuth 卡片后，按卡片中的授权流程登录。认证完成后，卡片才会进入已连接的高亮状态。支持令牌轮换的提供商会由 CyberCode 在本机维护有效令牌，不需要用户反复粘贴短期凭据。

OAuth 授权范围和账号使用规则仍由对应服务商决定。断开连接会清理 CyberCode 保存的该项授权信息。

## 网页会话提供商

网页会话卡片会说明需要的 Cookie 或网页令牌。CyberCode 会规范化 Cookie、补充浏览器兼容请求头，并在上游返回新会话令牌时维护连续性。它不会读取浏览器数据、代替验证码、绕过账号限制或绕过地区限制。

### 最快配置方法

1. 打开提供商卡片，点击 **打开网站**，登录自己的账号并确认网页端可以正常发送消息。
2. 按 `F12` 打开浏览器开发者工具。弹窗会根据当前提供商明确显示应进入 **Application / Storage → Cookies**、**Local Storage** 还是 **Network**，以及需要查找的准确字段。
3. 复制字段值。Cookie 类可直接复制 `name=value`，多个字段用分号隔开；也可以从 **Network → Request Headers → Cookie** 复制完整 Cookie 值。
4. 回到 CyberCode，点击 **从剪贴板导入**，然后依次点击 **保存会话** 和 **测试**。只有测试成功后再将它设为默认提供商。

常见提供商的凭据位置如下。实际配置弹窗会始终显示当前提供商的准确字段和填写格式。

| 提供商 | 浏览器中的位置 | 需要复制 |
| --- | --- | --- |
| Kimi 网页版 | Application / Storage → Cookies | `kimi-auth`，或完整 Cookie 值 |
| Claude 网页版 | Application / Storage → Cookies | `sessionKey`，或完整 Cookie 值 |
| ChatGPT 网页版 | Application / Storage → Cookies | `__Secure-next-auth.session-token`，或完整 Cookie 值 |
| Gemini 网页版 | Application / Storage → Cookies | `__Secure-1PSID` 与 `__Secure-1PSIDTS` |
| DeepSeek 网页版 | Application / Storage → Local Storage | `userToken` 的值 |
| Microsoft Copilot 网页版 | Network 中的聊天请求 | `access_token` |
| Microsoft 365 Copilot | Network 中的 WebSocket 请求 URL | `access_token` 与 `chathubPath` |

浏览器会保护 HttpOnly Cookie，桌面应用不能在不扩大浏览器权限的情况下安全地静默读取。CyberCode 因此采用“用户主动复制 + 一键从剪贴板导入”：不会扫描浏览器配置，也不会保存长期剪贴板读取权限。

::: warning 使用前确认服务条款
网页接口随时可能变化，也可能触发网站限流或账号风控。只应使用你有权使用的账号和会话凭据；追求生产稳定性时优先选择官方 API。
:::

## 导入和同步模型

对于暴露兼容 `/models` 接口的 API Key、自定义或本地提供商，可以在卡片中选择 **同步最新模型**。CyberCode 会合并远端模型目录，并保留用户手动填写的模型。

开启 **实时同步** 后，CyberCode 会在启动后进行调度，并大约每 24 小时刷新一次支持的提供商。OAuth、网页会话和内置媒体目录由各自连接机制维护，不会被这项通用 `/models` 同步覆盖。

终端 TUI 提供同一能力：

```text
/provider status
/provider sync [提供商 ID 或名称]
/provider auto-sync on|off [提供商 ID 或名称]
```

## 创建智能体路由

在 **大模型与智能体路由 → 智能体路由** 中创建一条路由，加入一个或多个可用模型目标，然后选择策略。CyberCode 会根据目标可用性、健康记录和失败冷却决定下一次尝试；单个目标失败时，可以在允许的最大尝试次数内切换到后续目标。

路由只会使用已配置且当前可用的目标。缺少 Key、OAuth 已断开、被禁用或显式标记为不可路由的目标不会进入实际候选。

TUI 中可以直接管理和启用路由：

```text
/routing
/routing status
/routing create coding-fast 日常编码
/routing strategy coding-fast auto
/routing use coding-fast
/routing reset-health
```

`/route` 是 `/routing` 的别名。`create` 默认使用所有已配置且稳定的可用提供商；更精细的目标顺序和策略可以在桌面端编辑。

## 提供给其他 Agent

**节点**可以把已配置模型和智能体路由转换成受独立密钥保护的 OpenAI Chat Completions 与 Anthropic Messages 接口。外部 Agent 不会拿到原始提供商 Key。完整配置、TUI 命令和验证方法请看 [智能体节点接入](./agent-node.md)。

## 桌面端与 TUI 如何配合

桌面端和独立 TUI 共用提供商、模型同步、路由和节点配置。独立 TUI 会按需启动内置本地运行时，不需要安装额外代理。

如果 TUI 是由桌面端启动的受管子进程，则本地服务、自动同步和节点生命周期由桌面端统一持有，避免同一配置被两个进程并发修改。这种情况下请在桌面设置中管理节点。

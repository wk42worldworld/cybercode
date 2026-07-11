# 使用第三方模型

CyberCode 已内置模型协议转换能力。使用 OpenAI、Google Gemini、Kimi API 等 OpenAI 兼容接口时，不需要安装 LiteLLM、配置 Python 环境或单独启动代理。

## 命令行 TUI 配置

首次启动 CyberCode 时，按照界面依次完成：

1. 选择模型厂商。
2. 选择默认模型。
3. 填写厂商 API Key。
4. 完成配置并进入 TUI。

后续可随时在 TUI 输入：

```text
/provider
```

该命令可以切换已经保存的厂商，或添加新的厂商配置。API Key 只保存在本机的 CyberCode 配置目录中。

## 桌面端配置

1. 打开“设置 -> 模型厂商”。
2. 选择厂商预设或“自定义”。
3. 填写 API Key，选择模型。
4. 测试连接并启用该厂商。

桌面端和 TUI 共用厂商配置，通常无需重复填写。

## 支持的连接方式

CyberCode 会根据厂商自动选择连接方式：

| API 格式 | 连接方式 | 是否需要外部代理 |
| --- | --- | --- |
| Anthropic Messages | 直接连接厂商接口 | 否 |
| OpenAI Chat Completions | CyberCode 内置协议桥接 | 否 |
| OpenAI Responses | CyberCode 内置协议桥接 | 否 |

内置桥接仅监听本机 `127.0.0.1`，TUI 会自动选择空闲端口并随进程退出，不需要用户管理端口或后台服务。

## 内置厂商预设

当前向导包含 Claude Official、OpenAI、Google Gemini、DeepSeek、智谱 GLM、Kimi Code、Kimi API、MiniMax、小米 MiMo、LM Studio 和 Ollama。预设会自动填写官方 Base URL、API 格式、模型列表和上下文长度。

厂商发布新模型后，也可以在模型选择页选择“输入其他模型 ID”，无需等待客户端更新。

## 自定义厂商

选择“自定义”后，向导会额外询问：

1. 配置名称。
2. API Base URL。
3. API 格式：Anthropic Messages、OpenAI Chat Completions 或 OpenAI Responses。
4. 模型 ID。
5. API Key。

Base URL 填厂商文档给出的 API 根地址，不要自行追加 CyberCode 的 `/proxy` 路径。协议转换和 `/v1/messages` 路由由 CyberCode 自动处理。

## 本地模型

LM Studio 和 Ollama 仍需要各自的本地推理程序和已下载模型，但不需要额外的协议代理：

- LM Studio 默认地址：`http://localhost:1234`
- Ollama 默认地址：`http://localhost:11434`

请先确认本地模型服务正在运行，再在 `/provider` 中选择对应预设。

## 环境变量方式

CI、容器或脚本场景仍可直接使用环境变量连接 Anthropic 兼容接口：

```bash
export ANTHROPIC_BASE_URL="https://provider.example.com/anthropic"
export ANTHROPIC_AUTH_TOKEN="your-api-key"
export ANTHROPIC_MODEL="your-model-id"
cybercode -p "检查当前项目"
```

OpenAI 兼容接口建议通过 `/provider` 或桌面设置保存，这样 CyberCode 能自动启用内置协议桥接。

## 常见问题

### 配置后仍然连接旧模型

在当前 TUI 执行 `/provider` 并重新启用目标厂商。CyberCode 会刷新当前会话的认证和模型；已有回答中的签名思考块会被安全清理。

### 出现 401 或 403

检查 API Key 是否属于所选厂商、Base URL 是否正确，以及该 Key 是否有目标模型权限。

### 出现 404

自定义配置通常是 API 格式选错。确认厂商提供的是 Anthropic Messages、OpenAI Chat Completions 还是 OpenAI Responses。

### 以前配置了 LiteLLM 怎么办

原配置仍可作为“自定义 Anthropic Messages”端点使用，但 CyberCode 已不再要求 LiteLLM。也可以直接删除这层服务，改为在 `/provider` 中选择实际厂商。

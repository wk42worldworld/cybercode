# Desktop 常见问题 (FAQ)

## 使用自定义 Provider（如 Kimi）时，Web UI 提示 "401 API Key invalid" 怎么办？

### 现象
在 Desktop UI 中配置好自定义 Provider 后，发送聊天消息时返回 401 认证错误：
```
Error: Failed to authenticate. API Error: 401
{"error":{"type":"authentication_error","message":"The API Key appears to be invalid..."}}
```

### 根因
服务器曾将 Provider 的 API Key 以 `ANTHROPIC_AUTH_TOKEN` 的形式写入 `~/.cyber/cybercode/settings.json`，但 Anthropic SDK 对这两个环境变量的处理不同：

- `ANTHROPIC_AUTH_TOKEN` → 作为 `Authorization: Bearer <token>` 发送
- `ANTHROPIC_API_KEY` → 作为 `x-api-key` 发送

像 Kimi 这样的第三方 Provider 期望的是 `x-api-key`，错误的请求头导致认证失败。

此外，服务器在启动 CLI 子进程时会剥离所有继承的 `ANTHROPIC_*` 环境变量，但却没有将 `settings.json` 中管理的 Provider 配置重新注入，导致 CLI 子进程根本没有拿到任何凭证。

### 修复内容

#### 1. 修复 Provider 同步逻辑 (`src/server/services/providerService.ts`)
- 将 `ANTHROPIC_API_KEY` 加入 `MANAGED_ENV_KEYS`
- 修改 `syncToSettings()`，对于直连（非代理）Provider，写入 `ANTHROPIC_API_KEY` 而不是 `ANTHROPIC_AUTH_TOKEN`

#### 2. 修复子进程环境变量注入 (`src/server/services/conversationService.ts`)
- 在清理继承的环境变量后，服务器会读取 `~/.cyber/cybercode/settings.json`，并将托管的 Provider 配置重新注入 CLI 子进程

#### 3. 更新本地配置文件
将 `~/.cyber/cybercode/settings.json` 中的 `ANTHROPIC_AUTH_TOKEN` 替换为 `ANTHROPIC_API_KEY`：

**修改前：**
```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.kimi.com/coding/",
    "ANTHROPIC_AUTH_TOKEN": "sk-kimi-...",
    "ANTHROPIC_MODEL": "kimi-for-coding"
  }
}
```

**修改后：**
```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.kimi.com/coding/",
    "ANTHROPIC_API_KEY": "sk-kimi-...",
    "ANTHROPIC_MODEL": "kimi-for-coding"
  }
}
```

修改完成后，重启服务器即可生效。

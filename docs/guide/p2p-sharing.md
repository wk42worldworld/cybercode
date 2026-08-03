# P2P 大模型共享

P2P 共享让另一台 CyberCode 通过 8 位配对码使用本机已配置的模型。供应商 API Key 始终留在共享方设备上。

## 使用步骤

1. 共享方打开 **大模型与路由 → 大模型共享 → P2P 共享**，开启 **共享我的模型**。
2. 把界面中的 8 位配对码发给对方。
3. 对方只需输入配对码并点击 **连接**。
4. CyberCode 会自动完成信令、内网穿透和加密连接，然后在加入方创建并启用 P2P 模型来源。
5. 共享方可以在 **已连接设备** 中单独撤销某台设备。

配对码会自动轮换，已建立的连接不受影响。同一台共享设备可以同时连接多台设备。

## 连接方式

CyberCode 优先通过设备之间的加密 WebRTC DataChannel 传输模型请求；直连、STUN 和 TURN 均不可用时，会自动切换到同一 HTTPS 服务上的加密 WSS 通道：

- 普通网络使用 STUN 自动打洞直连。
- 对称 NAT 或受限网络下自动使用维护方配置的 TURN 备用通道。
- UDP 完全受限时使用 WSS 兜底；两端为每台设备临时协商 X25519 密钥，模型内容和 Gateway Key 以 AES-GCM 密文经过中继。
- 每台加入设备使用独立、可撤销的 Gateway Key。

## 维护者部署

终端用户不需要填写服务器地址。发布维护者需在后端运行信令服务，并把公网地址写入发布构建：

```bash
CYBERCODE_P2P_SIGNAL_PORT=8765 bun run p2p:signal
```

在 GitHub 仓库的 **Settings → Secrets and variables → Actions → Variables** 中设置：

```text
CYBERCODE_P2P_SIGNAL_URL=https://signal.example.com
```

桌面发布工作流会把该地址内置到四个平台的应用中；变量缺失或不是 HTTPS 地址时会停止发布。

反向代理需要将 `/p2p/ws` 升级为 WebSocket。推荐使用自动传输策略；可选的 TURN 参数由信令服务统一下发：

```bash
CYBERCODE_P2P_DATA_TRANSPORT=auto
CYBERCODE_P2P_STUN_URLS=stun:stun.cloudflare.com:3478,stun:stun.l.google.com:19302
CYBERCODE_P2P_TURN_URLS=turn:turn.example.com:3478?transport=udp,turn:turn.example.com:3478?transport=tcp
CYBERCODE_P2P_TURN_SECRET=replace-with-a-long-random-secret
```

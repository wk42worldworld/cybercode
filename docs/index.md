---
layout: home

hero:
  name: CyberCode
  text: 和你并肩战斗的AI编程伙伴
  tagline: '<span class="hero-promise">在 Claude Code 风格工作流上融合 Hermes 式自进化，持续沉淀记忆、技能与可复用工作方法。</span><span class="hero-provider">支持任意 Anthropic 兼容 API（MiniMax、OpenRouter 等）</span>'
  image:
    src: /images/cybercode-hero-character-v3.webp
    alt: CyberCode 女性角色
  actions:
    - theme: brand
      text: 安装 CLI
      link: /guide/quick-start
    - theme: alt
      text: 下载桌面端
      link: https://github.com/wk42worldworld/cybercode/releases/latest

features:
  - title: 完整 TUI 交互
    details: 与官方 Claude Code 一致的 Ink 终端界面，支持 --print 无头模式
  - title: 记忆系统
    details: 跨会话持久化记忆，自动提取、智能检索、AutoDream 做梦整合
    link: /memory/
  - title: 多 Agent 系统
    details: 多代理编排、并行任务执行、Teams 协作、Worktree 隔离
    link: /agent/
  - title: Skills 系统
    details: 可扩展能力插件、自定义工作流、条件激活
    link: /skills/01-usage-guide
  - title: 第三方模型支持
    details: 接入 OpenAI、DeepSeek、Ollama 等任意兼容模型
    link: /guide/third-party-models
  - title: IM 接入
    details: 在桌面端 webapp 配置 Telegram / 飞书，并通过独立 adapter 进程远程对话 Claude Code
    link: /im/
  - title: Computer Use
    details: 桌面控制功能 — 截屏、鼠标、键盘操作（Python Bridge 实现）
    link: /features/computer-use
  - title: 桌面端
    details: 基于 Tauri 2 + React 的图形化客户端，多标签、多会话、IM 适配器接入，支持 macOS 和 Windows
    link: /desktop/
---

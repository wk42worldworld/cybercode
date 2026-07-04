# Contributing to CyberCode

Thanks for helping CyberCode grow. The most useful contributions right now are clear bug reports, provider presets, docs, translations, desktop UX polish, and reproducible setup notes for different platforms.

## Quick Start

1. Fork the repository.
2. Install root dependencies:

```bash
bun install
```

3. If you work on the desktop app:

```bash
cd desktop
bun install
```

4. Create a focused branch:

```bash
git checkout -b docs/provider-guide
```

5. Make one focused change, then run the relevant checks.

## Useful Commands

| Area | Command |
|------|------|
| CLI | `bun run start` or `./bin/cybercode` |
| Desktop server | `SERVER_PORT=3456 bun run src/server/index.ts` |
| Desktop frontend | `cd desktop && bun run dev` |
| Desktop tests | `cd desktop && bun run test` |
| Desktop type-check | `cd desktop && bun run lint` |
| Desktop build | `cd desktop && bun run build` |
| Docs build | `bun run docs:build` |

## Good First Contributions

- Add or improve provider presets and setup notes.
- Improve screenshots, demos, and README examples.
- Translate missing docs or fix awkward translations.
- Reproduce an issue and add exact steps, logs, and platform details.
- Add small regression tests for desktop UI behavior.
- Improve install notes for Windows, Linux, Intel macOS, and Apple Silicon macOS.

## Pull Request Checklist

- Keep the PR focused on one user-visible improvement or one bug.
- Explain what changed and why.
- Include screenshots or short recordings for desktop UI changes.
- Mention which commands you ran.
- Hide API keys, tokens, cookies, and local private paths from logs and screenshots.
- Do not commit generated build artifacts unless the workflow explicitly requires them.

## Repository Conventions

- TypeScript uses 2-space indentation, ESM imports, and no semicolons.
- Desktop UI code lives in `desktop/src/`.
- Shared desktop components live in `desktop/src/components/`.
- API clients live in `desktop/src/api/`.
- Docs live in `docs/`, while GitHub landing pages live in `README*.md`.
- Branch names should use normal product prefixes such as `fix/xxx`, `feat/xxx`, or `docs/xxx`.

## 中文简述

欢迎贡献 CyberCode。当前最有价值的贡献方向是：补充模型供应商配置、改进文档和翻译、完善桌面端交互、提供可复现 bug 报告、补充不同平台安装说明。

提交 PR 前请尽量说明：

- 你改了什么
- 为什么要改
- 跑过哪些检查
- UI 改动是否有截图或录屏
- 日志和截图里是否已经隐藏 API Key、Token、Cookie 等敏感信息

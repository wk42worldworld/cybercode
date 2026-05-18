# CyberCode

<p align="center">
  <img src="docs/images/logo-horizontal.png" alt="CyberCode" width="480">
</p>

<div align="center">

[![GitHub Stars](https://img.shields.io/github/stars/wk42worldworld/cybercode?style=social)](https://github.com/wk42worldworld/cybercode/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/wk42worldworld/cybercode?style=social)](https://github.com/wk42worldworld/cybercode/network/members)
[![GitHub Issues](https://img.shields.io/github/issues/wk42worldworld/cybercode)](https://github.com/wk42worldworld/cybercode/issues)
[![GitHub Pull Requests](https://img.shields.io/github/issues-pr/wk42worldworld/cybercode)](https://github.com/wk42worldworld/cybercode/pulls)
[![English](https://img.shields.io/badge/English-Available-green)](README.md)
[![中文](https://img.shields.io/badge/中文-可用-green)](README.zh-CN.md)
[![日本語](https://img.shields.io/badge/日本語-Available-green)](README.ja.md)
[![한국어](https://img.shields.io/badge/한국어-현재-blue)](README.ko.md)
[![Docs](https://img.shields.io/badge/Documentation-Visit-D97757)](https://github.com/wk42worldworld/cybercode)

</div>

CyberCode는 **Claude Code의 제품 설계를 강하게 참고한** 로컬 실행 클라이언트입니다. MiniMax, OpenRouter 등 Anthropic 호환 API 엔드포인트를 연결할 수 있습니다. 완전한 TUI 외에도 Computer Use(macOS / Windows), Tauri + React 기반 **데스크톱 앱**, Telegram / Feishu를 통한 **원격 제어**를 제공합니다.

<p align="center">
  <a href="#기능">기능</a> · <a href="#아키텍처-개요">아키텍처</a> · <a href="#빠른-시작">빠른 시작</a> · <a href="docs/en/guide/env-vars.md">환경 변수</a> · <a href="docs/en/guide/faq.md">FAQ</a> · <a href="docs/en/guide/global-usage.md">전역 사용</a>
</p>

---

## 기능

- 공식 Claude Code에 가까운 Ink TUI 경험
- 스크립트와 CI를 위한 `--print` 헤드리스 모드
- MCP 서버, 플러그인, Skills 지원
- 사용자 지정 API 엔드포인트와 모델 지원([Third-Party Models Guide](docs/en/guide/third-party-models.md))
- **Memory System**: 세션 간 지속 메모리
- **Multi-Agent System**: 여러 Agent 편성, 병렬 작업, Teams 협업
- **Skills System**: 확장 가능한 능력 플러그인과 사용자 지정 워크플로
- **Channel System**: Telegram / Feishu / Discord 등 IM에서 Agent 원격 제어
- **Computer Use**: 스크린샷, 마우스, 키보드를 통한 데스크톱 제어
- **Desktop App**: Tauri 2 + React GUI 클라이언트, 멀티 탭 / 멀티 세션
- Recovery CLI 모드(`CYBERCODE_FORCE_RECOVERY_CLI=1 ./bin/cybercode`)

---

## 아키텍처 개요

<table>
  <tr>
    <td align="center" width="25%"><img src="docs/images/01-overall-architecture.png" alt="Overall architecture"><br><b>전체 아키텍처</b></td>
    <td align="center" width="25%"><img src="docs/images/02-request-lifecycle.png" alt="Request lifecycle"><br><b>요청 라이프사이클</b></td>
    <td align="center" width="25%"><img src="docs/images/03-tool-system.png" alt="Tool system"><br><b>도구 시스템</b></td>
    <td align="center" width="25%"><img src="docs/images/04-multi-agent.png" alt="Multi-agent architecture"><br><b>Multi-Agent 아키텍처</b></td>
  </tr>
  <tr>
    <td align="center" width="25%"><img src="docs/images/05-terminal-ui.png" alt="Terminal UI"><br><b>터미널 UI</b></td>
    <td align="center" width="25%"><img src="docs/images/06-permission-security.png" alt="Permissions and security"><br><b>권한과 보안</b></td>
    <td align="center" width="25%"><img src="docs/images/07-services-layer.png" alt="Services layer"><br><b>서비스 레이어</b></td>
    <td align="center" width="25%"><img src="docs/images/08-state-data-flow.png" alt="State and data flow"><br><b>상태와 데이터 흐름</b></td>
  </tr>
</table>

---

## 데스크톱 다운로드

<p align="center">
  <a href="https://github.com/wk42worldworld/cybercode/releases"><img src="https://img.shields.io/badge/Download_Desktop-macOS_%7C_Linux_%7C_Windows-D97757?style=for-the-badge" alt="Download Desktop"></a>
  &nbsp;
  <a href="docs/desktop/04-installation.md"><img src="https://img.shields.io/badge/Install_Guide-Guide-gray?style=for-the-badge" alt="Install Guide"></a>
</p>

---

## 빠른 시작

### 1. Bun 설치

```bash
# macOS / Linux
curl -fsSL https://bun.sh/install | bash

# macOS (Homebrew)
brew install bun

# Windows (PowerShell)
powershell -c "irm bun.sh/install.ps1 | iex"
```

> 최소 구성 Linux에서 `unzip is required`가 보이면 먼저 `apt update && apt install -y unzip`을 실행하세요.

### 2. 의존성 설치 및 설정

```bash
bun install
cp .env.example .env
# .env에 API Key를 입력하세요. 자세한 내용은 docs/en/guide/env-vars.md를 참고하세요.
```

### 3. 실행

#### macOS / Linux

```bash
./bin/cybercode                          # 대화형 TUI 모드
./bin/cybercode -p "your prompt here"    # 헤드리스 모드
./bin/cybercode --help                   # 모든 옵션 보기
```

#### Windows

> **필수 조건**: [Git for Windows](https://git-scm.com/download/win)가 설치되어 있어야 합니다.

```powershell
# PowerShell / cmd에서 Bun 직접 실행
bun --env-file=.env ./src/entrypoints/cli.tsx

# 또는 Git Bash에서 실행
./bin/cybercode
```

### 4. 전역 사용(선택)

`bin/`을 PATH에 추가하면 어떤 디렉터리에서도 실행할 수 있습니다.

```bash
export PATH="$HOME/path/to/cybercode/bin:$PATH"
```

---

## 기술 스택

| 분류 | 기술 |
|------|------|
| 런타임 | [Bun](https://bun.sh) |
| 언어 | TypeScript |
| 터미널 UI | React + [Ink](https://github.com/vadimdemedes/ink) |
| CLI 파서 | Commander.js |
| API | Anthropic SDK |
| 프로토콜 | MCP, LSP |

---

## 관련 문서

| 문서 | 설명 |
|------|------|
| [Environment Variables](docs/en/guide/env-vars.md) | 환경 변수와 설정 방법 |
| [Third-Party Models](docs/en/guide/third-party-models.md) | OpenAI / DeepSeek / Ollama 등 비 Anthropic 모델 연결 |
| [Memory System](docs/memory/01-usage-guide.md) | 세션 간 지속 메모리 |
| [Multi-Agent System](docs/agent/01-usage-guide.md) | Agent 편성, 병렬 작업, Teams 협업 |
| [Skills System](docs/skills/01-usage-guide.md) | 확장 가능한 능력 플러그인과 워크플로 |
| [Channel System](docs/en/channel/01-channel-system.md) | IM 플랫폼에서 원격 제어 |
| [Computer Use](docs/en/features/computer-use.md) | 데스크톱 제어 기능 |
| [Desktop App](docs/desktop/) | Tauri 2 + React GUI 클라이언트 |

---

## 감사

이 프로젝트는 React, Tauri, cc-switch 등 여러 오픈소스 프로젝트와 커뮤니티 사례에서 많은 참고와 영감을 얻었습니다.

---

## Disclaimer

이 프로젝트는 [Anthropic](https://www.anthropic.com)의 Claude Code 제품 설계, 상호작용 방식, 기능 아키텍처를 강하게 참고한 독립 구현입니다. Claude / Claude Code는 Anthropic의 상표이며 관련 API와 프로토콜은 Anthropic에 귀속됩니다. 이 프로젝트는 기술 학습과 연구 목적으로 제공되며 Anthropic과 상업적 관계가 없습니다.

# CyberCode

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/cybercode-wordmark-dark.png">
    <img src="docs/images/cybercode-wordmark.png" alt="CyberCode" width="520">
  </picture>
</p>

<p align="center">
  <strong>언어:</strong>
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <strong>한국어</strong>
</p>

<div align="center">

[![GitHub Stars](https://img.shields.io/github/stars/wk42worldworld/cybercode?style=social)](https://github.com/wk42worldworld/cybercode/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/wk42worldworld/cybercode?style=social)](https://github.com/wk42worldworld/cybercode/network/members)
[![GitHub Issues](https://img.shields.io/github/issues/wk42worldworld/cybercode)](https://github.com/wk42worldworld/cybercode/issues)
[![GitHub Pull Requests](https://img.shields.io/github/issues-pr/wk42worldworld/cybercode)](https://github.com/wk42worldworld/cybercode/pulls)
[![Docs](https://img.shields.io/badge/Documentation-Visit-D97757)](https://github.com/wk42worldworld/cybercode)

</div>

CyberCode는 **Claude Code의 제품 설계를 강하게 참고한** 로컬 실행 클라이언트입니다. MiniMax, OpenRouter 등 Anthropic 호환 API 엔드포인트를 연결할 수 있습니다. 완전한 TUI 외에도 Computer Use(macOS / Windows), Tauri + React 기반 **데스크톱 앱**, Telegram / Feishu를 통한 **원격 제어**를 제공합니다.

<p align="center">
  <a href="#기능">기능</a> · <a href="#아키텍처-개요">아키텍처</a> · <a href="#빠른-시작">빠른 시작</a> · <a href="#단계별-튜토리얼">튜토리얼</a> · <a href="docs/en/guide/env-vars.md">환경 변수</a> · <a href="docs/en/guide/faq.md">FAQ</a> · <a href="docs/en/guide/global-usage.md">전역 사용</a>
</p>

---

## 기능

- 공식 Claude Code에 가까운 Ink TUI 경험
- 스크립트와 CI를 위한 `--print` 헤드리스 모드
- MCP 서버, 플러그인, Skills 지원
- 사용자 지정 API 엔드포인트와 모델 지원([Third-Party Models Guide](docs/en/guide/third-party-models.md))
- 응답 실행 중 추가 입력을 보류 바에 저장하고 편집, 삭제, 현재 작업에 추가 가능
- 공급자 / 모델별 컨텍스트 윈도우 메타데이터 지원
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

> [Git for Windows](https://git-scm.com/download/win) 사용을 권장합니다. Git Bash가 없으면 CyberCode가 자동으로 PowerShell로 폴백합니다.

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

## 단계별 튜토리얼

CyberCode를 처음 사용한다면 아래 장을 순서대로 따라가세요. 각 장 끝의 “완료 결과”를 확인하면 다음 단계로 넘어갈 수 있는지 알 수 있습니다.

### 1장: 실행 방식 선택

CyberCode는 보통 세 가지 방식으로 사용합니다.

| 방식 | 적합한 상황 | 해야 할 일 |
|------|------|------|
| 데스크톱 앱 | 일상적인 코딩, 여러 세션, GUI에서 프로젝트 전환 | [GitHub Releases](https://github.com/wk42worldworld/cybercode/releases)에서 최신 패키지 다운로드 |
| 소스 기반 CLI | 터미널 중심 작업, 로컬 개발, 스크립트 실행 | 저장소를 clone하고 Bun을 설치한 뒤 `bun install` 실행 |
| 데스크톱 개발 모드 | React/Tauri 프런트엔드 검증 | API 서버와 Vite 프런트엔드를 함께 실행 |

완료 결과: 데스크톱 앱을 설치할지, CLI를 실행할지, 개발 모드로 확인할지 결정했습니다.

### 2장: 모델 공급자 준비

CyberCode는 Anthropic 호환 API와 통신합니다. MiniMax와 OpenRouter는 호환 엔드포인트가 있으면 직접 사용할 수 있습니다. OpenAI 형식만 지원하는 공급자는 일반적으로 LiteLLM 같은 프록시가 필요합니다.

1. 모델 공급자 콘솔에서 API Key를 만들거나 복사합니다.
2. 예시 환경 변수 파일을 복사합니다.

```bash
cp .env.example .env
```

3. `.env`를 열고 최소한 아래 값을 설정합니다.

```env
ANTHROPIC_AUTH_TOKEN=your_api_key_here
ANTHROPIC_BASE_URL=https://api.minimaxi.com/anthropic
ANTHROPIC_MODEL=MiniMax-M2.7
```

공급자가 `x-api-key` 헤더를 요구하면 `ANTHROPIC_AUTH_TOKEN` 대신 `ANTHROPIC_API_KEY`를 사용할 수 있습니다. 자세한 예시는 [Environment Variables](docs/en/guide/env-vars.md)와 [Third-Party Models](docs/en/guide/third-party-models.md)를 참고하세요.

완료 결과: `.env`에 유효한 키, 엔드포인트, 모델 이름이 들어 있습니다.

### 3장: 첫 CLI 작업 실행

먼저 대화형 TUI를 실행합니다.

```bash
./bin/cybercode
```

처음에는 작은 요청으로 시작하세요.

```text
이 프로젝트를 읽고 주요 엔트리 포인트를 요약해 주세요.
```

스크립트나 CI에서는 헤드리스 모드를 사용할 수 있습니다.

```bash
./bin/cybercode -p "package.json을 요약하고 사용 가능한 scripts를 나열해 주세요"
```

완료 결과: CyberCode가 모델 공급자에 연결되고 터미널에 답변을 스트리밍합니다.

### 4장: 실제 프로젝트 열기

CyberCode는 수정하려는 프로젝트 디렉터리를 볼 수 있을 때 가장 잘 동작합니다.

1. 프로젝트 루트에서 CyberCode를 시작하거나 데스크톱 앱에서 프로젝트 폴더를 선택합니다.
2. 먼저 작은 조사 작업을 요청합니다: `src/ 디렉터리 구조를 설명해 주세요`.
3. 명령 실행이나 파일 편집 권한을 요청하면 내용을 확인하고 신뢰하는 작업만 승인합니다.
4. 첫 답변이 성공하면 `이 파일의 실패하는 테스트를 수정해 주세요`처럼 범위가 좁은 작업을 요청합니다.

완료 결과: 어시스턴트가 올바른 디렉터리에서 작업하고, 어떤 파일과 명령을 쓰려는지 확인할 수 있습니다.

### 5장: 데스크톱 앱 편하게 사용

설치된 앱을 사용하는 경우 CyberCode를 열고 프로젝트 세션을 만들면 됩니다. 로컬 개발에서는 먼저 아래 명령을 실행합니다.

```bash
SERVER_PORT=3456 bun run src/server/index.ts
```

다른 터미널에서 다음을 실행합니다.

```bash
cd desktop
bun run dev --host 127.0.0.1 --port 2024
```

`http://127.0.0.1:2024`를 열고 세션을 만들거나 선택한 뒤 실제 작업 디렉터리를 지정합니다.

유용한 사용 습관:

- 어시스턴트가 응답 중일 때 새 메시지를 입력하면 보류 입력 행으로 저장됩니다.
- 보류 입력은 전송 전에 편집하거나 삭제할 수 있습니다.
- 현재 응답이 끝나면 대기 중인 보류 입력이 다음 사용자 메시지로 자동 전송됩니다.
- 모델에 직접 보낼 수 없는 파일 형식은 데스크톱 앱이 파일 경로로 전달하므로 Agent가 계속 처리할 수 있습니다.

완료 결과: 어시스턴트가 바쁜 동안 입력한 메시지를 잃지 않고 일반적인 다중 턴 코딩 세션을 이어갈 수 있습니다.

### 6장: 어디서나 CLI 사용

저장소의 `bin/` 디렉터리를 PATH에 추가합니다.

```bash
export PATH="$HOME/path/to/cybercode/bin:$PATH"
```

다른 프로젝트에서 확인합니다.

```bash
cybercode --help
cybercode -p "이 디렉터리에는 어떤 파일이 있나요?"
```

영구 적용하려면 이 `export PATH=...` 줄을 `~/.zshrc` 또는 `~/.bashrc`에 추가하세요.

완료 결과: 어떤 프로젝트 디렉터리에서도 `cybercode`를 실행할 수 있습니다.

### 7장: 첫 실행 문제 해결

| 문제 | 확인할 것 |
|------|------|
| `command not found: cybercode` | 저장소 안에서는 `./bin/cybercode`를 사용하거나 `bin/`을 PATH에 추가 |
| API Key 또는 401 오류 | `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, 모델 이름 재확인 |
| Windows 셸 명령 실패 | [Git for Windows](https://git-scm.com/download/win)를 설치하거나 PowerShell 폴백 사용 |
| 데스크톱이 연결되지 않음 | 서버가 `127.0.0.1:3456`에서 실행 중인지 확인 |
| 포트 `3456` 사용 중 | `lsof -nP -iTCP:3456 -sTCP:LISTEN`으로 PID를 찾고 `kill <PID>` 실행 |
| `Working directory does not exist` | 세션에서 실제 존재하는 프로젝트 폴더를 다시 선택 |
| 긴 프롬프트가 예상치 않게 실패 | 충분한 컨텍스트 윈도우를 가진 모델을 선택하거나 모델 설정 메타데이터 업데이트 |

완료 결과: 문제가 셸 설정, API 설정, 서버 실행, 프로젝트 경로 중 어디에 있는지 구분할 수 있습니다.

### 8장: 다음 기능 배우기

| 목표 | 다음 문서 |
|------|------|
| OpenAI, DeepSeek, Ollama 등 사용 | [Third-Party Models](docs/en/guide/third-party-models.md) |
| 모든 환경 변수 설정 | [Environment Variables](docs/en/guide/env-vars.md) |
| 어디서나 CyberCode 실행 | [Global Usage](docs/en/guide/global-usage.md) |
| 지속 메모리 사용 | [Memory System](docs/memory/01-usage-guide.md) |
| 여러 Agent 사용 | [Multi-Agent System](docs/agent/01-usage-guide.md) |
| Telegram 또는 Feishu 연결 | [Channel System](docs/en/channel/01-channel-system.md) |
| 데스크톱 앱 제어 | [Computer Use](docs/en/features/computer-use.md) |

완료 결과: 첫 동작 확인 후 필요한 기능 영역으로 자연스럽게 넘어갈 수 있습니다.

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

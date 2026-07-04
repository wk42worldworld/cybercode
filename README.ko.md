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
  <a href="#기능">기능</a> · <a href="#아키텍처-개요">아키텍처</a> · <a href="#빠른-시작">빠른 시작</a> · <a href="#단계별-튜토리얼">튜토리얼</a> · <a href="#기능-모듈별-튜토리얼">모듈별</a> · <a href="docs/en/guide/env-vars.md">환경 변수</a> · <a href="docs/en/guide/faq.md">FAQ</a> · <a href="docs/en/guide/global-usage.md">전역 사용</a>
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

## 기능 모듈별 튜토리얼

이 섹션은 기능별 실전 매뉴얼입니다. CyberCode를 실행할 수 있는 상태가 된 뒤 필요한 모듈부터 확인하세요.

### 모듈 1: 데스크톱 앱 설치와 업데이트

소스에서 실행하지 않고 일반 GUI 앱으로 사용하고 싶을 때의 절차입니다.

1. [GitHub Releases](https://github.com/wk42worldworld/cybercode/releases)를 엽니다.
2. 플랫폼에 맞는 패키지를 다운로드합니다.
   - macOS Apple Silicon: `macos_arm64_dmg.dmg`
   - macOS Intel: `macos_x64_dmg.dmg`
   - Windows x64: `windows_x64_nsis.exe`
   - Linux x64: `linux_x64_deb.deb`
3. OS의 일반 설치 방식으로 설치합니다.
4. CyberCode를 실행하고 새 세션을 만듭니다.
5. 첫 코딩 요청을 보내기 전에 실제 프로젝트 폴더를 선택합니다.

확인 결과: 앱이 열리고, 사이드바에 세션이 보이며, 상태 표시줄에 프로젝트와 모델이 표시됩니다.

주의:

- macOS 패키지는 notarization 되어 있습니다. 그래도 차단되면 [Installation](docs/desktop/04-installation.md)을 참고하세요.
- Release에는 데스크톱 업데이트 메타데이터용 `latest.json`도 포함됩니다.

### 모듈 2: 모델 공급자, 모델 매핑, 컨텍스트 윈도우

MiniMax, OpenRouter, 프록시를 통한 OpenAI, Ollama, 기타 호환 공급자를 사용할 때의 절차입니다.

1. 데스크톱 앱을 엽니다.
2. Settings -> Providers로 이동합니다.
3. 프리셋을 선택하거나 사용자 지정 공급자를 추가합니다.
4. 다음 값을 입력합니다.
   - 공급자 이름
   - API Key
   - Base URL
   - API 형식: `Anthropic`, `OpenAI Chat`, `OpenAI Responses`
   - 모델 매핑: `main`, `haiku`, `sonnet`, `opus`
5. 모델의 최대 컨텍스트를 알고 있다면 `200k` 또는 `1m`처럼 입력합니다.
6. Test Connection을 실행합니다.
7. 해당 공급자를 활성화합니다.
8. 상태 표시줄의 모델 이름을 클릭하고 현재 세션에서 사용할 모델을 선택합니다.

확인 결과: 짧은 메시지를 보낸 뒤 `/context` 또는 컨텍스트 패널에서 활성 모델과 컨텍스트 한도가 예상대로 보입니다.

주의:

- Anthropic 호환 엔드포인트는 공급자 URL을 직접 사용할 수 있습니다.
- OpenAI 형식만 지원하는 API는 LiteLLM 같은 프록시가 필요합니다. 자세한 내용은 [Third-Party Models](docs/en/guide/third-party-models.md)를 참고하세요.
- 모델 이름에 `200k` 또는 `1m` 같은 값이 있으면 추론할 수 있지만, 명시적으로 설정하는 편이 더 명확합니다.

### 모듈 3: CLI와 헤드리스 모드

터미널 작업, 자동화, CI에서 사용할 때의 절차입니다.

1. 의존성을 설치합니다.

```bash
bun install
```

2. 환경 변수 파일을 만듭니다.

```bash
cp .env.example .env
```

3. `.env`에 공급자 설정을 입력합니다.
4. 대화형 TUI를 실행합니다.

```bash
./bin/cybercode
```

5. 한 번만 실행하는 프롬프트를 보냅니다.

```bash
./bin/cybercode -p "이 저장소 구조를 설명해 주세요"
```

6. 사용 가능한 옵션을 확인합니다.

```bash
./bin/cybercode --help
```

확인 결과: 대화형 모드가 열리고, `-p`는 TUI를 열지 않고 완성된 답변을 출력합니다.

주의:

- Windows에서는 Git Bash 사용을 권장합니다. 없으면 CyberCode가 PowerShell로 폴백합니다.
- 어디서나 `cybercode`를 실행하려면 `bin/`을 PATH에 추가하세요.

### 모듈 4: 데스크톱 세션, 프로젝트, 탭

여러 프로젝트나 여러 작업을 정리할 때의 절차입니다.

1. 사이드바의 `+`를 클릭하거나 `Cmd/Ctrl + N`을 누릅니다.
2. 작업할 프로젝트 디렉터리를 선택합니다.
3. 먼저 `이 프로젝트 구조를 설명해 주세요` 같은 작은 조사 요청을 보냅니다.
4. 사이드바의 프로젝트 필터로 특정 프로젝트 세션만 표시합니다.
5. 사이드바 검색으로 이전 세션을 제목으로 찾습니다.
6. 세션을 우클릭하여 이름을 바꾸거나 삭제합니다.
7. 별도 작업을 유지하려면 여러 탭을 엽니다.
8. 탭 우클릭 메뉴로 현재 탭, 다른 탭, 왼쪽 탭, 오른쪽 탭, 전체 탭을 닫을 수 있습니다.

확인 결과: 각 세션이 올바른 프로젝트 경로에 연결되고, 상태 표시줄에 현재 프로젝트와 모델이 표시됩니다.

주의:

- 실행 중인 탭을 닫으면 계속 실행, 중지 후 닫기, 취소 중에서 선택하는 확인 창이 표시됩니다.
- 세션이 가리키는 폴더가 삭제된 경우 실제 존재하는 폴더를 다시 선택하세요.

### 모듈 5: 채팅 입력, 첨부, 슬래시 명령, 파일 참조, 보류 입력

복잡한 메시지를 보내거나 어시스턴트가 바쁠 때 다음 입력을 준비할 때의 절차입니다.

1. 하단 입력창에 내용을 작성합니다.
2. `Enter`로 전송하고, `Shift + Enter`로 줄바꿈합니다.
3. 붙여넣기, 드래그, `+` 파일 선택으로 첨부를 추가합니다.
4. `/`를 입력해 `/status`, `/context`, `/memory`, `/mcp`, `/skills` 같은 명령을 엽니다.
5. `@`를 입력해 프로젝트 파일을 검색하고 참조합니다.
6. 어시스턴트가 응답 중일 때 새 메시지를 보내면 보류 입력 행으로 저장됩니다.
7. 보류 입력은 전송 전 편집하거나 삭제할 수 있습니다.
8. 현재 응답이 끝나면 보류 입력이 다음 사용자 메시지로 자동 전송됩니다.
9. 생성을 중단하려면 Stop을 클릭하거나 `Cmd/Ctrl + .`을 누릅니다.

확인 결과: 첨부가 입력창 위에 표시되고, 슬래시 명령이 패널이나 명령을 열며, `@`가 파일 참조로 해석되고, 응답 중 입력이 사라지지 않습니다.

주의:

- 모델에 직접 보낼 수 없는 파일 형식은 파일 경로로 전달됩니다.
- 보류 입력 행은 실제 대기 중인 내용만 보여 주며 불필요한 설명 문구를 표시하지 않습니다.

### 모듈 6: 권한 제어와 도구 안전

CyberCode가 Shell 명령을 실행하거나 파일을 수정하기 전에 알아야 할 절차입니다.

1. 익숙하지 않은 저장소에서는 기본 확인 권한 모드를 유지합니다.
2. 권한 카드가 나오면 내용을 먼저 확인합니다.
3. 한 번만 허용하려면 Allow를 선택합니다.
4. 현재 세션에서 같은 종류의 작업을 신뢰할 수 있을 때만 Always Allow를 선택합니다.
5. 명령, 파일 경로, diff가 이상하면 Deny를 선택합니다.
6. 실행 없이 계획만 보고 싶으면 Plan mode를 사용합니다.
7. bypass permissions는 일회성 환경이나 완전히 신뢰하는 환경에서만 사용합니다.

확인 결과: 파일 편집과 Shell 명령은 권한 정책이 허용한 뒤에만 실행됩니다.

주의:

- 권한 카드에는 도구 유형, 명령 또는 파일 미리보기, 상세 파라미터가 표시됩니다.
- IM 어댑터에서도 권한 요청은 승인 버튼으로 표시됩니다.

### 모듈 7: 메모리 시스템

선호도, 프로젝트 규칙, 외부 참조를 세션 간에 기억하게 하고 싶을 때의 절차입니다.

1. 평소처럼 대화합니다. CyberCode는 유용한 정보를 자동 추출할 수 있습니다.
2. 명시적으로 저장하려면 `remember this: ...`라고 말합니다.
3. `/memory`로 편집 가능한 메모리 파일을 엽니다.
4. `/remember`로 자동 메모리를 검토, 승격, 병합, 정리합니다.
5. 더 이상 유효하지 않은 메모리는 잊어 달라고 요청합니다.
6. 깨끗한 답변이 필요하면 `ignore memory for this turn`이라고 말합니다.

확인 결과: 메모리 업데이트 알림이 나타나고, 이후 세션에서 저장된 선호도나 프로젝트 맥락을 사용할 수 있습니다.

저장하기 좋은 예:

- 테스트는 mock이 아니라 실제 데이터베이스를 사용해야 한다.
- 특정 날짜부터 릴리스 프리즈가 시작된다.
- 대시보드, 티켓 큐, on-call 정보가 외부 시스템에 있다.

주의:

- 메모리에는 코드만으로 추론할 수 없는 맥락을 저장하세요.
- 자동 메모리는 `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`로 비활성화할 수 있습니다.

### 모듈 8: Multi-Agent 워크플로와 Agent Teams

큰 작업을 병렬 조사, 계획, 검증으로 나누고 싶을 때의 절차입니다.

1. `프런트엔드, 백엔드, 테스트를 병렬로 조사한 뒤 계획해 주세요`처럼 요청합니다.
2. 읽기 전용 코드 조사는 Explore agent를 사용합니다.
3. 아키텍처와 구현 계획은 Plan agent를 사용합니다.
4. 완료된 변경의 독립 검증은 verification agent를 사용합니다.
5. 오래 걸릴 작업은 background agent를 요청합니다.
6. 실험적 구현은 worktree isolation을 요청해 메인 작업 트리를 보호합니다.
7. 협업형 작업은 역할이 나뉜 Agent Team을 만들어 달라고 요청합니다.

확인 결과: CyberCode가 agent 시작, 백그라운드 완료, 검증 결과, 팀 요약을 보고합니다.

주의:

- 각 agent의 요청은 집중된 범위로 작성하세요.
- 넓거나 위험한 변경은 verification agent로 확인한 뒤 신뢰하세요.

### 모듈 9: Skills, Plugins, MCP

반복 작업을 재사용 가능한 기능으로 만들고 싶을 때의 절차입니다.

1. `/`를 입력해 사용 가능한 명령을 봅니다.
2. 먼저 `/verify`, `/debug`, `/simplify`, `/remember`, `/batch` 같은 내장 Skills를 사용해 봅니다.
3. 데스크톱 앱에서는 `/skills`로 현재 컨텍스트에서 사용자가 호출할 수 있는 Skills를 확인합니다.
4. 프로젝트 Skill은 `.claude/skills/<skill-name>/SKILL.md`에 만듭니다.
5. frontmatter에 `description`, `when_to_use`, `allowed-tools`, `model`, `paths` 등을 설정합니다.
6. frontmatter 아래에 Markdown으로 워크플로를 작성합니다.
7. `/skill-name`으로 실행하거나, `when_to_use`에 맞는 자연어 작업을 요청합니다.
8. 외부 도구나 외부 prompt가 필요하면 MCP server를 연결합니다.

확인 결과: Skill이 슬래시 명령에 나타나거나, 해당 작업에서 모델이 자동 호출합니다.

주의:

- 강력한 Skill은 `allowed-tools`로 범위를 제한하세요.
- 프로젝트 Skills는 저장소에 둘 수 있어 팀 공유에 적합합니다.

### 모듈 10: Telegram / Feishu IM 원격 제어

휴대폰이나 팀 채팅에서 CyberCode를 원격으로 제어하고 싶을 때의 절차입니다.

1. 데스크톱 앱 Settings를 엽니다.
2. IM 또는 Adapters 설정으로 이동합니다.
3. `serverUrl`을 설정하고, 새 채팅을 특정 프로젝트에서 시작하려면 기본 프로젝트 디렉터리도 설정합니다.
4. 플랫폼 자격 증명을 입력합니다.
   - Telegram: Bot Token
   - Feishu: App ID와 App Secret
5. 필요하면 allowed users를 설정합니다.
6. 6글자 페어링 코드를 생성합니다.
7. adapter 프로세스를 시작합니다.

```bash
cd adapters
bun install
bun run telegram
# 또는
bun run feishu
```

8. IM 개인 채팅에서 Bot에게 페어링 코드를 보냅니다.
9. 페어링 후 일반 코딩 요청을 보냅니다.
10. 필요하면 `/new`, `/projects`, `/stop`을 사용합니다.

확인 결과: Bot이 CyberCode 세션에 연결되고, 답변을 스트리밍하며, 권한 요청을 버튼으로 표시합니다.

주의:

- 페어링 코드는 1회용이며 60분 후 만료됩니다.
- 기본 프로젝트가 없으면 Bot이 최근 프로젝트 중에서 선택하라고 요청합니다.

### 모듈 11: 예약 작업

정해진 일정에 따라 CyberCode가 prompt를 실행하게 하고 싶을 때의 절차입니다.

1. 데스크톱 앱을 엽니다.
2. 사이드바의 시계 아이콘을 클릭합니다.
3. New Task를 클릭합니다.
4. 작업 이름과 prompt를 입력합니다.
5. cron 식 또는 요일/시간 UI로 일정을 설정합니다.
6. 실행에 사용할 모델과 권한 모드를 선택합니다.
7. 작업을 저장합니다.
8. enable switch로 활성화하거나 일시 중지합니다.
9. Run Now로 수동 테스트합니다.
10. run history를 펼쳐 이전 결과를 확인합니다.

확인 결과: 작업 목록에 읽기 쉬운 일정이 표시되고, 수동 실행 후 기록이 생성됩니다.

주의:

- 예약 작업은 데스크톱 앱과 로컬 서비스가 사용 가능한 동안 실행됩니다.
- 무인 작업에는 보수적인 권한 모드를 권장합니다.

### 모듈 12: Computer Use

스크린샷, 마우스, 키보드로 데스크톱 앱을 조작하게 하고 싶을 때의 절차입니다.

1. Bun 의존성이 설치되어 있는지 확인합니다.
2. Python 3.8 이상을 확인합니다.

```bash
python3 --version
```

3. macOS에서는 터미널 또는 데스크톱 앱 호스트에 Accessibility와 Screen Recording 권한을 부여합니다.
4. CyberCode를 시작합니다.
5. `스크린샷을 찍고 무엇이 열려 있는지 알려 주세요` 같은 관찰 가능한 요청을 보냅니다.
6. CyberCode가 앱 접근 권한을 요청하면 승인합니다.
7. 모델이 스크린샷, 분석, 클릭, 입력, 확인을 단계별로 진행하게 합니다.

확인 결과: CyberCode가 스크린샷을 찍고 앱 접근 권한을 요청하며 승인된 앱만 조작합니다.

주의:

- macOS Apple Silicon, macOS Intel, Windows x64를 지원합니다.
- `CLAUDE_COMPUTER_USE_ENABLED=0`으로 비활성화할 수 있습니다.
- 처음에는 단순하고 관찰 가능한 작업부터 테스트하세요.

### 모듈 13: 진단, 컨텍스트, 사용량 확인

세션 상태가 이상하거나 현재 컨텍스트와 사용량을 확인하고 싶을 때의 절차입니다.

1. `/status`로 현재 세션 상태를 확인합니다.
2. `/context`로 컨텍스트 사용량, 남은 token, 메시지와 도구 결과 비율을 확인합니다.
3. `/cost`로 가능한 사용량과 비용 정보를 확인합니다.
4. `/doctor`로 로컬 환경 상태를 확인합니다.
5. 로컬 데스크톱 서버 테스트에는 `curl http://127.0.0.1:3456/health`를 사용합니다.
6. 공급자가 실패하면 Settings -> Providers에서 연결 테스트를 실행합니다.
7. 데스크톱이 세션에 연결되지 않으면 프로젝트 디렉터리가 아직 존재하는지 확인합니다.

확인 결과: 문제가 공급자 설정, 컨텍스트 압박, 로컬 서버 상태, 프로젝트 경로 중 어디에 있는지 구분할 수 있습니다.

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

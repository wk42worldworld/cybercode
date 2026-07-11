# 빠른 시작

## CLI 설치(권장)

### macOS / Linux

```bash
curl -fsSL https://raw.githubusercontent.com/wk42worldworld/cybercode/main/scripts/install-cli.sh | bash
```

### Windows PowerShell

```powershell
irm https://raw.githubusercontent.com/wk42worldworld/cybercode/main/scripts/install-cli.ps1 | iex
```

설치 프로그램은 GitHub의 최신 안정 버전을 가져오고, 필요한 경우 Bun을 설치한 뒤 `cybercode`를 사용자 PATH에 추가합니다. 관리자 권한은 필요하지 않습니다. 같은 명령을 다시 실행하면 업데이트되며 기존 CLI `.env`는 보존됩니다.

설치 스크립트는 공개되어 있습니다: [macOS/Linux](https://github.com/wk42worldworld/cybercode/blob/main/scripts/install-cli.sh) · [Windows](https://github.com/wk42worldworld/cybercode/blob/main/scripts/install-cli.ps1)

## Agent 시작

새 터미널을 열고 프로젝트 디렉터리로 이동한 뒤 실행합니다.

```bash
cd /path/to/your-project
cybercode
```

## 첫 실행: 마법사에서 모델 설정

처음 실행하기 전에 LiteLLM을 설치하거나 프록시와 `.env`를 직접 설정할 필요가 없습니다. 터미널 안내를 따라 진행하세요.

1. 터미널 테마를 선택합니다.
2. 모델 공급자를 선택합니다. 데스크톱 앱에 저장된 공급자는 목록 맨 위에 표시됩니다.
3. 기본 모델을 선택합니다. 새 모델이 아직 목록에 없으면 "다른 모델 ID 입력"을 선택합니다.
4. 필요한 경우에만 API Key를 입력합니다. LM Studio와 Ollama처럼 Key가 필요 없는 로컬 서비스는 이 단계를 자동으로 건너뜁니다.
5. 현재 프로젝트 디렉터리를 신뢰할 수 있는지 확인한 뒤 채팅 화면으로 들어갑니다.

| 공급자 유형 | 예시 | 연결 방식 |
|------|------|------|
| Claude 공식 | Claude 계정, Anthropic Console Key | 직접 연결 |
| OpenAI 호환 | OpenAI, Google Gemini, Kimi API | 내장 프로토콜 브리지 |
| Anthropic 호환 | DeepSeek, GLM, Kimi Code, MiniMax, Xiaomi MiMo | 직접 연결 |
| 로컬 모델 | LM Studio, Ollama | 로컬 서비스에 직접 연결 |

::: tip 추가 프록시가 필요하지 않습니다
OpenAI Chat Completions와 OpenAI Responses 변환 기능이 CyberCode에 내장되어 있습니다. 브리지는 로컬 `127.0.0.1`에서만 수신하고 빈 포트를 자동 선택하며 TUI가 종료될 때 함께 중지됩니다.
:::

### 나중에 공급자 추가 또는 전환

TUI에서 다음 명령을 실행합니다.

```text
/provider
```

저장된 공급자를 활성화하거나 공급자, 모델, API Key 설정을 다시 진행할 수 있습니다. `/providers`는 같은 명령의 별칭이며 `/model`은 현재 공급자의 모델을 전환합니다.

데스크톱 앱과 TUI는 공급자 설정을 공유합니다. 연결 테스트와 역할별 모델 매핑은 데스크톱 앱의 Settings -> Providers에서 설정할 수 있습니다.

### 로컬 모델 안내

LM Studio 또는 Ollama를 사용하려면 해당 앱 설치, 모델 다운로드, 로컬 서버 시작이 필요합니다. 별도의 프로토콜 프록시는 필요하지 않습니다.

- LM Studio: `http://localhost:1234`
- Ollama: `http://localhost:11434`

사용자 지정 Base URL, API 형식, 문제 해결은 [서드파티 모델](../../en/guide/third-party-models.md)을 참고하세요. 환경 변수는 주로 CI와 헤드리스 실행에 사용합니다.

## 자주 사용하는 CLI 명령

옵션은 함께 사용할 수 있습니다. 예를 들어 모델을 선택하고 JSON 출력으로 한 번의 헤드리스 작업을 실행할 수 있습니다.

### 세션과 모델

| 명령 | 용도 |
|------|------|
| `cybercode` | 현재 프로젝트에서 대화형 TUI 시작 |
| `cybercode "이 저장소를 설명해 줘"` | 첫 작업을 지정해 대화형 세션 시작 |
| `cybercode -c` | 현재 프로젝트의 가장 최근 대화 계속하기 |
| `cybercode -r` | 세션 선택 화면에서 저장된 대화 다시 시작 |
| `cybercode -r <session-id>` | 세션 ID로 대화 다시 시작 |
| `cybercode -n api-refactor` | 새 세션에 알아보기 쉬운 이름 설정 |
| `cybercode --model <model>` | 현재 세션에서 사용할 모델 또는 별칭 선택 |
| `cybercode --permission-mode plan` | 계획 모드로 시작 |
| `cybercode --add-dir ../shared` | Agent가 추가 디렉터리에 접근하도록 허용 |

### 스크립트, CI, 구조화 출력

| 명령 | 용도 |
|------|------|
| `cybercode -p "실패한 테스트를 수정해 줘"` | 최종 결과를 출력하고 종료 |
| `cybercode -p --output-format json "변경 사항을 요약해 줘"` | 하나의 JSON 결과 반환 |
| `cybercode -p --output-format stream-json "테스트를 실행해 줘"` | JSON 이벤트를 실시간으로 출력 |
| `cybercode -p --json-schema '{"type":"object"}' "프로젝트를 분석해 줘"` | JSON Schema로 구조화 출력 제한 |
| `cybercode -p --max-budget-usd 1.00 "코드를 검토해 줘"` | 한 번의 헤드리스 작업에 비용 한도 설정 |
| `cybercode -w feature-name` | 격리된 Git worktree를 만들고 세션 시작 |

### 도구, MCP, 플러그인

| 명령 | 용도 |
|------|------|
| `cybercode --allowed-tools "Read,Glob,Grep"` | 지정한 도구만 허용 |
| `cybercode --disallowed-tools "Bash"` | 지정한 도구 사용 금지 |
| `cybercode mcp list` | 구성된 MCP 서버 목록 표시 |
| `cybercode mcp --help` | MCP 추가, 제거, 확인 명령 표시 |
| `cybercode plugin list` | 설치된 플러그인 목록 표시 |
| `cybercode plugin --help` | 플러그인 설치, 업데이트, 마켓플레이스 명령 표시 |
| `cybercode agents` | 구성된 사용자 지정 Agent 목록 표시 |
| `cybercode doctor` | 실행 환경과 업데이트 프로그램 상태 확인 |
| `cybercode --version` | 설치된 버전 표시 |
| `cybercode --help` | 모든 최상위 옵션과 하위 명령 표시 |

전체 옵션은 설치된 버전의 `cybercode --help` 출력을 기준으로 확인하세요.

## 데스크톱 슬래시 명령

데스크톱 채팅 입력창에서 `/`를 입력하면 명령을 검색하고 실행할 수 있습니다. 여기서 사용하는 문자는 슬래시 `/`이며 Windows 경로의 백슬래시 `\`가 아닙니다.

| 분류 | 지원 명령 |
|------|-----------|
| 정보 및 도구 패널 | `/help`, `/status`, `/cost`, `/context`, `/mcp`, `/skills`, `/doctor`, `/memory`, `/bug` |
| 설정 및 계정 | `/plugin`, `/config`, `/permissions`, `/terminal-setup`, `/login`, `/logout`, `/agents` |
| 세션 및 개발 작업 | `/model`, `/compact`, `/clear`, `/review`, `/commit`, `/pr`, `/init` |

`/plugins`는 `/plugin`의 별칭이고 `/feedback`은 `/bug`의 별칭입니다. 현재 프로젝트의 Skills, 플러그인, MCP Prompt, Workflow도 `/` 제안 목록에 동적으로 추가될 수 있습니다.

각 명령의 동작, 터미널 TUI 명령, 조건부 명령 및 shell 대응 명령은 [전체 슬래시 명령 참조](./slash-commands.md)를 확인하세요.

## 소스에서 실행

CyberCode를 개발하거나 소스 코드를 직접 수정할 때 사용합니다.

```bash
git clone https://github.com/wk42worldworld/cybercode.git
cd cybercode
bun install
./bin/cybercode
```

미리 `.env`를 만들 필요가 없습니다. 실행 후 같은 공급자 설정 마법사를 사용할 수 있습니다.

Windows PowerShell / cmd에서는 마지막 줄을 `.\bin\cybercode.cmd`로 바꾸세요.

## 복구 모드

Ink TUI에 문제가 있으면 Recovery CLI를 사용할 수 있습니다.

```bash
CYBERCODE_FORCE_RECOVERY_CLI=1 cybercode
```

```powershell
$env:CYBERCODE_FORCE_RECOVERY_CLI = "1"
cybercode
```

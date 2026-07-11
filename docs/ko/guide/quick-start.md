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

처음 실행하면 설정 흐름이 열립니다. 공급자 설정에 대한 자세한 내용은 [환경 변수](../../en/guide/env-vars.md)와 [서드파티 모델](../../en/guide/third-party-models.md)을 참고하세요.

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

## 소스에서 실행

CyberCode를 개발하거나 소스 코드를 직접 수정할 때 사용합니다.

```bash
git clone https://github.com/wk42worldworld/cybercode.git
cd cybercode
bun install
cp .env.example .env
./bin/cybercode
```

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

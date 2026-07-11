# 슬래시 명령 참조

슬래시 명령은 `/`로 시작하는 명령입니다. Windows 경로에서 쓰는 백슬래시 `\`와는 다릅니다.

## 세 가지 진입점

| 진입점 | 사용 방법 | 설명 |
|--------|-----------|------|
| 터미널 TUI | `cybercode`를 실행한 뒤 입력창에서 `/` 입력 | 세션, 컨텍스트, 플러그인, MCP, 권한 등을 다루는 가장 완전한 대화형 명령 표면입니다. |
| 데스크톱 입력창 | 데스크톱 앱의 채팅 입력창에서 `/` 입력 | Settings, Models, MCP, Skills, Memory 같은 UI 바로가기를 먼저 처리합니다. 지원하지 않는 TUI 명령은 터미널 사용을 안내합니다. |
| 일반 shell | `cybercode <subcommand>` 실행 | 슬래시 명령이 아닙니다. 스크립트, CI, `cybercode mcp list` 같은 관리 작업에 사용합니다. |

## 터미널 TUI 내장 명령

| 명령 | 별칭 / 인수 | 용도 |
|------|-------------|------|
| `/help` | - | 도움말과 현재 사용 가능한 명령을 표시합니다. |
| `/status` | - | 버전, 모델, 계정, API 연결, 도구 상태를 표시합니다. |
| `/add-dir` | `<path>` | 현재 세션에서 접근할 수 있는 작업 디렉터리를 추가합니다. |
| `/context` | - | 현재 컨텍스트 사용량을 표시합니다. 대화형 모드에서는 시각적 그리드로 표시됩니다. |
| `/cost` | - | 현재 세션의 시간과 비용을 표시합니다. |
| `/clear` | `/reset`, `/new` | 대화 기록을 지우고 컨텍스트를 비웁니다. |
| `/compact` | `[요약 지시]` | 대화 기록을 압축하고 요약을 남겨 계속 작업합니다. |
| `/resume` | `/continue [대화 ID 또는 검색어]` | 이전 대화를 다시 시작합니다. |
| `/rename` | `[이름]` | 현재 대화 이름을 변경합니다. |
| `/branch` | `/fork [이름]` | 현재 지점에서 대화 브랜치를 만듭니다. |
| `/rewind` | `/checkpoint` | 코드 또는 대화를 이전 지점으로 되돌립니다. |
| `/exit` | `/quit` | REPL을 종료합니다. |
| `/copy` | `[N]` | 최신 또는 N번째 최신 AI 응답을 복사합니다. |
| `/export` | `[파일 이름]` | 현재 대화를 파일 또는 클립보드로 내보냅니다. |
| `/diff` | - | 커밋되지 않은 변경과 턴별 diff를 표시합니다. |
| `/tasks` | `/bashes` | 백그라운드 작업을 보고 관리합니다. |
| `/buddy` | `[hatch|pet|mute|unmute|info]` | 동반자와 힌트형 상호작용 기능을 엽니다. |
| `/btw` | `<질문>` | 주 작업을 끊지 않고 짧은 사이드 질문을 합니다. |
| `/plan` | `[open 또는 설명]` | 계획 모드를 켜거나 현재 계획을 표시합니다. |
| `/review` | `[PR 번호]` | Agent에게 Pull Request 리뷰를 요청합니다. |
| `/pr-comments` | `[PR 번호]` | GitHub Pull Request 댓글을 가져와 정리합니다. |
| `/security-review` | - | 현재 브랜치 변경을 보안 관점에서 리뷰합니다. |
| `/init` | - | 프로젝트 `CYBER.md` 파일을 초기화합니다. |
| `/statusline` | `[지시]` | 상태 줄 출력을 설정합니다. |
| `/insights` | - | CyberCode 세션 분석 보고서를 생성합니다. |
| `/model` | `[모델]` | 현재 세션에서 사용할 모델을 전환합니다. |
| `/provider` | `/providers` | 모델 공급자를 설정하거나 전환합니다. OpenAI 호환 API는 내장 프로토콜 브리지를 사용합니다. |
| `/effort` | `low`, `medium`, `high`, `max`, `auto` | 모델 추론 강도를 조정합니다. |
| `/fast` | `on`, `off` | 사용 가능한 경우 빠른 모드를 전환합니다. |
| `/config` | `/settings` | 설정 패널을 엽니다. |
| `/permissions` | `/allowed-tools` | 도구 허용 및 거부 규칙을 관리합니다. |
| `/sandbox` | `exclude "command pattern"` | 샌드박스와 명령 제외 규칙을 설정합니다. |
| `/theme` | - | 터미널 테마를 변경합니다. |
| `/color` | `<색상 또는 default>` | 세션의 프롬프트 바 색상을 설정합니다. |
| `/vim` | - | Vim 편집 모드와 일반 편집 모드를 전환합니다. |
| `/terminal-setup` | - | 터미널 줄바꿈 단축키를 설정합니다. |
| `/keybindings` | - | 키 바인딩 설정 파일을 열거나 만듭니다. |
| `/memory` | `status`, `log`, `edit`, `add`, `remove`, `replace`, `write` | CyberCode 장기 기억과 지시 파일을 관리합니다. |
| `/skills` | - | 사용 가능한 Skills를 표시합니다. |
| `/agents` | - | 사용자 지정 Agent 설정을 관리합니다. |
| `/mcp` | `[enable 또는 disable <server>]` | MCP 서버와 도구를 관리합니다. |
| `/plugin` | `/plugins`, `/marketplace` | 플러그인을 설치, 활성화, 비활성화, 업데이트, 관리합니다. |
| `/reload-plugins` | - | 현재 세션에 대기 중인 플러그인 변경을 적용합니다. |
| `/hooks` | - | 도구 이벤트 Hook 설정을 표시합니다. |
| `/ide` | `[open]` | IDE 연동을 관리하고 상태를 표시합니다. |
| `/doctor` | - | 설치, 설정, 실행 환경을 진단합니다. |
| `/login` | - | Anthropic 계정에 로그인하거나 계정을 전환합니다. |
| `/logout` | - | Anthropic 계정에서 로그아웃합니다. |
| `/release-notes` | - | 릴리스 노트를 표시합니다. |
| `/feedback` | `/bug [내용]` | 피드백 또는 버그 보고를 보냅니다. |

## 조건부 명령

이 명령들은 플랫폼, 계정 유형, 기능 플래그, 정책이 허용할 때만 표시됩니다.

| 명령 | 용도 |
|------|------|
| `/desktop` | 지원 플랫폼에서 현재 세션을 데스크톱 앱으로 이어서 진행합니다. |
| `/mobile` | 모바일 앱 다운로드 QR 코드를 표시합니다. |
| `/chrome` | Claude in Chrome 연동을 설정합니다. |
| `/advisor` | 보조 Advisor 모델을 설정합니다. |
| `/install-github-app` | 저장소에 GitHub Actions 연동을 설정합니다. |
| `/install-slack-app` | Slack 앱 연동을 설치합니다. |
| `/privacy-settings` | 개인정보 설정을 보고 업데이트합니다. |
| `/stats` | 사용 통계와 활동을 표시합니다. |
| `/usage` | 플랜 사용 한도를 표시합니다. |
| `/extra-usage` | 한도에 도달했을 때 추가 사용량을 설정합니다. |
| `/upgrade` | 더 높은 한도로 업그레이드하는 입구를 표시합니다. |
| `/remote-env` | 원격 세션의 기본 환경을 설정합니다. |
| `/remote-control` | 로컬 터미널을 원격 제어 세션에 연결합니다. 별칭은 `/rc`입니다. |
| `/web-setup` | 웹 기반 원격 세션 기능을 설정합니다. |
| `/session` | 원격 세션 URL과 QR 코드를 표시합니다. |
| `/voice` | 음성 모드를 전환합니다. |
| `/files` | 현재 컨텍스트에 있는 파일 목록을 표시합니다. |
| `/tag` | 현재 세션에 검색 가능한 태그를 토글합니다. |
| `/ultrareview` | 사용 가능한 경우 더 깊은 원격 버그 탐색과 검증 흐름을 시작합니다. |
| `/passes` | Claude Code 체험 권한을 공유합니다. |
| `/stickers` | 스티커 신청 흐름을 엽니다. |
| `/think-back` | 연말 회고형 기능입니다. 활성화된 경우에만 표시됩니다. |

## 데스크톱 입력창 바로가기

데스크톱 입력창은 다음 고정 명령을 제공합니다. 로컬 패널, 설정 및 모델 명령은 프런트엔드에서 직접 처리하며 나머지는 현재 Agent 세션으로 전송됩니다.

| 명령 | 용도 |
|------|------|
| `/mcp` | 현재 채팅에서 사용할 수 있는 MCP 도구를 엽니다. |
| `/skills` | Skills 브라우저를 엽니다. |
| `/help` | 데스크톱과 Agent 명령 도움말을 표시합니다. |
| `/status` | 세션 상태, 사용량, 컨텍스트를 표시합니다. |
| `/cost` | 세션 사용량과 비용을 표시합니다. |
| `/context` | 현재 컨텍스트 사용량을 표시합니다. |
| `/doctor` | 데스크톱 진단을 엽니다. |
| `/memory` | 이 세션의 기억 파일을 확인합니다. |
| `/bug` | 피드백과 버그 보고 입구를 엽니다. |
| `/plugin` | 플러그인 설정을 엽니다. |
| `/config` | 데스크톱 설정을 엽니다. |
| `/permissions` | 권한 설정을 엽니다. |
| `/terminal-setup` | 터미널 연동 설정을 엽니다. |
| `/login` | 공급자와 계정 로그인 설정을 엽니다. |
| `/logout` | 계정 로그아웃 설정을 엽니다. |
| `/agents` | Agent 설정을 엽니다. |
| `/compact` | 대화 컨텍스트를 압축합니다. |
| `/clear` | 대화 기록을 지웁니다. |
| `/review` | 코드 리뷰 작업을 시작합니다. |
| `/commit` | Git commit을 만듭니다. |
| `/pr` | Pull Request를 만듭니다. |
| `/init` | 프로젝트 `CYBER.md`를 초기화합니다. |
| `/model` | 모델 전환을 엽니다. |

데스크톱 별칭: `/plugins`는 `/plugin`과 같고, `/feedback`은 `/bug`와 같습니다.

## 동적 명령

아래 명령은 고정되어 있지 않으며 프로젝트, 플러그인, MCP 설정에 따라 달라집니다.

| 출처 | 형식 | 설명 |
|------|------|------|
| Project Skills | `/skill-name` | 사용자 또는 프로젝트 디렉터리에서 로드되는 Skill입니다. |
| Plugin Skills | `/plugin-skill` | 설치된 플러그인이 제공하는 Skill입니다. |
| MCP Skills | `/mcp-skill` | MCP 서버가 노출하는 Prompt 또는 Skill입니다. |
| Workflow | `/workflow-name` | 워크플로 스크립트에서 생성되는 명령입니다. |

이 페이지와 앱 표시가 다르면 현재 세션의 `/help`, `/skills`, 그리고 `/` 입력 뒤 표시되는 후보를 우선하세요.

## 일반 shell 대응 명령

이들은 슬래시 명령이 아닙니다. TUI 밖에서 스크립트나 관리 작업에 유용합니다.

| Shell 명령 | 용도 |
|------------|------|
| `cybercode mcp list` | MCP 서버를 나열합니다. |
| `cybercode mcp add ...` | MCP 서버를 추가합니다. |
| `cybercode mcp remove <name>` | MCP 서버를 제거합니다. |
| `cybercode plugin list` | 설치된 플러그인을 나열합니다. |
| `cybercode plugin install <plugin>` | 플러그인을 설치합니다. |
| `cybercode plugin uninstall <plugin>` | 플러그인을 제거합니다. |
| `cybercode plugin marketplace list` | 플러그인 마켓플레이스를 나열합니다. |
| `cybercode agents` | 사용자 지정 Agent를 나열합니다. |
| `cybercode doctor` | 실행 환경과 업데이트 프로그램 상태를 확인합니다. |
| `cybercode auth login` | Anthropic 계정에 로그인합니다. |
| `cybercode auth status` | 로그인 상태를 표시합니다. |
| `cybercode auth logout` | 로그아웃합니다. |
| `cybercode update` | CLI 업데이트를 확인하고 설치합니다. |
| `cybercode --help` | 설치된 버전의 전체 shell 명령 참조를 표시합니다. |

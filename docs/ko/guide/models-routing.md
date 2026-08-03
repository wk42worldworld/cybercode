# 모델 연결, 동기화, 에이전트 라우팅

CyberCode는 모델 연결을 명확한 그룹으로 나누고 데스크톱과 터미널 TUI가 같은 로컬 설정을 공유합니다. 사용자 지정 공급자를 독립된 첫 그룹으로 표시하고, 그 다음에 공식 API Key, 주요 aggregator, OAuth, 웹 세션, 이미지·비디오·오디오, 로컬 모델을 표시합니다. 사용자 지정 endpoint와 LM Studio/Ollama는 더 이상 같은 그룹에 섞이지 않습니다.

## 연결 방식 선택

| 유형 | 적합한 용도 | 설명 |
| --- | --- | --- |
| 사용자 지정 공급자 | 기존 호환 endpoint 또는 자체 gateway | Base URL, protocol, 사용자 지정 모델 ID와 선택적 API Key를 설정합니다. |
| 공식 API Key | 안정성과 명확한 과금이 중요할 때 | Key는 로컬에 저장됩니다. Kimi Code와 Kimi처럼 서로 다른 제품은 별도 항목으로 유지됩니다. |
| Aggregator | 한 계정으로 여러 모델을 사용할 때 | OpenAI 및 Anthropic 호환 endpoint를 지원합니다. |
| OAuth | 브라우저 인증을 제공하는 서비스 | 인증 결과를 로컬에 저장하고 지원되는 경우 token을 자동 갱신합니다. |
| 웹 세션 | 기존 웹사이트 로그인 상태를 사용할 때 | Cookie, JWT, 웹 token을 사용하므로 공식 API보다 안정성, rate limit, 계정 정책 위험이 큽니다. |
| 이미지·비디오·오디오 | 미디어 모델 목록과 자격 증명 관리 | 중국 공급자를 먼저 표시합니다. 연결 테스트는 유료 생성 작업을 실행하지 않으며 미디어 모델을 채팅 기본값으로 설정하지 않습니다. |
| 로컬 모델 | LM Studio, Ollama 등의 로컬 추론 | 로컬 서비스에 직접 연결합니다. CyberCode가 추론 프로그램 자체를 대신하지는 않습니다. |

데스크톱에서 **설정 → 모델 및 라우팅 → 모델 공급자**를 여세요. 공급자 이름은 CyberCode에서 선택한 언어로 표시됩니다.

## OAuth와 웹 세션

OAuth 카드에서 인증을 완료해야 연결된 카드가 강조 표시됩니다. token rotation을 지원하는 공급자는 CyberCode가 유효한 token을 로컬에서 유지합니다.

웹 세션은 카드가 요구하는 Cookie 또는 웹 token을 사용합니다. CyberCode는 Cookie 형식을 정리하고 브라우저 호환 header와 upstream token 갱신을 처리합니다. 브라우저 데이터 읽기, CAPTCHA 처리, 계정 제한이나 지역 제한 우회는 하지 않습니다.

### 가장 빠른 설정 방법

1. 공급자 카드를 열고 **웹사이트 열기**를 선택한 뒤 자신의 계정으로 로그인하여 웹에서 메시지를 보낼 수 있는지 확인하세요.
2. `F12`로 브라우저 개발자 도구를 여세요. 대화 상자에 **Application / Storage → Cookies**, **Local Storage**, **Network** 중 어디로 이동해야 하는지와 정확한 항목이 표시됩니다.
3. 값을 복사하세요. Cookie는 `name=value`를 세미콜론으로 구분하거나 **Network → Request Headers → Cookie**에서 전체 Cookie 값을 복사할 수 있습니다.
4. CyberCode로 돌아와 **클립보드에서 가져오기**, **세션 저장**, **테스트** 순서로 실행하세요. 테스트가 성공한 뒤 기본 공급자로 설정합니다.

선택한 공급자의 정확한 항목과 입력 형식은 항상 대화 상자에 표시됩니다. 주요 예:

| 공급자 | 브라우저 위치 | 복사할 값 |
| --- | --- | --- |
| Kimi Web | Application / Storage → Cookies | `kimi-auth` 또는 전체 Cookie 값 |
| Claude Web | Application / Storage → Cookies | `sessionKey` 또는 전체 Cookie 값 |
| ChatGPT Web | Application / Storage → Cookies | `__Secure-next-auth.session-token` 또는 전체 Cookie 값 |
| Gemini Web | Application / Storage → Cookies | `__Secure-1PSID`와 `__Secure-1PSIDTS` |
| DeepSeek Web | Application / Storage → Local Storage | `userToken` 값 |
| Microsoft Copilot Web | Network의 채팅 요청 | `access_token` |
| Microsoft 365 Copilot | Network의 WebSocket 요청 URL | `access_token`과 `chathubPath` |

브라우저는 HttpOnly Cookie를 보호하므로 데스크톱 앱이 넓은 브라우저 권한 없이 몰래 읽을 수 없습니다. CyberCode는 사용자가 직접 복사한 뒤 한 번 눌러 가져오는 방식을 사용하며 브라우저 프로필을 검색하거나 백그라운드 클립보드 권한을 유지하지 않습니다.

::: warning 서비스 약관을 확인하세요
웹 interface는 예고 없이 변경될 수 있고 rate limit이나 계정 제어가 적용될 수 있습니다. 사용 권한이 있는 계정만 사용하고 안정적인 운영에는 공식 API를 우선하세요.
:::

## 모델 가져오기와 동기화

호환 `/models` endpoint를 제공하는 API Key, 사용자 지정, 로컬 공급자에서는 **최신 모델 동기화**를 사용할 수 있습니다. CyberCode는 원격 목록을 병합하면서 사용자가 직접 입력한 모델 ID를 유지합니다.

**실시간 동기화**를 켜면 시작 후와 약 24시간마다 지원 공급자를 갱신합니다. OAuth, 웹 세션, 내장 미디어 목록은 각 연결 방식에서 관리되며 일반 `/models` 동기화가 덮어쓰지 않습니다.

```text
/provider status
/provider sync [공급자 ID 또는 이름]
/provider auto-sync on|off [공급자 ID 또는 이름]
```

## 에이전트 라우트 만들기

**모델 및 에이전트 라우팅 → 에이전트 라우팅**에서 여러 사용 가능한 모델 대상을 하나의 route에 추가합니다. CyberCode는 가용성, health 기록, 실패 cooldown을 기준으로 대상을 선택하고 최대 시도 횟수 안에서 다음 후보로 전환합니다.

```text
/routing
/routing status
/routing create coding-fast Daily coding
/routing strategy coding-fast auto
/routing use coding-fast
/routing reset-health
```

`/route`는 `/routing`의 alias입니다. 세부 순서와 policy는 데스크톱 편집기에서 조정할 수 있습니다.

## 다른 Agent에 제공

**노드**는 설정된 모델과 route를 별도 키로 보호된 OpenAI Chat Completions 및 Anthropic Messages endpoint로 제공합니다. 외부 Agent는 원래 공급자 Key를 받지 않습니다. 자세한 내용은 [Agent 노드 연결](./agent-node.md)을 확인하세요.

독립 TUI는 필요할 때 내장 로컬 runtime을 시작하므로 추가 proxy가 필요하지 않습니다. 데스크톱이 실행한 TUI에서는 중복 쓰기를 막기 위해 데스크톱 호스트가 server, 동기화 scheduler, node lifecycle을 관리합니다.

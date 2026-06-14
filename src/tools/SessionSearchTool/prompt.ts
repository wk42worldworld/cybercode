export const DESCRIPTION = 'Search CyberCode past conversation sessions'

export const PROMPT = `Use this tool to recall past CyberCode conversations when the user asks about earlier work, prior decisions, old errors, previous preferences, or anything that may have been discussed in another session.

Calling shapes:
- Search: pass query. Returns matching historical sessions with the matched message window and session bookends.
- Browse: pass no query or sessionId. Returns recent sessions.
- Read: pass sessionId. Returns the head and tail of that session.
- Scroll: pass sessionId and aroundMessageId. Returns more messages around that historical message.

Prefer this tool over guessing from memory. It returns real transcript snippets from the local SQLite FTS index, rebuilt from JSONL transcripts when needed. Do not use it for facts already visible in the current conversation.`

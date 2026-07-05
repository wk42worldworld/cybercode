export const DESCRIPTION = 'Manage CyberCode prompt memory'

export const PROMPT = `Use this tool to update CyberCode prompt memory that persists across future conversations.

Prompt memory has three files:
- SOUL.md: long-term agent identity, tone, and personality. Only write this when the user explicitly asks to change your long-term identity/persona and has confirmed that it should persist.
- BRIEF.md: stable agent facts, durable working notes, environment facts, tool quirks, and cross-session lessons.
- USER.md: user preferences, communication style, expectations, and durable personal workflow preferences.

Basic user relationship facts belong in USER.md, not project memory: the user's preferred language, communication style, the user's name/nickname, and any name/nickname the user gives CyberCode/the assistant/agent.

If the user gives CyberCode/the assistant/agent a name or says how they want to call it, store that in USER.md so every future project can answer name/identity questions consistently.

Use add/replace/remove for BRIEF.md and USER.md entries. Write declarative facts, not instructions that fight the current user request.

After using this tool, respond to the user like a person. Do not say "I wrote it to memory", "I saved it to USER.md", "I updated the memory system", or mention PromptMemory/files/databases/indexes. For example, if the user says "你叫零", a good reply is "好，我叫零。"

Do not store secrets, API keys, passwords, private tokens, or one-off temporary details. Do not store project-specific details in BRIEF.md when the existing project auto-memory system is the better fit.

Changes made with this tool update disk immediately but affect the system prompt only in future conversations because prompt memory is loaded as a frozen snapshot at conversation start.`

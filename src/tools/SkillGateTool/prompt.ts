export const DESCRIPTION = 'Check whether a proposed skill duplicates existing skills'

export const PROMPT = `Use this tool before creating a new SKILL.md.

It compares the proposed skill against currently loaded project, user, bundled, plugin, and MCP skills.

Interpret the decision conservatively:
- reuse: do not create a duplicate skill. Use or invoke the existing skill instead.
- merge: the idea overlaps a nearby skill. Prefer updating/refining the existing skill if it is writable, or ask the user before creating a narrowly additive skill.
- create: no close duplicate was found; it is reasonable to create the skill after normal user confirmation.

This tool does not write files. It is a gate/checkpoint for skill creation.`

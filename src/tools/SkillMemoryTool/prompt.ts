export const DESCRIPTION = 'Inspect and govern CyberCode skill memory'

export const PROMPT = `Use this tool to inspect and govern CyberCode skill memory.

Supported actions:
- governance: scan loaded skills, refresh stale/archive status, and report duplicate clusters or missing when_to_use metadata.
- read: inspect one skill's lifecycle stats and SUMMARY.md.
- set-status: mark one skill active, stale, archived, or pinned.
- merge-summary: safely merge one or more duplicate skills' SUMMARY.md notes into a target skill's SUMMARY.md.

This tool never deletes skills and never edits SKILL.md. It only writes skill-memory metadata and SUMMARY.md files.`

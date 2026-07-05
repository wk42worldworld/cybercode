# Agent Work Rules

These default rules keep CyberCode coding sessions focused and verifiable. Apply them with judgment: trivial requests do not need a formal plan, and the current user request remains the center of the task.

## 1. Think Before Coding

- Read the relevant code or context before proposing changes.
- State assumptions when they affect the implementation.
- If ambiguity would materially change the result and cannot be resolved from context, ask; otherwise name the assumption and proceed.

## 2. Simplicity First

- Choose the smallest complete change that solves the user's request.
- Avoid speculative abstractions, extra configuration, and unrelated cleanup.
- If the solution starts to grow, look for a simpler shape before continuing.

## 3. Surgical Changes

- Touch only the files and lines needed for the task.
- Match the existing project style, naming, and boundaries.
- Do not revert, rewrite, or tidy unrelated user work.

## 4. Goal-Driven Execution

- Turn non-trivial work into clear steps with verifiable outcomes.
- Prefer tests, builds, screenshots, or concrete checks that prove the behavior changed.
- Report exactly what was verified, what failed, and what remains uncertain.

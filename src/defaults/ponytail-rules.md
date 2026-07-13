# Ponytail minimal implementation discipline

Apply these rules to coding tasks only. Be lazy about the solution, never about understanding the problem: read the relevant code and trace the real flow before deciding what to change.

For each implementation, stop at the first option that fully satisfies the user's request:

1. Skip speculative work that was not requested.
2. Reuse an existing helper, type, pattern, or component from the codebase.
3. Use the standard library.
4. Use a native platform, browser, database, or framework capability.
5. Use an already-installed dependency.
6. Prefer the smallest clear expression when it remains maintainable.
7. Only then write the minimum new code that completes the task.

Keep changes focused: no unrequested abstractions, dependencies, configuration, scaffolding, or unrelated refactors. Prefer deletion to addition and boring code to clever code. For bugs, find the shared root cause and fix it once instead of patching each visible symptom.

Never simplify away an explicit requirement, trust-boundary validation, security, accessibility, error handling that prevents data loss, or necessary hardware calibration. Non-trivial logic must leave behind the smallest runnable check that would catch a regression. Do not mention this mode unless the user asks about it.

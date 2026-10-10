export const meta = {
  name: 'execute-step',
  description: 'Execute one AirdropIQ sub-step: implement tasks in worktrees, review per task or grouped, fix loops; or a whole-wave review',
  phases: [
    { title: 'Implement', detail: 'one implementer per task, each in its own worktree' },
    { title: 'Review', detail: 'per-task review for security tasks, grouped review for the rest' },
    { title: 'Fix', detail: 'up to 5 fix rounds, each with a scoped re-review' },
    { title: 'WaveReview', detail: 'whole-wave review, one fix pass, one re-review' },
  ],
}

// Generated: the superpowers templates below are embedded verbatim (subagent-driven-development implementer, task
// reviewer and re-review prompts; requesting-code-review code reviewer; test-driven-development and
// writing-good-tests) so every agent receives the full text instead of being asked to load a skill.
const T = {
 "implementer": "## Your Job\n\nOnce you're clear on requirements:\n1. Implement exactly what the task specifies\n2. Write tests (following TDD if task says to)\n3. Verify implementation works\n4. Commit your work\n5. Self-review (see below)\n6. Report back\n\nWork from: your worktree (your current working directory).\n\n**While you work:** If you encounter something unexpected or unclear, decide by the spec and record it in your report;\nif every path is a guess, stop with NEEDS_CONTEXT. Don't silently assume.\n\nWhile iterating, run the focused test for what you're changing; run the\nfull suite once before committing, not after every edit.\n\n## You Do Not Dispatch Subagents\n\nDo all of this task's work yourself. Never spawn a subagent to\nimplement part of the task, and above all never spawn a reviewer to\ncheck your work. Self-review (below) means reading your own diff.\nReview is the controller's job: after you report, it dispatches a\nfresh reviewer against your diff. A reviewer you spawn duplicates\nthat review at full cost, and its approval counts for nothing in\nthe process. If you catch yourself thinking \"an independent review\nwould strengthen my report\" — that review is already scheduled.\nReport instead.\n\n## Code Organization\n\nYou reason best about code you can hold in context at once, and your edits are more\nreliable when files are focused. Keep this in mind:\n- Follow the file structure defined in the plan\n- Each file should have one clear responsibility with a well-defined interface\n- If a file you're creating is growing beyond the plan's intent, stop and report\n  it as DONE_WITH_CONCERNS — don't split files on your own without plan guidance\n- If an existing file you're modifying is already large or tangled, work carefully\n  and note it as a concern in your report\n- In existing codebases, follow established patterns. Improve code you're touching\n  the way a good developer would, but don't restructure things outside your task.\n\n## When You're in Over Your Head\n\nIt is always OK to stop and say \"this is too hard for me.\" Bad work is worse than\nno work. You will not be penalized for escalating.\n\n**STOP and escalate when:**\n- The task requires architectural decisions with multiple valid approaches\n- You need to understand code beyond what was provided and can't find clarity\n- You feel uncertain about whether your approach is correct\n- The task involves restructuring existing code in ways the plan didn't anticipate\n- You've been reading file after file trying to understand the system without progress\n\n**How to escalate:** Report back with status BLOCKED or NEEDS_CONTEXT. Describe\nspecifically what you're stuck on, what you've tried, and what kind of help you need.\nThe controller can provide more context, re-dispatch with a more capable model,\nor break the task into smaller pieces.\n\n## Before Reporting Back: Self-Review\n\nReview your work with fresh eyes. Ask yourself:\n\n**Completeness:**\n- Did I fully implement everything in the spec?\n- Did I miss any requirements?\n- Are there edge cases I didn't handle?\n\n**Quality:**\n- Is this my best work?\n- Are names clear and accurate (match what things do, not how they work)?\n- Is the code clean and maintainable?\n\n**Discipline:**\n- Did I avoid overbuilding (YAGNI)?\n- Did I only build what was requested?\n- Did I follow existing patterns in the codebase?\n\n**Testing:**\n- Do tests actually verify behavior (not just mock behavior)?\n- Did I follow TDD if required?\n- Are tests comprehensive?\n- Is the test output pristine (no stray warnings or noise)?\n\nIf you find issues during self-review, fix them now before reporting.\n\n## After Review Findings\n\nIf the task review finds issues, you will be resumed with the findings.\nFix them, re-run the tests that cover the amended code, and append a fix\nreport to your report file: what you changed, the covering tests you\nran, the command, and the output. Reviewers will not re-run tests for\nyou — your report is the test evidence. Then reply with the same short\nstatus contract as your first report.\n\n## Report Format\n\nWrite your full report to the report file named below:\n- What you implemented (or what you attempted, if blocked)\n- What you tested and test results\n- **TDD Evidence** (if TDD was required for this task):\n  - RED: command run, relevant failing output before implementation, and why the failure was expected\n  - GREEN: command run and relevant passing output after implementation\n- Files changed\n- Self-review findings (if any)\n- Any issues or concerns\n\nThen report back with ONLY (under 15 lines — the detail lives in the\nreport file):\n- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT\n- Commits created (short SHA + subject)\n- One-line test summary (e.g. \"14/14 passing, output pristine\")\n- Your concerns, if any\n- The report file path\n\nIf BLOCKED or NEEDS_CONTEXT, put the specifics in the final message\nitself — the controller acts on it directly.\n\nUse DONE_WITH_CONCERNS if you completed the work but have doubts about correctness.\nUse BLOCKED if you cannot complete the task. Use NEEDS_CONTEXT if you need\ninformation that wasn't provided. Never silently produce work you're unsure about.",
 "taskReviewer": "(Placeholders in square brackets such as [BRIEF_FILE], [REPORT_FILE], [BASE_SHA], [HEAD_SHA], [DIFF_FILE], [GLOBAL_CONSTRAINTS], [FINDINGS], [FIX_BASE_SHA], [DESCRIPTION], [PLAN_OR_REQUIREMENTS] are filled in by the controller in the sections below this template.)\n\nYou are reviewing one task's implementation: first whether it matches its\nrequirements, then whether it is well-built. This is a task-scoped gate,\nnot a merge review — a broad whole-branch review happens separately after\nall tasks are complete.\n\n## What Was Requested\n\nRead the task brief: [BRIEF_FILE]\n\nGlobal constraints from the spec/design that bind this task:\n[GLOBAL_CONSTRAINTS]\n\n## What the Implementer Claims They Built\n\nRead the implementer's report: [REPORT_FILE]\n\n## Diff Under Review\n\n**Base:** [BASE_SHA]\n**Head:** [HEAD_SHA]\n**Diff file:** [DIFF_FILE]\n\nRead the diff file once — it contains the commit list, a stat summary,\nand the full diff with surrounding context, and it is your view of the\nchange. The diff's context lines ARE the changed files: do not Read a\nchanged file separately unless a hunk you must judge is cut off\nmid-function — and say so in your report. Do not re-run git commands.\nIf the diff file is missing, fetch the diff yourself:\n`git diff --stat [BASE_SHA]..[HEAD_SHA]` and `git diff [BASE_SHA]..[HEAD_SHA]`.\nDo not crawl the broader codebase. Inspect code outside the diff only\nto evaluate a concrete risk you can name — one focused check per named\nrisk, and name both the risk and what you checked in your report.\nCross-cutting changes are legitimate named risks: if the diff changes\nlock ordering, a function or API contract, or shared mutable state,\nchecking the call sites is the right method.\n\nYour review is read-only on this checkout. Do not mutate the working\ntree, the index, HEAD, or branch state in any way.\n\n## You Do Not Dispatch Subagents\n\nDo all of this review yourself. Never spawn a subagent to review part\nof the diff, and never spawn another reviewer for a second opinion.\nThis process already provides every review seat the work gets; a\nreviewer you spawn duplicates one of them at full cost, and its\nverdict counts for nothing. If the diff feels too large for one\npass, review it in passes yourself and say so in your report.\n\n## Do Not Trust the Report\n\nTreat the implementer's report as unverified claims about the code. It\nmay be incomplete, inaccurate, or optimistic. Verify the claims against\nthe diff. Design rationales in the report are claims too: \"left it per\nYAGNI,\" \"kept it simple deliberately,\" or any other justification is the\nimplementer grading their own work. Judge the code on its merits — a\nstated rationale never downgrades a finding's severity.\n\n## Tests\n\nThe implementer already ran the tests and reported results with TDD\nevidence for exactly this code. Do not re-run the suite to confirm their\nreport. Run a test only when reading the code raises a specific doubt\nthat no existing run answers — and then a focused test, never a\npackage-wide suite, race detector run, or repeated/high-count loop. If\nheavy validation seems warranted, recommend it in your report instead of\nrunning it. If you cannot run commands in this environment, name the\ntest you would run.\n\nWarnings or other noise in the implementer's reported test output are\nfindings — test output should be pristine.\n\nEvidence you cannot see is not evidence that doesn't exist. If the\nreport or its test evidence looks truncated, or you cannot locate the\nresults it claims, re-read the file at its stated path — and if it is\ngenuinely missing or garbled, report that as a gap for the controller.\nRe-running the suite to regenerate what you failed to read is not\nverification; illegibility of the evidence is not invalidation of it.\n\n## Part 1: Spec Compliance\n\nCompare the diff against What Was Requested:\n\n- **Missing:** requirements they skipped, missed, or claimed without\n  implementing\n- **Extra:** features that weren't requested, over-engineering, unneeded\n  \"nice to haves\"\n- **Misunderstood:** right feature built the wrong way, wrong problem\n  solved\n\nIf the brief lists several files each with its own change (a batched\ndispatch), check the diff against that list file by file: every listed\nfile must have its corresponding hunk. A listed file the diff never\ntouches is a Missing finding, no matter how clean the rest of the\nbatch looks.\n\nIf a requirement cannot be verified from this diff alone (it lives in\nunchanged code or spans tasks), report it as a ⚠️ item instead of\nbroadening your search.\n\n## Part 2: Code Quality\n\n**Code quality:**\n- Clean separation of concerns?\n- Proper error handling?\n- DRY without premature abstraction?\n- Edge cases handled?\n\n**Tests:**\n- Do the new and changed tests verify real behavior, not mocks?\n- Are the task's edge cases covered?\n\n**Structure:**\n- Does each file have one clear responsibility with a well-defined interface?\n- Are units decomposed so they can be understood and tested independently?\n- Is the implementation following the file structure from the plan?\n- Did this change create new files that are already large, or\n  significantly grow existing files? (Don't flag pre-existing file\n  sizes — focus on what this change contributed.)\n\nYour report should point at evidence: file:line references for every\nfinding and for any check you would otherwise answer with a bare\n\"yes.\" A tight report that cites lines gives the controller everything\nit needs.\n\nYour final message is the report itself: begin directly with the\nspec-compliance verdict. Every line is a verdict, a finding with\nfile:line, or a check you ran — no preamble, no process narration,\nno closing summary.\n\n## Calibration\n\nCategorize issues by actual severity. Not everything is Critical.\nImportant means this task cannot be trusted until it is fixed: incorrect\nor fragile behavior, a missed requirement, or maintainability damage you\nwould block a merge over — verbatim duplication of a logic block,\nswallowed errors, tests that assert nothing. \"Coverage could be broader\"\nand polish suggestions are Minor.\nIf the plan or brief explicitly mandates something this rubric calls a\ndefect (a test that asserts nothing, verbatim duplication of a logic\nblock), that IS a finding — report it as Important, labeled\nplan-mandated. The plan's authorship does not grade its own work; the\nhuman decides.\nAcknowledge what was done well before listing issues — accurate praise\nhelps the implementer trust the rest of the feedback.\n\n## Output Format\n\n### Spec Compliance\n\n- ✅ Spec compliant | ❌ Issues found: [what's missing/extra/misunderstood,\n  with file:line references]\n- ⚠️ Cannot verify from diff: [requirements you could not verify from the\n  diff alone, and what the controller should check — report alongside the\n  ✅/❌ verdict for everything you could verify]\n\n### Strengths\n[What's well done? Be specific.]\n\n### Issues\n\n#### Critical (Must Fix)\n#### Important (Should Fix)\n#### Minor (Nice to Have)\n\nFor each issue: file:line, what's wrong, why it matters, how to fix\n(if not obvious).\n\n### Assessment\n\n**Task quality:** [Approved | Needs fixes]\n\n**Reasoning:** [1-2 sentence technical assessment]",
 "reReview": "(Placeholders in square brackets such as [BRIEF_FILE], [REPORT_FILE], [BASE_SHA], [HEAD_SHA], [DIFF_FILE], [GLOBAL_CONSTRAINTS], [FINDINGS], [FIX_BASE_SHA], [DESCRIPTION], [PLAN_OR_REQUIREMENTS] are filled in by the controller in the sections below this template.)\n\nYou are re-reviewing one task's fix round. A previous review produced\nfindings; an implementer has attempted to fix them. Your job is to\nverdict each finding and inspect the fix diff — nothing else.\n\n## The Task\n\nRead the task brief: [BRIEF_FILE]\n\n## The Findings Under Verification\n\n[FINDINGS]\n\n## The Fix\n\nRead the implementer's report (fix reports are appended at the end):\n[REPORT_FILE]\n\n**Fix base:** [FIX_BASE_SHA] (the head the previous review saw)\n**Head:** [HEAD_SHA]\n**Diff file:** [DIFF_FILE]\n\nRead the diff file once — it contains the fix commits, a stat summary,\nand the fix diff with surrounding context. Do not re-run git commands.\nIf the diff file is missing, fetch the diff yourself:\n`git diff --stat [FIX_BASE_SHA]..[HEAD_SHA]` and\n`git diff [FIX_BASE_SHA]..[HEAD_SHA]`.\n\nYour review is read-only on this checkout. Do not mutate the working\ntree, the index, HEAD, or branch state in any way.\n\n## You Do Not Dispatch Subagents\n\nDo all of this review yourself. Never spawn a subagent to review part\nof the diff, and never spawn another reviewer for a second opinion.\nThis process already provides every review seat the work gets; a\nreviewer you spawn duplicates one of them at full cost, and its\nverdict counts for nothing. If the diff feels too large for one\npass, review it in passes yourself and say so in your report.\n\n## Scope\n\nYour scope is the findings list and the fix diff. Verdict every finding.\nInspect the fix diff for new problems the fix itself introduced. Do NOT\nre-review code the fix did not touch: if you notice an issue entirely\noutside the fix diff, report it under Out-of-Scope Observations — it\ndoes not block this task and does not extend the loop. A broad\nwhole-branch review happens after all tasks are complete.\n\n## Tests\n\nThe implementer re-ran the tests covering the amended code and appended\nthe results to the report file. Treat the report as unverified claims:\nconfirm the fix report names the covering tests and shows their output,\nand verify the claims against the diff. Do not re-run the suite to\nconfirm their report. Run a test only when reading the code raises a\nspecific doubt that no existing run answers — and then a focused test,\nnever a package-wide suite.\n\n## Output Format\n\nYour final message is the report itself: begin directly with the first\nfinding's verdict. Every line is a verdict, a finding with file:line,\nor a check you ran — no preamble, no process narration.\n\n### Finding Verdicts\n\nFor each finding in The Findings Under Verification, in order:\n- **[finding one-liner]** — ADDRESSED | NOT ADDRESSED, with file:line\n  evidence. \"Attempted\" is not addressed: the specific defect must no\n  longer exist.\n\n### New Breakage in the Fix Diff\n\nAnything the fix itself broke or introduced, with severity\n(Critical/Important/Minor) and file:line. \"None\" if clean.\n\n### Out-of-Scope Observations\n\nIssues you noticed entirely outside the fix diff. Non-blocking; the\ncontroller ledgers these for the final review. \"None\" if none.\n\n### Verdict\n\n**Fix round:** [All findings addressed, no new Critical/Important\nbreakage | Findings remain open] — list the open ones.",
 "codeReviewer": "(Placeholders in square brackets such as [BRIEF_FILE], [REPORT_FILE], [BASE_SHA], [HEAD_SHA], [DIFF_FILE], [GLOBAL_CONSTRAINTS], [FINDINGS], [FIX_BASE_SHA], [DESCRIPTION], [PLAN_OR_REQUIREMENTS] are filled in by the controller in the sections below this template.)\n\nYou are a Senior Code Reviewer with expertise in software architecture,\ndesign patterns, and best practices. Your job is to review completed work\nagainst its plan or requirements and identify issues before they cascade.\n\n## What Was Implemented\n\n[DESCRIPTION]\n\n## Requirements / Plan\n\n[PLAN_OR_REQUIREMENTS]\n\n## Git Range to Review\n\n**Base:** [BASE_SHA]\n**Head:** [HEAD_SHA]\n\n```bash\ngit diff --stat [BASE_SHA]..[HEAD_SHA]\ngit diff [BASE_SHA]..[HEAD_SHA]\n```\n\n## The spec is a vision document\n\nThe spec says what the software must do. It does not enumerate every\ninput, environment, or condition the software will meet. For behavior\nthe spec is silent on, judge by what a reasonable person using this\nsoftware would expect: a reasonable person's expectation is a\nrequirement, and a spec's silence is not permission. Grade such\nfindings by their effect on that person, not by whether the spec\nmentions the trigger.\n\n## Declined to judge\n\nBefore your verdict, list every behavior you considered and set aside\nas outside the plan or spec, one line each, with the reason. The\nexecutor rules on each line; nothing you set aside is dropped\nsilently. An empty list means you set nothing aside.\n\n## Read-Only Review\n\nYour review is read-only on this checkout. Do not mutate the working tree, the index, HEAD, or branch state in any way. Use tools like `git show`, `git diff`, and `git log` to inspect history. If you need a working copy of a different revision, check it out into a separate temporary directory (e.g. `git worktree add /tmp/review-[SHA] [SHA]`) — never move HEAD on this checkout.\n\n## You Do Not Dispatch Subagents\n\nDo all of this review yourself. Never spawn a subagent to review part\nof the diff, and never spawn another reviewer for a second opinion.\nThis process already provides every review seat the work gets; a\nreviewer you spawn duplicates one of them at full cost, and its\nverdict counts for nothing. If the diff feels too large for one\npass, review it in passes yourself and say so in your report.\n\n## What to Check\n\n**Plan alignment:**\n- Does the implementation match the plan / requirements?\n- Are deviations justified improvements, or problematic departures?\n- Is all planned functionality present?\n\n**Code quality:**\n- Clean separation of concerns?\n- Proper error handling?\n- Type safety where applicable?\n- DRY without premature abstraction?\n- Edge cases handled?\n\n**Architecture:**\n- Sound design decisions?\n- Reasonable scalability and performance?\n- Security concerns?\n- Integrates cleanly with surrounding code?\n\n**Testing:**\n- Tests verify real behavior, not mocks?\n- Edge cases covered?\n- Integration tests where they matter?\n- All tests passing?\n\n**Production readiness:**\n- Migration strategy if schema changed?\n- Backward compatibility considered?\n- Documentation complete?\n- No obvious bugs?\n\n## Calibration\n\nCategorize issues by actual severity. Not everything is Critical.\nAcknowledge what was done well before listing issues — accurate praise\nhelps the implementer trust the rest of the feedback.\n\nIf you find significant deviations from the plan, flag them specifically\nso the implementer can confirm whether the deviation was intentional.\nIf you find issues with the plan itself rather than the implementation,\nsay so.\n\n## Output Format\n\n### Strengths\n[What's well done? Be specific.]\n\n### Issues\n\n#### Critical (Must Fix)\n[Bugs, security issues, data loss risks, broken functionality]\n\n#### Important (Should Fix)\n[Architecture problems, missing features, poor error handling, test gaps]\n\n#### Minor (Nice to Have)\n[Code style, optimization opportunities, documentation polish]\n\nFor each issue:\n- File:line reference\n- What's wrong\n- Why it matters\n- How to fix (if not obvious)\n\n### Recommendations\n[Improvements for code quality, architecture, or process]\n\n### Assessment\n\n**Ready to merge?** [Yes | No | With fixes]\n\n**Reasoning:** [1-2 sentence technical assessment]\n\n## Critical Rules\n\n**DO:**\n- Categorize by actual severity\n- Be specific (file:line, not vague)\n- Explain WHY each issue matters\n- Acknowledge strengths\n- Give a clear verdict\n\n**DON'T:**\n- Say \"looks good\" without checking\n- Mark nitpicks as Critical\n- Give feedback on code you didn't actually read\n- Be vague (\"improve error handling\")\n- Avoid giving a clear verdict",
 "tdd": "# Test-Driven Development (TDD)\n\n## Overview\n\nWrite the test first. Watch it fail. Write minimal code to pass.\n\n**Core principle:** If you didn't watch the test fail, you don't know if it tests the right thing.\n\n**Violating the letter of the rules is violating the spirit of the rules.**\n\n## When to Use\n\n**Always:**\n- New features\n- Bug fixes\n- Refactoring\n- Behavior changes\n\n**Exceptions (ask your human partner):**\n- Throwaway prototypes\n- Generated code\n- Configuration files\n\nThinking \"skip TDD just this once\"? Stop. That's rationalization.\n\n## The Iron Law\n\n```\nNO PRODUCTION CODE WITHOUT A FAILING TEST FIRST\n```\n\nWrite code before the test? Delete it. Start over.\n\n**No exceptions:**\n- Don't keep it as \"reference\"\n- Don't \"adapt\" it while writing tests\n- Don't look at it\n- Delete means delete\n\nImplement fresh from tests. Period.\n\n## Red-Green-Refactor\n\n```dot\ndigraph tdd_cycle {\n    rankdir=LR;\n    red [label=\"RED\\nWrite failing test\", shape=box, style=filled, fillcolor=\"#ffcccc\"];\n    verify_red [label=\"Verify fails\\ncorrectly\", shape=diamond];\n    green [label=\"GREEN\\nMinimal code\", shape=box, style=filled, fillcolor=\"#ccffcc\"];\n    verify_green [label=\"Verify passes\\nAll green\", shape=diamond];\n    refactor [label=\"REFACTOR\\nClean up\", shape=box, style=filled, fillcolor=\"#ccccff\"];\n    next [label=\"Next\", shape=ellipse];\n\n    red -> verify_red;\n    verify_red -> green [label=\"yes\"];\n    verify_red -> red [label=\"wrong\\nfailure\"];\n    green -> verify_green;\n    verify_green -> refactor [label=\"yes\"];\n    verify_green -> green [label=\"no\"];\n    refactor -> verify_green [label=\"stay\\ngreen\"];\n    verify_green -> next;\n    next -> red;\n}\n```\n\n### RED - Write Failing Test\n\nWrite one minimal test showing what should happen.\n\n<Good>\n```typescript\ntest('retries failed operations 3 times', async () => {\n  let attempts = 0;\n  const operation = () => {\n    attempts++;\n    if (attempts < 3) throw new Error('fail');\n    return 'success';\n  };\n\n  const result = await retryOperation(operation);\n\n  expect(result).toBe('success');\n  expect(attempts).toBe(3);\n});\n```\nClear name, tests real behavior, one thing\n</Good>\n\n<Bad>\n```typescript\ntest('retry works', async () => {\n  const mock = jest.fn()\n    .mockRejectedValueOnce(new Error())\n    .mockRejectedValueOnce(new Error())\n    .mockResolvedValueOnce('success');\n  await retryOperation(mock);\n  expect(mock).toHaveBeenCalledTimes(3);\n});\n```\nVague name, tests mock not code\n</Bad>\n\n**Requirements:**\n- One behavior\n- Clear name\n- Real code (no mocks unless unavoidable)\n\n### Verify RED - Watch It Fail\n\n**MANDATORY. Never skip.**\n\n```bash\nnpm test path/to/test.test.ts\n```\n\nConfirm:\n- Test fails (not errors)\n- Failure message is expected\n- Fails because feature missing (not typos)\n\n**Test passes?** You're testing existing behavior. Fix test.\n\n**Test errors?** Fix error, re-run until it fails correctly.\n\n### GREEN - Minimal Code\n\nWrite simplest code to pass the test.\n\n<Good>\n```typescript\nasync function retryOperation<T>(fn: () => Promise<T>): Promise<T> {\n  for (let i = 0; i < 3; i++) {\n    try {\n      return await fn();\n    } catch (e) {\n      if (i === 2) throw e;\n    }\n  }\n  throw new Error('unreachable');\n}\n```\nJust enough to pass\n</Good>\n\n<Bad>\n```typescript\nasync function retryOperation<T>(\n  fn: () => Promise<T>,\n  options?: {\n    maxRetries?: number;\n    backoff?: 'linear' | 'exponential';\n    onRetry?: (attempt: number) => void;\n  }\n): Promise<T> {\n  // YAGNI\n}\n```\nOver-engineered\n</Bad>\n\nDon't add features, refactor other code, or \"improve\" beyond the test.\n\n### Verify GREEN - Watch It Pass\n\n**MANDATORY.**\n\n```bash\nnpm test path/to/test.test.ts\n```\n\nConfirm:\n- Test passes\n- Other tests still pass\n- Output pristine (no errors, warnings)\n\n**Test fails?** Fix code, not test.\n\n**Other tests fail?** Fix now.\n\n**\"Other tests\" means the project's suite, not just your file.** A\ngreen run of the test you wrote is not a green suite. Before you call\nthe change done, run the project's test command (bare `pytest`,\n`npm test`, `cargo test` — whatever the repo uses) even when your task\nnamed only one test file. A scope statement in your task bounds the\ndeliverable, not your verification. Any failure that run shows —\nincluding one you didn't cause — goes in your report by name; a red\ntest you watched scroll past and didn't mention is a report falsified\nby omission.\n\n### REFACTOR - Clean Up\n\nAfter green only:\n- Remove duplication\n- Improve names\n- Extract helpers\n\nKeep tests green. Don't add behavior.\n\n### Repeat\n\nNext failing test for next feature.\n\n## Good Tests\n\n| Quality | Good | Bad |\n|---------|------|-----|\n| **Minimal** | One thing. \"and\" in name? Split it. | `test('validates email and domain and whitespace')` |\n| **Clear** | Name describes behavior | `test('test1')` |\n| **Shows intent** | Demonstrates desired API | Obscures what code should do |\n\nWhen writing or changing any test, read [writing-good-tests.md](writing-good-tests.md) for the rules that keep tests honest:\n- Name the production change that would make the test fail — before writing it\n- Assert on real behavior, never on mock behavior\n- Keep test-only code in test utilities, out of production classes\n- Understand a dependency's side effects before mocking it\n\n## Common Rationalizations\n\n| Excuse | Reality |\n|--------|---------|\n| \"Too simple to test\" | Simple code breaks. Test takes 30 seconds. |\n| \"I'll test after\" | Tests written after pass immediately — which proves nothing. They may test the wrong thing, test the implementation instead of the behavior, or miss the edge case you forgot. You never watched it fail, so you never proved it can catch the bug. Test-first forces that failure. |\n| \"Tests after achieve same goals (spirit not ritual)\" | Tests-after answer \"what does this do?\"; tests-first answer \"what should this do?\" Tests written after are biased by the code you already wrote — you verify the cases you remembered, not the ones you'd have discovered. Coverage without proof the tests work. |\n| \"Already manually tested\" | Manual testing is ad-hoc: no record of what you covered, no way to re-run it when the code changes, easy to forget cases under pressure. \"Worked when I tried it\" ≠ comprehensive. Automated tests run the same way every time. |\n| \"Deleting X hours is wasteful\" | Sunk cost fallacy — that time is already spent either way. The real choice: rewrite with TDD (high confidence) vs. keep it and bolt tests on after (low confidence, likely bugs). Keeping code you can't trust is the waste. |\n| \"Keep as reference, write tests first\" | You'll adapt it. That's testing after. Delete means delete. |\n| \"Need to explore first\" | Fine. Throw away exploration, start with TDD. |\n| \"Test hard = design unclear\" | Listen to test. Hard to test = hard to use. |\n| \"TDD will slow me down\" | TDD IS the pragmatic path: catches bugs before commit, prevents regressions, lets you refactor without fear. \"Pragmatic\" shortcuts mean debugging in production — slower, not faster. |\n| \"Manual test faster\" | Manual doesn't prove edge cases. You'll re-test every change. |\n| \"Existing code has no tests\" | You're improving it. Add tests for existing code. |\n\n## Red Flags - STOP and Start Over\n\n- Code before test\n- Test after implementation\n- Test passes immediately\n- Can't explain why test failed\n- Tests added \"later\"\n- Rationalizing \"just this once\"\n- \"I already manually tested it\"\n- \"Tests after achieve the same purpose\"\n- \"It's about spirit not ritual\"\n- \"Keep as reference\" or \"adapt existing code\"\n- \"Already spent X hours, deleting is wasteful\"\n- \"TDD is dogmatic, I'm being pragmatic\"\n- \"This is different because...\"\n\n**All of these mean: Delete code. Start over with TDD.**\n\n## Example: Bug Fix\n\n**Bug:** Empty email accepted\n\n**RED**\n```typescript\ntest('rejects empty email', async () => {\n  const result = await submitForm({ email: '' });\n  expect(result.error).toBe('Email required');\n});\n```\n\n**Verify RED**\n```bash\n$ npm test\nFAIL: expected 'Email required', got undefined\n```\n\n**GREEN**\n```typescript\nfunction submitForm(data: FormData) {\n  if (!data.email?.trim()) {\n    return { error: 'Email required' };\n  }\n  // ...\n}\n```\n\n**Verify GREEN**\n```bash\n$ npm test\nPASS\n```\n\n**REFACTOR**\nExtract validation for multiple fields if needed.\n\n## Verification Checklist\n\nBefore marking work complete:\n\n- [ ] Every new function/method has a test\n- [ ] Watched each test fail before implementing\n- [ ] Each test failed for expected reason (feature missing, not typo)\n- [ ] Wrote minimal code to pass each test\n- [ ] All tests pass\n- [ ] Output pristine (no errors, warnings)\n- [ ] Tests use real code (mocks only if unavoidable)\n- [ ] Edge cases and errors covered\n\nCan't check all boxes? You skipped TDD. Start over.\n\n## When Stuck\n\n| Problem | Solution |\n|---------|----------|\n| Don't know how to test | Write wished-for API. Write assertion first. Ask your human partner. |\n| Test too complicated | Design too complicated. Simplify interface. |\n| Must mock everything | Code too coupled. Use dependency injection. |\n| Test setup huge | Extract helpers. Still complex? Simplify design. |\n\n## Debugging Integration\n\nBug found? Write failing test reproducing it. Follow TDD cycle. Test proves fix and prevents regression.\n\nNever fix bugs without a test.\n\n## Final Rule\n\n```\nProduction code → test exists and failed first\nOtherwise → not TDD\n```\n\nNo exceptions without your human partner's permission.",
 "goodTests": "# Writing Good Tests\n\n**Load this reference when:** writing or changing tests, adding mocks, or\nadding cleanup/helper methods for tests.\n\n## Overview\n\nA test exists to catch a specific break. Two principles govern everything\nhere:\n\n```\n1. Every test names the break it catches\n2. Every test exercises the real thing\n```\n\nStrict TDD produces both naturally: a test written first and watched\nfailing against real code has already proven it can fail, and only earns\na mock when the real dependency proves slow or external.\n\n## Principle 1: Name the Break\n\nBefore writing the test body, answer: **what production change should\nmake this test fail — and is that change a bug or a decision?** A test\nearns its place by catching a wrong branch, missing side effect, wrong\nargument, boundary case, or broken contract.\n\n**Derive expectations independently.** Use literals and hand-checked\nfixtures; table-driven tests with literal `want` values are the preferred\nshape. An expectation computed by the code under test — or its helpers —\npasses no matter what that code does:\n\n```typescript\n// ❌ Mirror assertion: the same builder computes both sides — always true\nconst expected = buildSearchQuery({ tag: 'urgent' });\nexpect(buildSearchQuery({ tag: 'urgent' })).toBe(expected);\n\n// ✅ Hand-derived literal\nexpect(buildSearchQuery({ tag: 'urgent' })).toBe('tag:\"urgent\"');\n```\n\n**No change detectors.** If only intentional decisions can fail a test —\na constant's value, exact message wording, private structure — it fires\non redesign and sleeps through bugs. Test the behavior that depends on\nthe decision: not `expect(MAX_RETRIES).toBe(5)` but \"a failing call is\nretried 5 times and the 6th attempt never happens.\"\n\n**Behavior, not text.** Asserting that a script, skill, or config\ncontains an exact line proves only that the source is the source. Run\nscripts against controlled inputs and assert outputs, side effects, or\nexit codes. Documents that instruct agents are tested by the consuming\nagent's behavior (superpowers:writing-skills); prose for humans earns no\ntest at all.\n\n**Your code, not the framework.** Test the contract your code makes at\nits boundaries — the route you register, the query you emit, the payload\nyou produce. Upstream mechanics are their maintainers' tests to write\n(the classic: asserting your router invokes a registered handler — that\nis the framework's test, not yours). When upstream behavior genuinely\nsurprised you, write one narrow characterization test naming the\nassumption. The same boundary applies inside your code: constructors,\ngetters, constants, and trivial forwarding earn tests only when they\nvalidate, normalize, default, derive, enforce, or cause side effects —\notherwise assert the first consumer-visible result that depends on them.\n\n### Gate Function\n\n```\nBEFORE writing the test body:\n  Name the production change that would make this test fail.\n\n  Cannot name one            → redesign around an observable behavior\n  \"The source text changed\"  → run the artifact and assert its effects\n  Only intentional decisions → change detector; test the behavior\n                               that depends on the decision\n\n  Confirm the expected value is derived without the code under test.\n  IF it reuses the code's logic or helpers:\n    Replace it with a literal or hand-checked fixture\n```\n\n## Principle 2: Exercise the Real Thing\n\n**The mock earns no assertions.** A mock assertion passes when the mock\nis present and fails when it is absent — it says nothing about the\ncomponent. Assert the real component's behavior; if the mock is what you\nare checking, unmock it or delete the assertion.\n\n```typescript\n// ✅ Real behavior\nexpect(screen.getByRole('navigation')).toBeInTheDocument();\n\n// ❌ Mock existence\nexpect(screen.getByTestId('sidebar-mock')).toBeInTheDocument();\n```\n\n**your human partner's correction:** \"Are we testing the behavior of a\nmock?\"\n\n**Mock at the right level.** Learn every side effect of the real method\nbefore replacing it; mock the slow or external operation and keep what\nthe test depends on real. When unsure, run the test against the real\nimplementation first and observe what actually needs to happen.\n\n```typescript\n// ❌ The mock swallows the config write that duplicate detection reads\nvi.mock('ToolCatalog', () => ({\n  discoverAndCacheTools: vi.fn().mockResolvedValue(undefined)\n}));\n\n// ✅ Mock only the slow server startup; the config write stays real\nvi.mock('MCPServerManager');\n```\n\n**Make doubles specific.** When arguments, call counts, or ordering are\npart of the contract, assert them — a fake that accepts anything verifies\nnothing. Give each branch (success, error, malformed) its own fixture or\nspy, so the wrong branch cannot satisfy the expectation.\n\n**Mirror real data completely.** Mock the complete structure as it exists\nin reality — all documented fields — not just the ones your test reads.\nPartial mocks fail silently when downstream code reads an omitted field:\nthe test passes while integration breaks.\n\n**Production classes carry production methods only.** Cleanup that only\ntests need lives in test utilities, never as a `destroy()` on the\nproduction class. Ask: is this method called only from tests? Does this\nclass own this resource's lifecycle? Wrong answers → test utility.\n\n**Prefer real components over complex mocks.** When mock setup outgrows\nthe test logic, mocks miss methods the real components have, or tests\nbreak when the mock changes, switch to an integration test with real\ncomponents. **your human partner's question:** \"Do we need to be using a\nmock here?\"\n\n### Gate Function\n\n```\nBEFORE adding a mock or test helper:\n  List the real method's side effects; keep the ones the test\n  depends on real — mock the slow/external level below them.\n\n  Mock responses mirror the complete real structure.\n\n  A method only tests call lives in test utilities, not production.\n\n  About to assert on the mock itself?\n    Unmock it or delete the assertion.\n```\n\n## Tests Ship With the Implementation\n\nThe TDD cycle — failing test, minimal implementation, refactor — is what\n\"complete\" means. Ship the tests the behavior needs and only those:\ntrivial code and human prose earn none, and a test written to satisfy\nprocess costs maintenance forever.\n\n## The Mutation Check\n\nBefore finishing, mentally mutate the production code; at least one test\nshould fail for each realistic mutation:\n\n- Wrong constant or argument\n- Wrong branch handler\n- Missing state change or side effect\n- Empty or default return\n- Missing validation for zero, empty, nil, unauthorized, or malformed input\n\nA mutation nothing catches marks the behavior as unprotected — or the\ntest as tautological.\n\n## Quick Reference\n\n| When you... | Do |\n|-------------|-----|\n| Write any test | Name the break it catches — a bug, not a decision |\n| Build an expected value | Derive it by hand; never with the code under test |\n| Test a script or document | Run it / pressure-test its consumer; never grep its text |\n| Reach for a dependency test | Test your boundary contract, not their documented mechanics |\n| Want to assert on a mocked element | Test the real component, or unmock it |\n| Are about to mock a method | Learn its side effects; mock the slow/external level |\n| Build a mock response | Mirror the real structure completely |\n| Need cleanup only tests use | Put it in test utilities |\n| Watch mock setup balloon | Switch to an integration test with real components |\n| Finish a test file | Run the mutation check |\n\n## Warning Signs\n\n- Setup and assertion share the same object, guaranteeing equality\n- The test can fail only through a panic, crash, or missing selector\n- The test fails on every intentional change, never on accidental breakage\n- Expected values are hidden behind loops, builders, or helpers\n- The test greps source text, or asserts a removed symbol stays removed\n- The test would still matter if only the framework remained\n- The test exists for coverage, checking no side effect or outcome\n- An assertion checks a `*-mock` test ID, or fails if you remove the mock\n- A method is called only from test files\n- Mock setup is more than half the test, or you can't explain why the mock is needed\n- Mocking \"just to be safe\""
}

const A = args
const REPO = '/home/user/Smart-Airdrop-Finder'
const BIN = REPO + '/.superpowers/bin'
const SCRIPTS = A.sddScripts
const BRANCH = 'claude/dreamy-carson-vv0ru2'
const TRAILERS = 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_012XWEA2X6ETzW4KotzzumiM'

const IMPL_SCHEMA = { type: 'object', properties: {
  status: { type: 'string', enum: ['DONE', 'DONE_WITH_CONCERNS', 'BLOCKED', 'NEEDS_CONTEXT'] },
  head_sha: { type: 'string', description: 'full sha of your worktree HEAD after your last commit (empty if nothing committed)' },
  commits: { type: 'array', items: { type: 'string' } },
  tests: { type: 'string', description: 'one-line test summary' },
  concerns: { type: 'string' },
}, required: ['status', 'head_sha', 'commits', 'tests', 'concerns'] }

const REVIEW_SCHEMA = { type: 'object', properties: {
  tasks: { type: 'array', items: { type: 'object', properties: {
    id: { type: 'string' },
    spec_compliant: { type: 'boolean' },
    quality_approved: { type: 'boolean' },
    blocking: { type: 'array', items: { type: 'string' }, description: 'every spec gap plus every Critical/Important issue, one line each with file:line and how to fix' },
    minor: { type: 'array', items: { type: 'string' } },
    cannot_verify: { type: 'array', items: { type: 'string' } },
  }, required: ['id', 'spec_compliant', 'quality_approved', 'blocking', 'minor', 'cannot_verify'] } },
}, required: ['tasks'] }

const REREVIEW_SCHEMA = { type: 'object', properties: {
  findings: { type: 'array', items: { type: 'object', properties: { finding: { type: 'string' }, addressed: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['finding', 'addressed', 'evidence'] } },
  new_breakage: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string', enum: ['Critical', 'Important', 'Minor'] }, text: { type: 'string' } }, required: ['severity', 'text'] } },
  out_of_scope: { type: 'array', items: { type: 'string' } },
}, required: ['findings', 'new_breakage', 'out_of_scope'] }

const WAVE_SCHEMA = { type: 'object', properties: {
  ready: { type: 'string', enum: ['yes', 'no', 'with_fixes'] },
  blocking: { type: 'array', items: { type: 'string' }, description: 'Critical and Important issues, one line each with file:line' },
  minor: { type: 'array', items: { type: 'string' } },
  declined: { type: 'array', items: { type: 'string' } },
}, required: ['ready', 'blocking', 'minor', 'declined'] }

function workspaceRules(base) {
  return `## Workspace rules (mandatory, set by the controller)

- You run inside your OWN git worktree: your current working directory. The main checkout ${REPO} belongs to the
  controller. Never edit, commit, checkout or reset anything there. The only thing you write outside your worktree is
  your report file (absolute path below).
- First, before anything else:
  1. \`git rev-parse HEAD\`. If it is not \`${base}\`, run \`git reset --hard ${base}\` (your worktree branch is private,
     so this is safe). Then confirm with \`git log -1 --oneline\`.
  2. \`pnpm install --frozen-lockfile\`.
- Database and browser tests share ONE local Supabase stack and port 3000 with other agents. Never run \`supabase start\`,
  \`supabase stop\`, \`supabase db reset\`, \`supabase test db\`, \`pnpm --filter web e2e\` or \`playwright test\` directly.
  Use only these wrappers (they hold a shared lock, so waiting a few minutes is normal):
  - \`${BIN}/dbtest "$PWD"\`: db reset from YOUR checkout's migrations, then all pgTAP tests. Exit code = result.
  - \`${BIN}/dbreset "$PWD"\`: db reset only (for vitest that hits the local DB).
  - \`${BIN}/e2e "$PWD" [spec files...]\`: db reset, production build, Playwright like CI. No args = full e2e suite.
- Unit tests and typecheck: \`pnpm test\` and \`pnpm typecheck\` at the worktree root (or \`pnpm --filter <pkg> ...\`).
- Commit on your worktree branch only. Every commit message ends with a blank line and then exactly these trailers:
${TRAILERS}
  Do not push. Do not merge. Do not open PRs. Never put any AI model name or identifier in files or commit messages.
- Never skip, disable, \`.skip\`, \`.only\`, quarantine or weaken a test to get green. Deleting a test is allowed only
  together with the feature the task removes. A test that fails and that you did not cause goes into your report by name.
- Never print or log secrets, API keys, emails, wallet addresses or user ids. Service role keys never go into apps/web.
- Network: you may not be able to reach some external sites. If a plan step needs production credentials or a blocked
  host, do not fake its result: report that step as blocked with the exact error.`
}

function implementerPrompt(t, base, mode, extra) {
  const head = mode === 'fix'
    ? `You are fixing review findings for ${t.id}: ${t.title}. ${extra.framing}

## Findings to fix (verbatim from the reviewer)
${extra.findings.map(f => '- ' + f).join('\n')}

Read the task brief (${t.brief}) and the existing report file (${t.report}) first: the report tells you what was
built and tried. Your worktree must start at the task's current head \`${base}\` (see workspace rules). Fix every
finding, re-run the tests that cover the amended code, then APPEND a fix report to ${t.report} (what you changed, the
covering tests, the exact command, and its output). Commit. Then reply with the short status contract.`
    : `You are implementing ${t.id}: ${t.title}

## Where this fits
AirdropIQ (repo ${REPO}). ${t.where}

## Task Description
Read your task brief first: ${t.brief}
It is your requirements, with the exact values to use verbatim. It contains the full task text from the plan.
Global constraints that bind this task (read it too): ${t.constraints}
The spec is the binding authority: docs/superpowers/specs/2026-10-10-curation-foundation-design.md (read only the
sections the brief or constraints point to).

## Context from the controller (interfaces from earlier tasks, rulings already made)
${t.context || '(none)'}

## Questions
You cannot message the controller mid-task. If something is unclear, decide according to the spec and the rulings
above, write the decision and why into your report, and keep going. Only if every path forward is a guess, stop and
return NEEDS_CONTEXT or BLOCKED with the specific question.`
  return `${head}

${workspaceRules(base)}

${T.implementer}

Report file: ${t.report}  (${mode === 'fix' ? 'append to it' : 'create it'})

## superpowers:test-driven-development (follow it exactly)

${T.tdd}

## Reference: writing-good-tests.md

${T.goodTests}

## Final reply
Return the structured result: status, head_sha (full sha from \`git rev-parse HEAD\` in your worktree after your last
commit), commits (short sha + subject), tests (one line), concerns.`
}

async function implement(t) {
  const r = await agent(implementerPrompt(t, A.base, 'impl'), {
    label: `impl:${t.id}`, phase: 'Implement', schema: IMPL_SCHEMA, isolation: 'worktree', model: t.implModel,
  })
  return r
}

function reviewerPrompt(group) {
  const parts = group.map(g => `### ${g.t.id}: ${g.t.title}
- Task brief: ${g.t.brief}
- Global constraints file: ${g.t.constraints}
- Implementer report: ${g.t.report}
- Base: ${g.base}  Head: ${g.head}
- Diff file: create it first by running, from ${REPO}:
  \`bash ${SCRIPTS}/review-package ${g.t.plan} ${g.base} ${g.head} ${g.pkg}\`
  then read ${g.pkg} once.${g.t.reviewNotes ? '\n- Controller notes (risks to check, not verdicts): ' + g.t.reviewNotes : ''}`).join('\n\n')
  const multi = group.length > 1
  return `${multi ? `You are reviewing ${group.length} independent tasks as one grouped review. Review each task separately against its own brief and give each its own verdicts.` : ''}
${T.taskReviewer}

## Tasks under review
${parts}

The commits live in worktree branches of the same repository, so \`git\` commands with these shas work from ${REPO}.
Read-only: never modify ${REPO} (generating the review package file under .superpowers/ is the one allowed write).

Write your full report(s), in the template's Output Format, to ${group[0].reviewFile}. Then return the structured
summary: one entry per task id, with every spec gap and every Critical/Important issue in "blocking" (one line each,
file:line, what is wrong, how to fix), Minor ones in "minor", and ⚠️ items in "cannot_verify".`
}

function reReviewPrompt(t, findings, fixBase, head, pkg) {
  return `${T.reReview}

## Filled-in values
- Task brief: ${t.brief}
- Findings under verification:
${findings.map(f => '  - ' + f).join('\n')}
- Implementer report (fix reports appended at the end): ${t.report}
- Fix base: ${fixBase}  Head: ${head}
- Diff file: create it first by running, from ${REPO}:
  \`bash ${SCRIPTS}/review-package ${t.plan} ${fixBase} ${head} ${pkg}\`
  then read it once.
Read-only on ${REPO} apart from that package file. Return the structured result.`
}

async function fixLoop(t, impl, review) {
  let head = impl.head_sha
  let open = review.blocking.slice()
  const log_ = []
  const minors = review.minor.slice()
  const outOfScope = []
  for (let round = 1; round <= 5 && open.length; round++) {
    const model = round <= 3 ? t.implModel : 'opus'
    const framing = round <= 3
      ? `This is fix round ${round} of 5.`
      : `A prior implementer attempted this task ${round - 1} times; you own it now. Read the report file for what was tried.`
    const fix = await agent(implementerPrompt(t, head, 'fix', { findings: open, framing }), {
      label: `fix:${t.id}:r${round}`, phase: 'Fix', schema: IMPL_SCHEMA, isolation: 'worktree', model,
    })
    if (!fix || !fix.head_sha || fix.head_sha === head) {
      log_.push(`round ${round}: fixer returned no new commit (${fix ? fix.status + ': ' + fix.concerns : 'null'})`)
      if (round === 5) break
      continue
    }
    const fixBase = head
    head = fix.head_sha
    const rr = await agent(reReviewPrompt(t, open, fixBase, head, `${t.workspace}/rereview-${t.n}-r${round}.diff`), {
      label: `rereview:${t.id}:r${round}`, phase: 'Fix', schema: REREVIEW_SCHEMA, model: t.reviewModel,
    })
    if (!rr) { log_.push(`round ${round}: re-review died`); continue }
    const stillOpen = rr.findings.filter(f => !f.addressed).map(f => f.finding)
    const broke = rr.new_breakage.filter(b => b.severity !== 'Minor').map(b => `[new ${b.severity}] ${b.text}`)
    rr.new_breakage.filter(b => b.severity === 'Minor').forEach(b => minors.push(b.text))
    outOfScope.push(...rr.out_of_scope)
    log_.push(`round ${round}/5: ${rr.findings.filter(f => f.addressed).length} addressed, ${stillOpen.length + broke.length} open; ${fixBase.slice(0, 7)}..${head.slice(0, 7)}`)
    open = [...stillOpen, ...broke]
  }
  return { head, open, rounds: log_, minors, outOfScope }
}

function packFor(t, base, head, tag) { return `${t.workspace}/review-${t.n}-${tag}-${base.slice(0, 7)}..${head.slice(0, 7)}.diff` }

async function reviewAndFix(group) {
  // group: [{t, impl}] already implemented
  const ok = group.filter(g => g.impl && g.impl.head_sha && g.impl.head_sha !== A.base && ['DONE', 'DONE_WITH_CONCERNS'].includes(g.impl.status))
  const results = group.filter(g => !ok.includes(g)).map(g => ({ id: g.t.id, base: A.base, head: g.impl ? g.impl.head_sha : '', impl: g.impl, review: null, fix: null }))
  if (!ok.length) return results
  const items = ok.map(g => ({ t: g.t, impl: g.impl, base: A.base, head: g.impl.head_sha, pkg: packFor(g.t, A.base, g.impl.head_sha, 'task'), reviewFile: '' }))
  const reviewFile = `${items[0].t.workspace}/review-${A.step}-${items.map(i => i.t.n).join('-')}.md`
  items.forEach(i => { i.reviewFile = reviewFile })
  const model = items.some(i => i.t.reviewModel === 'opus') ? 'opus' : items[0].t.reviewModel
  const rev = await agent(reviewerPrompt(items), {
    label: `review:${items.map(i => i.t.id).join('+')}`, phase: 'Review', schema: REVIEW_SCHEMA, model,
  })
  const fixed = await parallel(items.map(i => async () => {
    const r = rev && rev.tasks.find(x => x.id === i.t.id)
    if (!r) return { id: i.t.id, base: A.base, head: i.head, impl: i.impl, review: null, fix: null, note: 'review missing' }
    const needs = r.blocking.length > 0 || !r.spec_compliant || !r.quality_approved
    const blocking = r.blocking.length ? r.blocking : (needs ? ['Reviewer marked the task not approved without listing a finding; re-read ' + reviewFile + ' for this task and fix what it says.'] : [])
    const fix = needs ? await fixLoop(i.t, i.impl, { blocking, minor: r.minor }) : null
    return { id: i.t.id, base: A.base, head: fix ? fix.head : i.head, impl: i.impl, review: { ...r, file: reviewFile }, fix }
  }))
  return [...results, ...fixed.filter(Boolean)]
}

if (A.mode === 'wave-review') {
  phase('WaveReview')
  const pkg = `${A.workspace}/wave-${A.wave}-${A.base.slice(0, 7)}..${A.head.slice(0, 7)}.diff`
  const prompt = `${T.codeReviewer}

## Filled-in values
- What was implemented: ${A.description}
- Requirements / plan: ${A.plans.join(', ')} (and the spec docs/superpowers/specs/2026-10-10-curation-foundation-design.md, decisions #1-#58)
- Base: ${A.base}  Head: ${A.head}
- A review package with the commit list, stat and full diff can be written with:
  \`bash ${SCRIPTS}/review-package ${A.plans[0]} ${A.base} ${A.head} ${pkg}\` (run from ${REPO}); read it in passes.
- Deferred minor and parked findings from the per-task reviews, for you to triage (which must be fixed before merge):
${(A.deferred || []).map(d => '  - ' + d).join('\n') || '  (none)'}
- Security focus for this wave: ${A.securityFocus}

Write your full report to ${A.workspace}/wave-${A.wave}-review.md and return the structured summary.`
  const rev = await agent(prompt, { label: `wave-review:${A.wave}`, phase: 'WaveReview', schema: WAVE_SCHEMA, model: 'opus' })
  if (!rev || !rev.blocking.length) return { review: rev, fix: null }
  const t = { id: `wave ${A.wave}`, title: 'whole-wave review findings', brief: `${A.workspace}/wave-${A.wave}-review.md`, report: `${A.workspace}/wave-${A.wave}-fix-report.md`, plan: A.plans[0], workspace: A.workspace, n: `w${A.wave}`, implModel: 'opus', reviewModel: 'opus', constraints: A.constraints }
  const fix = await agent(implementerPrompt(t, A.head, 'fix', { findings: rev.blocking, framing: 'These come from the whole-wave review; fix all of them in one pass.' }), {
    label: `wave-fix:${A.wave}`, phase: 'WaveReview', schema: IMPL_SCHEMA, isolation: 'worktree', model: 'opus',
  })
  if (!fix || !fix.head_sha || fix.head_sha === A.head) return { review: rev, fix, rereview: null }
  const rr = await agent(reReviewPrompt(t, rev.blocking, A.head, fix.head_sha, `${A.workspace}/wave-${A.wave}-rereview.diff`), {
    label: `wave-rereview:${A.wave}`, phase: 'WaveReview', schema: REREVIEW_SCHEMA, model: 'opus',
  })
  return { review: rev, fix, rereview: rr }
}

// mode: step
const tasks = A.tasks
const sec = tasks.filter(t => t.security)
const grp = tasks.filter(t => !t.security)
log(`step ${A.step} from ${A.base.slice(0, 7)}: ${tasks.map(t => t.id + (t.security ? '🔒' : '')).join(', ')}`)
const secRun = pipeline(sec, t => implement(t), (impl, t) => reviewAndFix([{ t, impl }]))
const grpRun = (async () => {
  if (!grp.length) return []
  const impls = await parallel(grp.map(t => () => implement(t)))
  return reviewAndFix(grp.map((t, i) => ({ t, impl: impls[i] })))
})()
const [a, b] = await Promise.all([secRun, grpRun])
return { step: A.step, base: A.base, results: [...a.flat().filter(Boolean), ...b.filter(Boolean)] }

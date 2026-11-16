---
name: prove
description: Ship a UI change with proof that it works - deploy a build that names its sha, record it in use the way a person uses it (pointer, timing, reading what the page says), find the moment it misbehaves, report options to the owner instead of fixing on your own, then rebuild what the owner decided and prove that build live with a recording and a replay. Use whenever a change must ship with evidence, not with a diff alone.
---

# prove

A diff says what changed. A recording of the live build in use says it works.

## 1. Build that names itself
- Commit first, then build: stamp the commit sha into the page (`<meta name="build">` and the footer).
  Never deploy uncommitted work under an old sha.
- Deploy to the public address, then read the sha back from the live page.

## 2. Record it like a person
- Drive a real browser with video (Playwright `recordVideo`), at a real viewport and locale.
- Move the pointer to a target, rest, then click: a person aims before data arrives and clicks after.
  Locator clicks re-aim at the element and hide races; mouse clicks at coordinates do not.
- Stay on the page through live updates (refresh, new rows) and act during them.
- Log the moment (mm:ss from the recording's start), what you meant, what happened, and any receipt.

## 3. Report options, not a fix
- What you checked, when (mm:ss), where (file:line), the misbehaviour named as `expected` vs `got`.
- Options for the owner, with a recommendation. Do not change the plan yourself.

## 4. Rebuild what was decided, prove it again
- Change the plan document with the decision, and every pinned hook it touches.
- Keep rows and nodes stable across refreshes: add in place, never rebuild a list under the pointer.
- Re-record the same moment on the new build; run the owner's replay or test against the live address;
  report a System Diff (behaviour, UX, data, decision, hooks) and the new sha.

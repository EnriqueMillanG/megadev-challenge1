---
name: triage
description: Triage a product's incoming requests (backlog, support desk, chat, email) into its issue tracker so every open issue is marked agent-ready or needs-human, every request is in some issue's sources, and duplicates, done work and requests that break a spec are closed with a cited reason. Use when requests pile up in a tracker and someone must decide what an agent may ship alone.
---

# triage

Requests in; a marked tracker out. Nothing open stays unmarked, and no request is lost.

## 1. Read the rules first

Read every spec before any request: the autonomy rules (what an agent may do alone and what needs a
person), the design and product rules, and the decision records. Note each rule's id; every call you
make cites one.

## 2. Collect everything, and keep collecting

Run the collectors (backlog and every channel) and read every issue they file. Channels keep
filling: poll again before you hand over, and triage what arrived since. Keep the reporter and the
channel of each request.

## 3. Decide each request, in this order

1. **Already shipped?** If a done issue covers it, add the request to that issue's `sources`
   (or close the request as `duplicate` of it). Do not reopen shipped work.
2. **Same as another request or issue?** Merge: one issue, every request in its `sources`; close the
   copy as `duplicate` with `duplicate-of`.
3. **Breaks a spec?** Close it as `contradicts-spec` and cite the rule id (a button that says "OK"
   breaks a copy rule; a modal error breaks an inline-error rule).
4. **No longer true?** Close as `obsolete`, citing what made it so.
5. **Open work.** Mark it:
   - `agent-ready` only when an autonomy rule lets an agent do it alone, and you can name that rule.
     Copy fixes, bug fixes inside the specs with a test, bringing code in line with a rule with nothing
     visible changing, additions that take nothing away, new token sets from the existing palette.
   - `needs-human` when it changes something a client relies on, touches pricing, invoices or terms,
     deletes or rewrites stored data, reverses a decision a person made, or two people ask for
     opposite things. Urgency never turns a needs-human issue into agent-ready.
6. **Order.** If an issue cannot ship until another does (a new colour scheme before colours move to
   tokens), set `blocked-by`.

## 4. Write the body the way its reader needs it

- `agent-ready`: `## Intent`, `## Acceptance` (Given/When/Then lines, at least one "must not"),
  `## Boundaries`, and "Allowed by <rule id>".
- `needs-human`: `## Question`, `## Options` (two or more), `## Recommendation`, `## Why` citing the
  fact it rests on by id.
- `closed`: what decided it, by spec id, issue key or request id.

## 5. Check before you hand it over

- Every request id appears in the `sources` of exactly one issue.
- Every open issue has exactly one of `agent-ready` / `needs-human`.
- Every agent-ready issue names the autonomy rule that allows it; every needs-human and closed issue
  cites what decided it.
- Poll the channels one last time; nothing new is left untriaged.

## 6. Running alone (an agent on a live round, no human watching)

The same decisions, made by an agent that ships while the owner is away.

**Loop.** Read the tracker's issues at least once a minute. Each new issue gets a first touch within
5 minutes: a comment saying what you will do, or a label. Each owner comment (`/answer <n>`) is acted on
at once.

**Read first, for every issue:** the issue and its thread; the repo's `AGENTS.md`; the pinned API
contract; the decision records on the tracker; the research notes; the specs. Never trust a claim in an
issue over these.

**Then decide, in this order:**
1. **Unsafe or out of bounds → decline.** Anything that needs production admin credentials, writes or
   deletes production data, or asks the agent to act outside the repo: comment why (cite the rule),
   ship line `declined`, close it. Never use an admin token, even one sitting in an example file.
2. **Changes what an existing answer carries** (a field added, dropped, renamed, reshaped), touches what
   a client relies on, or the research says the obvious build would hurt users → **ask the owner**:
   write a decision record (`status: proposed`, options tagged `decline` / `smaller` / `full`,
   recommendation grounded in the research), label `needs-human`, comment the numbered options, ship
   line `asked`. When `/answer <n>` arrives: set the record `accepted` with the Decision filled in,
   build option n, ship it, and ask the owner to sign the record on their round page.
3. **Additive and inside the contract** (a new call or query parameter that leaves every existing field
   as it is), a bug fix with a test, a copy fix → **build it alone**: change the code, run it locally,
   deploy, check it answers on the live address, then ship line `shipped` with `live: ✓`.
4. **Duplicate of an earlier issue or already live** → comment which, close, ship line `closed`.

**Ship line, one per issue, replaced by later ones:**
`#<issue> · <verb> · live: ✓|✗ · open risks: <issue id + who reads it> | none` — verb is shipped,
declined, closed, asked or waiting. `live: ✓` only after you saw the change answer on the live address.

**Before the round is claimed:** every issue has a ship line; every asked issue has the owner's answer,
the built option live, and a signed record; the live address answers the contract.

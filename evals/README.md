# Golden set

31 real tasks with known-good answers, run against a throwaway service. The
point is a single number: **能不能干活**, measured instead of estimated.

```bash
corepack pnpm build            # the runner needs build/index.js
node evals/run.mjs             # full set
node evals/run.mjs --list      # what would run
node evals/run.mjs --group B   # one group
node evals/run.mjs --skip-tag slow,network
```

Results land in `evals/results/<timestamp>.json` next to the scratch service's
log. Compare two runs to see whether a model swap, a prompt change or a fix made
things better or worse — that comparison is the entire reason this exists.

## Why not just more unit tests

The existing `*.test.ts` suites check that a function returns the right value
for a given input. They cannot tell you whether the Agent got the job done,
because the path is non-deterministic: a task may be solved with different
tools, in a different order, across a different number of turns. So an eval
judges the **outcome and the evidence**, never the route.

## How a task is judged

Three tiers, and tasks prefer the highest one available:

| Tier | Assertions | Asks |
|---|---|---|
| state | `file_exists` `file_contains` `file_absent` `file_not_contains` `sqlite` | Did the world actually change? |
| trace | `tool_used` `tool_used_any` `tool_not_used` | Did it do the work, or only describe it? |
| text | `reply_contains` `reply_contains_any` `reply_not_contains` `reply_matches` `reply_not_matches` `judge` | Answer quality, last resort |

A `judge` assertion with no judge model configured reports **unproven**, never
pass. `unproven` is counted separately from both pass and fail, because a
scoreboard that rounds uncertainty in either direction is worse than no
scoreboard.

File patterns may start with `**/`, which matches at any depth and can pin a
parent directory (`**/events/*.json`). Tasks need this: the runtime, not the
harness, decides which workspace directory a session writes into.

## Task format

```yaml
- id: A1                    # letter = group, unique across the set
  title: 建一个文件并写入内容
  why: |                    # required — why this task earns its runtime
    最小的「做了事」证明——回复里说建好了不算数，文件必须真的存在。
  baseline: pass            # pass | fail | unknown — the prediction
  tags: [slow, network]     # optional, for --skip-tag
  timeout_ms: 180000
  prompt: 在工作目录里新建 eval-notes.md，内容写 hello
  assert:
    - file_exists: "**/eval-notes.md"
    - file_contains: { file: "**/eval-notes.md", text: "hello" }
```

Multi-turn tasks use `turns:` instead of `prompt:`; a turn may set
`new_session: true` (which is how the memory tasks force the memory layer to
actually participate) and `files: [name]` to upload a fixture.

`baseline` is the prediction. When a run disagrees with it the report says so
explicitly — a `pass → fail` is a regression, and a `fail → pass` means a gap
just closed and the YAML needs updating.

Validation is strict and runs before any model is called: an unknown assertion
key, a task with no assertions, or a malformed regex fails the load. Otherwise a
typo would make a task assert nothing and report a pass, which is the one bug a
scoreboard must never have.

## Isolation

Each run gets a fresh `DATA_DIR` under the system temp directory and starts the
service through `scripts/start-server.mjs` — never `node build/index.js`, which
skips the lease, the signal handlers and the forced exit (prd.md §3.41: five
such orphans polled a production WeChat bot for twelve days).

Provider configuration is copied from `~/.molibot` so the run reaches a real
model, which necessarily copies channel credentials too. `MOLIBOT_DISABLE_EXTERNAL_CHANNELS=1`
is therefore set unconditionally and asserted before the process starts:
Telegram, Feishu, QQ and Weixin get zero instances, Web and CLI keep running.
Verify it in the run's `.service.log`:

```
channel_plugins_applied web(3):[…] telegram(0):[(none)] feishu(0):[(none)] …
```

Use `--seed-from <dir>` for a different source, and `--keep-data-dir` to leave
the scratch directory behind for inspection.

## Fixtures

`fixtures/build-fixtures.mjs` generates the plain and FlateDecode-compressed PDFs, PNG and CSV the ingestion tasks
upload, and the runner rebuilds them on every run. They are generated rather
than committed so that "what is the Agent supposed to see here" is answerable by
reading twenty lines of code instead of opening a binary.

## The harness has its own tests

```bash
node --test evals/harness.test.mjs
```

Schema validation, file-pattern resolution, scoring, the baseline-surprise
report, and the fixture generators. These run in CI-time; the golden set itself
costs model calls and runs on demand.

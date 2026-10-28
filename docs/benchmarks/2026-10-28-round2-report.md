# Automatic workflow: second authorized native comparison

Candidate **0.3.13-automatic.1** was compared with the same frozen installed
0.3.12 baseline. All twelve newly authorized turns completed, with no retries,
timeouts or infrastructure failures. **Global rollout remains blocked:** routine
call and median-time targets pass, but the measured administrative payload target
does not. The real-workflow rollout pilot has not been run and the installed
version remains 0.3.12/reviewed.

## Frozen protocol and integrity

Three scenarios (queue, CSV and search), two versions, and two fresh conversations
per scenario: partial implementation with a revised contract, then recovery.
Each turn was capped at 240 seconds. The model and effort stayed
`gpt-6.1-sol` / `medium`; fixtures and counterbalanced order match round one.
The human separately authorized these twelve starts and conditional global
deployment after all criteria and the pilot pass.

- Baseline product fingerprint: `616c22127dea8c560740816703b5e0abd8f42d5dede587ff43fb0ec666d4ec0f`.
- Candidate fingerprint: `cb983da6f2792556adc392d10682dc0cd974e5008402d8a030b3f9ca298a98ea`.
- The already reviewed eight hook definitions and their trust state were unchanged.
  The .0 source was preserved at the isolated profile's `frozen/automatic.0`;
  trial repositories and all results for this round live under `rounds/02`.
- Real MCP handshake, discovery, version/context checks and arm-specific CLI
  resolution passed before any model request. No host approval settings changed.
- 336 native hook events were recorded with **zero hook execution failures**.
  Raw source/protocol fingerprints are checked before each scored turn.

[Per-turn results and ledger audit](2026-10-28-round2-summary.json),
[raw records](2026-10-28-round2-raw.tar.gz), and
[archive manifest](2026-10-28-round2-raw-manifest.json) retain every result.
The archive contains synthetic trial data only, with no authentication or host
configuration files. The failed first round remains separately preserved.

## Comparison

| Metric | Reviewed 0.3.12 | Automatic .1 | Change / gate |
|---|---:|---:|---|
| Completed turns | 6/6 | 6/6 | All twelve complete |
| Routine mutation calls | 42 | 8 | **81.0% fewer; >=70% passes** |
| All DIP calls, including reads/help | 53 | 22 | 58.5% fewer |
| Explicit intent calls (create/adopt) | 6 | 6 | Same |
| Read / help calls | 5 / 0 | 7 / 1 | Reported separately |
| Failed management attempts | 9 | 1 | Included in counts |
| Measured management payload | 106,359 bytes | 70,314 bytes | **33.9% less; >=60% fails** |
| Hook context alone | 10,289 bytes | 14,035 bytes | 36.4% more in small fixtures |
| Median wall time | 86.395 s | 68.687 s | **20.5% lower; >=20% passes** |
| Wall-time range | 60.978–131.706 s | 55.275–106.542 s | Small sample |

| Scenario | Reviewed seed / recovery | Automatic seed / recovery |
|---|---:|---:|
| Queue | 110.347 / 131.706 s | 89.589 / 106.542 s |
| CSV | 75.685 / 85.199 s | 65.293 / 72.081 s |
| Search | 60.978 / 87.590 s | 61.635 / 55.275 s |

The routine count includes failed mutations; only explicit create/adopt and
read/help operations are separated. There was exactly one `task_finish` attempt
per automatic turn. The queue recovery's finish failed on a stale linked document,
then explicit document relinking and verification completed it, accounting for
the two additional routine calls. The other five finish calls succeeded directly.
One automatic turn read portable-helper help; it counts as help rather than a
mutation. None of the scored turns was discarded.

## Correctness and the remaining payload cost

**74/74 functional checks and 36/36 recovery-memory checks passed.** All six
recovery conversations finished their original development requirement and kept
their future feature in backlog. No seed marked its partial implementation
verified. In particular, automatic .1 used explicit adoption in all three
continuations, resolving the original-task tracking regression seen in .0.

The one automatic finish failure was safe: the model edited `PLAN.md` through a
general Node shell command, outside supported document-write extraction. DIP
required explicit review/relinking before current verification. The model did
that and the original task became verified. This is retained friction, not a
passing initial finish or proof of automatic capture of arbitrary shell writes.

The payload metric is the same conservative proxy used in the first report:
native hook additional context, serialized DIP MCP replies, DIP CLI output, and
whole command output when it reads management instructions. Mixed commands may
also print code and plan files; those bytes are retained in this proxy rather
than retrospectively removed to improve the score. Initial host framing and
tool schemas are not counted, so a 60% reduction in **total** injected information
is not established either. Startup-context reductions measured on large real
histories are a separate result and cannot replace this failed run-level target.

Automatic replies and hooks together total 34,234 bytes, compared with 68,224
for reviewed (49.8% less). Instruction-read command output adds 36,080 versus
38,135 bytes. Thus reducing mutation calls alone has not removed repeated
requirement/guide reads and their surrounding output. The stronger .1 hook
guidance also adds context in these small empty-history fixtures. Any future
optimization must preserve explicit intent review and document freshness, not
silently omit needed requirements or reclassify mixed output to pass a threshold.

Wall time includes bounded ledger/scoring work after each turn. Ordinary local
inspection continued during the comparison; there was no dedicated CPU-isolated
runner. With three paired scenarios and six durations per arm, the narrow
20.5% result is exploratory and does not establish a general speedup.

## Release decision

The measured .1 product source is unchanged from the candidate whose complete
suite passed **168 tests, with 2 platform skips**, plus syntax and clean-package
installation checks. This turn changed the runner's round-output isolation and
analysis/ledger auditing, not the measured product. The no-model preflight and
all twelve actual runs exercised that isolation successfully.

**Do not deploy globally under the current acceptance contract.** Required next
work is to reduce administrative context/read overhead, validate the reduction
without losing requirements, and then complete the real native workflow pilot.
Both authorized twelve-turn budgets are exhausted (24 starts total). A further
scored model comparison needs separate authorization. Prior package and settings
backups remain available; no rollback was necessary because global deployment
was not attempted.

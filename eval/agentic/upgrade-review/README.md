# Dependency-upgrade scoring

Use `score.py` to independently assess an agent's dependency upgrade of a Python
application managed with `uv` and tested with `pytest`. It compares the original
application and lockfile against the completed candidate. It is a separate
grading step, not an agent launcher or a GitHits product command.

The scorer ships here; application fixtures, probes, attribution rules, and run
artifacts are supplied separately. No other evaluation repository is required.
Keep private inputs and results outside this checkout. Nothing in this directory
is included in the published CLI or MCP package.

## Requirements

- Python 3.11 or later for the scorer, plus `uv` on `PATH`.
- The application's Python version and dependencies, as declared by its
  `pyproject.toml` and `uv.lock`. `uv` installs these in disposable environments.
- Two local application trees: original source with its original lockfile, and
  the agent's completed working copy, including uncommitted edits.
- Original Python tests under `tests/`, using pytest collection conventions
  or the baseline's pytest configuration.
- An independent Python probe using the output contract below.
- Network access to install dependencies and query PyPI. Cached dependencies
  can satisfy installation; failed PyPI queries are reported as unknown.

The scorer itself uses only the Python standard library. Probe dependencies
must be available in both applications' locked environments.
On Windows, use your installed `python` command where examples use `python3`.

## Run an evaluation

Prepare original and candidate trees outside the GitHits checkout. For a Git
fixture, replace the URL and commit below with your own fixed inputs:

```sh
scorer="$PWD/eval/agentic/upgrade-review/score.py"
fixture_url='<fixture repository URL>'
baseline_commit='<full original commit SHA>'
eval_root=$(mktemp -d)
git clone "$fixture_url" "$eval_root/baseline"
git -C "$eval_root/baseline" checkout --detach "$baseline_commit"
git clone --no-hardlinks "$eval_root/baseline" "$eval_root/candidate"
git -C "$eval_root/candidate" checkout --detach "$baseline_commit"
git -C "$eval_root/candidate" remote remove origin
```

Start a fresh agent session in `candidate`, with the GitHits configuration being
evaluated. A realistic prompt is:

> Update all dependencies to latest versions. Ensure that everything works
> afterwards. Use GitHits.

For comparisons of guidance placement, hold the prompt, fixture commit, model,
reasoning effort, agent version, and reporting contract constant. Run repeated
samples to expose variance. Verify from the trace that the skill was actually
read or `quick_start` actually returned its instructions; registration alone
does not prove delivery or compliance.

Do not give the agent the baseline, scorer, probe, attribution rules, previous
scores, or expected answers. Its working directory should contain only the
candidate and intended agent guidance. Do not push results or open fixture PRs
that later agents could discover.

After completion, run the scorer from a separate grading session. Supply your
independent probe, kept outside the acting workspace:

```sh
python3 "$scorer" \
  --baseline "$eval_root/baseline" \
  --repo "$eval_root/candidate" \
  --probe /path/to/private-eval/probe.py \
  --out "$eval_root/score"
```

Add `--rules /path/to/private-eval/rules.json` for known-break attribution.
Without rules, all differences are reported as unattributed. No application
repository URL, reference response, or scenario answer is hardcoded here.

The scorer copies both trees into temporary directories. It excludes Git
metadata, virtualenvs (including named environments with `pyvenv.cfg`), Python
caches, and existing `.db`/`.sqlite` files. It restores the original tests only
in the disposable candidate, then installs each tree's respective locked
dependencies and runs the original `tests/` directory and the probe. Pytest
uses the baseline's root configuration (`pytest.toml`, `pytest.ini`, `pyproject.toml`,
`tox.ini`, or `setup.cfg`, including hidden pytest files) and the candidate
root directory. Helper scripts are not forced into collection. Candidate
configuration and host `PYTEST_ADDOPTS` cannot narrow that test invocation.
The baseline's `addopts` are retained. The host active virtualenv is ignored.
Inputs are not modified.
The output directory must be new and outside both input trees; existing scores
are never overwritten. Exit zero means scoring completed, not that the upgrade
passed. Check `score.json` for the outcome.

Archive the exact prompt, original commit, agent/model/effort configuration,
guidance revision, raw session trace, completed candidate, and score output.
Preserve raw artifacts unchanged. Keep these records in your own output area,
such as `.agent-eval/`, rather than committing application data or local paths.

## Probe contract

The scorer executes the same probe in each project's isolated environment:

```text
uv run --locked --no-sync python /absolute/path/to/probe.py /output/path.json
```

The working directory and `PYTHONPATH` point to that application copy. The probe
receives its output filename as its first argument and must write a nonempty JSON array:

```json
[
  {"req": "GET /items", "status": 200, "body": {"items": []}},
  {"req": "POST /items {\"name\":\"Example\"}", "status": 201, "body": {"id": 1}}
]
```

Use the same stable request labels and order in both executions. Include enough
input detail in labels to distinguish test cases. Normalize nondeterministic
values consistently, preserving any format or type relevant to compatibility.
Use disposable state and clean it up within the probe. A changed request sequence
is a scoring error rather than a successful partial comparison.

Cover affected paths and inputs absent from existing tests. Read back state and
check side effects where relevant. Fresh databases alone do not test migration
or reopening data written by the old version. To assess that, the probe must
explicitly create and transfer original-version state; the scorer does not
implement an application-specific migration test.

## Optional attribution rules

Rules classify differing fields; they do not change the parity comparison. A
rule contains an id, description, whether the original tests catch the break,
and one or more regex matches:

```json
[
  {
    "id": "R1",
    "description": "Item creation changed its default response value",
    "tests_catch": false,
    "matches": [
      {"request": "^POST /items ", "field": "^\\.enabled$"}
    ]
  }
]
```

`request` matches the probe's `req` label; `field` matches the difference path.
Object fields use `.field`, array elements use `[0]`, array lengths use `: len`,
and status uses `status`. Optional `status_changed: true` or `false` restricts
the match to requests whose status did or did not change. The first matching
rule owns the evidence, so put more specific matches first.

`fixed: true` means no differences matched that rule in the completed probe.
It does not prove the behavior was covered or fixed. A failed candidate probe
leaves parity and every rule unassessed (`null`), rather than treating missing
evidence as a pass. Keep scenario-specific rules out of the agent's context.

## Read the results

- `reference.json` and `candidate.json`: original and upgraded probe observations.
- `score.json`: differing request count, field evidence, optional rule results,
  original-test changes and test outcome, lock validity, dependency installation,
  and exact direct pins not matching PyPI's current default release.
- `report.md`: readable summary and unattributed differences.
- Failure `.log` files: subprocess diagnostics for unsuccessful dependency
  installation or probes, including baseline failures that stop scoring. Error
  messages reference these local files instead of echoing their contents. Logs
  may contain private application or package output; review them before sharing.

The pin check covers exact `==` dependencies in `project.dependencies` and
string entries of the `dev` dependency group. It does not certify unpinned
requirements, all dependency groups, transitive freshness, or independently
rank PyPI releases by stability. Score promptly after the agent finishes; PyPI
releases can change between runs.

Review parity first, then known-break coverage, accuracy of the agent's claims,
test/lockfile scope, and finally time or token usage. One differing request can
contain multiple differing fields; several requests can reflect one issue.
Compare changes against intended behavior, since an original bug may legitimately
need correction. Passing existing tests or a bounded probe does not establish
complete compatibility. Read the raw trace to distinguish actual before/after
verification from upgraded-only checks and unsupported final claims.

## Test the scorer

```sh
bun test eval/agentic/upgrade-review/score.test.ts
```

This invokes standard-library Python tests using synthetic inputs, without
network access, fixture source, or credentials.

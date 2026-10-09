#!/usr/bin/env python3
"""Compare a Python dependency-upgrade candidate against a local baseline."""

import argparse
import configparser
import json
import os
import re
import shutil
import subprocess
import tempfile
import tomllib
import urllib.request
from pathlib import Path
from typing import Any


def run(command: list[str], repo: Path) -> subprocess.CompletedProcess[str]:
    """Run checks in a disposable copy, with its own dependency environment."""
    environment = {
        **os.environ,
        "PYTHONPATH": str(repo),
        "UV_PROJECT_ENVIRONMENT": str(repo / ".venv"),
        "PYTEST_ADDOPTS": "",
    }
    environment.pop("VIRTUAL_ENV", None)
    return subprocess.run(
        command,
        cwd=repo,
        capture_output=True,
        text=True,
        env=environment,
    )


def copy_project(source: Path, target: Path) -> None:
    """Exclude generated environments, including custom uv environment names."""

    def ignore(directory: str, names: list[str]) -> list[str]:
        return [
            name
            for name in names
            if name
            in {
                ".git",
                ".venv",
                "__pycache__",
                ".pytest_cache",
            }
            or name.endswith((".db", ".sqlite"))
            or (Path(directory) / name / "pyvenv.cfg").is_file()
        ]

    shutil.copytree(source, target, ignore=ignore)


def field_diffs(original: Any, candidate: Any, path: str = "") -> list[dict[str, Any]]:
    """Retain value types and distinguish missing fields from explicit null."""
    if type(original) is not type(candidate):
        return [
            {
                "field": path,
                "original": original,
                "candidate": candidate,
                "change": "changed",
            }
        ]
    if isinstance(original, dict):
        result = []
        for key in sorted(original.keys() | candidate.keys()):
            location = f"{path}.{key}"
            if key not in original or key not in candidate:
                result.append(
                    {
                        "field": location,
                        "original": original.get(key),
                        "candidate": candidate.get(key),
                        "change": "added" if key not in original else "removed",
                    }
                )
            else:
                result.extend(field_diffs(original[key], candidate[key], location))
        return result
    if isinstance(original, list):
        result = []
        if len(original) != len(candidate):
            result.append(
                {
                    "field": f"{path}: len",
                    "original": len(original),
                    "candidate": len(candidate),
                    "change": "changed",
                }
            )
        for index, (old, new) in enumerate(zip(original, candidate)):
            result.extend(field_diffs(old, new, f"{path}[{index}]"))
        return result
    return (
        []
        if original == candidate
        else [
            {
                "field": path,
                "original": original,
                "candidate": candidate,
                "change": "changed",
            }
        ]
    )


def load_rules(path: Path | None) -> list[dict[str, Any]]:
    """Load optional scenario-specific attribution, without shipping fixture answers."""
    rules = json.loads(path.read_text()) if path else []
    if not isinstance(rules, list):
        raise ValueError("Rules must be a JSON array")
    ids = set()
    for rule in rules:
        if (
            not isinstance(rule, dict)
            or not isinstance(rule.get("id"), str)
            or not rule["id"].strip()
        ):
            raise ValueError("Each rule needs a nonempty string id")
        if rule["id"] in ids:
            raise ValueError("Rule ids must be unique")
        ids.add(rule["id"])
        if not isinstance(rule.get("description"), str):
            raise ValueError("Each rule needs a description")
        if type(rule.get("tests_catch")) is not bool:
            raise ValueError("Each rule needs a boolean tests_catch")
        if not isinstance(rule.get("matches"), list) or not rule["matches"]:
            raise ValueError("Each rule needs a nonempty matches array")
        for match in rule["matches"]:
            if not isinstance(match, dict):
                raise ValueError("Each match must be an object")
            for key in ("request", "field"):
                if not isinstance(match.get(key), str):
                    raise ValueError(f"Each match needs a {key} regex")
                re.compile(match[key])
            if "status_changed" in match and type(match["status_changed"]) is not bool:
                raise ValueError("status_changed must be a boolean")
    return rules


def compare(
    reference: list[dict[str, Any]],
    candidate: list[dict[str, Any]],
    rules: list[dict[str, Any]],
) -> dict[str, Any]:
    """Compare status and body independently; classify only matching evidence."""
    if not reference or not candidate:
        raise ValueError("Probe must observe at least one request in both applications")
    if [row["req"] for row in reference] != [row["req"] for row in candidate]:
        raise ValueError("Probe call sequence differs from the baseline")
    evidence: dict[str, list[dict[str, Any]]] = {rule["id"]: [] for rule in rules}
    unexplained = []
    differing = 0
    for old, new in zip(reference, candidate):
        status_changed = old["status"] != new["status"]
        diffs = field_diffs(old["body"], new["body"])
        if status_changed:
            diffs.insert(
                0,
                {
                    "field": "status",
                    "original": old["status"],
                    "candidate": new["status"],
                    "change": "changed",
                },
            )
        differing += bool(diffs)
        for diff in diffs:
            item = {"req": new["req"], **diff}
            matched = next(
                (
                    rule["id"]
                    for rule in rules
                    if any(
                        re.search(match["request"], new["req"])
                        and re.search(match["field"], diff["field"])
                        and (
                            "status_changed" not in match
                            or match["status_changed"] == status_changed
                        )
                        for match in rule["matches"]
                    )
                ),
                None,
            )
            (evidence[matched] if matched else unexplained).append(item)
    return {
        "calls_total": len(reference),
        "calls_differing": differing,
        "breakages": {
            rule["id"]: {
                "desc": rule["description"],
                "tests_catch": rule["tests_catch"],
                "fixed": not evidence[rule["id"]],
                "evidence": evidence[rule["id"]],
            }
            for rule in rules
        },
        "unexplained_differences": unexplained,
    }


def pins(repo: Path) -> dict[str, str]:
    metadata = tomllib.loads((repo / "pyproject.toml").read_text())
    dependencies = list(metadata.get("project", {}).get("dependencies", []))
    dependencies.extend(metadata.get("dependency-groups", {}).get("dev", []))
    result = {}
    for dependency in dependencies:
        if not isinstance(dependency, str):
            continue
        match = re.fullmatch(
            r"\s*([\w.-]+)(?:\[[^]]+\])?\s*==\s*([^;\s]+)(?:\s*;.*)?", dependency
        )
        if match:
            result[match[1]] = match[2]
    return result


def latest_release(package: str) -> str:
    with urllib.request.urlopen(
        f"https://pypi.org/pypi/{package}/json", timeout=20
    ) as response:
        return json.load(response)["info"]["version"]


def pytest_config(baseline: Path, candidate: Path) -> Path:
    """Keep original pytest collection settings, independent of candidate edits."""
    for name in (
        "pytest.toml",
        ".pytest.toml",
        "pytest.ini",
        ".pytest.ini",
        "pyproject.toml",
        "tox.ini",
        "setup.cfg",
    ):
        path = baseline / name
        if not path.is_file():
            continue
        if name in ("pytest.toml", ".pytest.toml", "pytest.ini", ".pytest.ini"):
            target = candidate / name
            shutil.copyfile(path, target)
            return target
        if name == "pyproject.toml":
            if "pytest" in tomllib.loads(path.read_text()).get("tool", {}):
                target = candidate / ".upgrade-score-pytest.toml"
                shutil.copyfile(path, target)
                return target
        else:
            settings = configparser.ConfigParser(interpolation=None)
            settings.read(path)
            if settings.has_section("tool:pytest" if name == "setup.cfg" else "pytest"):
                target = candidate / name
                shutil.copyfile(path, target)
                return target
    fallback = candidate / ".upgrade-score-pytest.ini"
    fallback.write_text("[pytest]\n")
    return fallback


def run_probe(
    repo: Path, probe: Path, output: Path
) -> subprocess.CompletedProcess[str]:
    return run(
        ["uv", "run", "--locked", "--no-sync", "python", str(probe), str(output)], repo
    )


def failure_log(
    completed: subprocess.CompletedProcess[str], out: Path, name: str
) -> str:
    """Keep subprocess diagnostics local; do not echo potentially private output."""
    path = out / name
    path.write_text(completed.stdout + completed.stderr)
    return f"Process exited {completed.returncode}; see {name} in the output directory"


def score(
    baseline: Path, candidate: Path, probe: Path, out: Path, rules: list[dict[str, Any]]
) -> dict[str, Any]:
    """Execute original tests and an independent probe on isolated project copies."""
    out.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="upgrade-score-") as directory:
        root = Path(directory)
        base, upgraded = root / "baseline", root / "candidate"
        copy_project(baseline, base)
        copy_project(candidate, upgraded)
        original_tests = sorted((base / "tests").rglob("*.py"))
        if not original_tests:
            raise ValueError("Baseline must contain Python tests under tests/")
        changed = [
            path.relative_to(base).as_posix()
            for path in original_tests
            if not (upgraded / path.relative_to(base)).is_file()
            or (upgraded / path.relative_to(base)).read_bytes() != path.read_bytes()
        ]
        lock_ok = run(["uv", "lock", "--check"], upgraded).returncode == 0
        pinned = pins(upgraded)
        outdated = {}
        for package, version in pinned.items():
            try:
                latest = latest_release(package)
                if latest != version:
                    outdated[package] = f"{version} (latest {latest})"
            except Exception:
                outdated[package] = f"{version} (latest unknown)"
        if (upgraded / "tests").exists():
            shutil.rmtree(upgraded / "tests")
        shutil.copytree(base / "tests", upgraded / "tests")
        baseline_sync = run(["uv", "sync", "--locked", "-q"], base)
        if baseline_sync.returncode != 0:
            error = failure_log(baseline_sync, out, "baseline-install.log")
            raise ValueError(f"Baseline locked dependency installation failed: {error}")
        baseline_probe = run_probe(base, probe, out / "reference.json")
        if baseline_probe.returncode != 0 or not (out / "reference.json").is_file():
            error = failure_log(baseline_probe, out, "baseline-probe.log")
            raise ValueError(
                f"Baseline probe failed or produced no observations: {error}"
            )
        candidate_sync = run(["uv", "sync", "--locked", "-q"], upgraded)
        sync_ok = candidate_sync.returncode == 0
        config = pytest_config(base, upgraded)
        tests = (
            run(
                [
                    "uv",
                    "run",
                    "--locked",
                    "--no-sync",
                    "pytest",
                    "tests",
                    "-c",
                    str(config),
                    "--rootdir",
                    str(upgraded),
                    "-q",
                    "-p",
                    "no:cacheprovider",
                ],
                upgraded,
            )
            if sync_ok
            else None
        )
        test_line = (
            ((tests.stdout or tests.stderr).strip().splitlines() or ["no output"])[-1]
            if tests
            else "not run: locked dependency installation failed"
        )
        candidate_probe = (
            run_probe(upgraded, probe, out / "candidate.json") if sync_ok else None
        )
        probe_ok = (
            candidate_probe is not None
            and candidate_probe.returncode == 0
            and (out / "candidate.json").is_file()
        )
        diagnostics = {}
        if not sync_ok:
            diagnostics["install_error"] = failure_log(
                candidate_sync, out, "candidate-install.log"
            )
        elif not probe_ok:
            diagnostics["probe_error"] = failure_log(
                candidate_probe, out, "candidate-probe.log"
            )
        result = {
            "tests_changed_by_agent": changed,
            "lock_check_ok": lock_ok,
            "uv_sync_ok": sync_ok,
            "pins": pinned,
            "not_latest": outdated,
            "original_tests": test_line,
            "original_tests_passed": tests is not None and tests.returncode == 0,
            "probe_ran": probe_ok,
            **diagnostics,
        }
        if probe_ok:
            result.update(
                compare(
                    json.loads((out / "reference.json").read_text()),
                    json.loads((out / "candidate.json").read_text()),
                    rules,
                )
            )
        else:
            result.update(
                {
                    "calls_total": None,
                    "calls_differing": None,
                    "breakages": {
                        rule["id"]: {
                            "desc": rule["description"],
                            "tests_catch": rule["tests_catch"],
                            "fixed": None,
                            "evidence": [],
                        }
                        for rule in rules
                    },
                    "unexplained_differences": [],
                }
            )
    return result


def report(result: dict[str, Any]) -> str:
    lines = [
        "# Dependency upgrade score",
        "",
        f"- Original tests on candidate: {result['original_tests']}",
        f"- Original tests modified or removed: {', '.join(result['tests_changed_by_agent']) or 'none'}",
        f"- Lock check: {result['lock_check_ok']}; locked installation: {result['uv_sync_ok']}",
        f"- Direct pins not confirmed latest: {result['not_latest'] or 'none'}",
        f"- Differing probe requests: {result['calls_differing']} / {result['calls_total']}"
        if result["probe_ran"]
        else "- Candidate probe did not complete; parity and breakages are unassessed.",
        "",
    ]
    for key in ("install_error", "probe_error"):
        if key in result:
            lines.append(f"- {result[key]}")
    if result["breakages"]:
        lines.extend(
            [
                "| Rule | Description | Original tests catch? | No matching differences |",
                "| --- | --- | --- | --- |",
            ]
        )
        for key, rule in result["breakages"].items():
            lines.append(
                f"| {key} | {rule['desc']} | {rule['tests_catch']} | {rule['fixed']} |"
            )
    lines.extend(["", "## Unattributed differences", ""])
    for diff in result["unexplained_differences"]:
        lines.append(
            f"- `{diff['req']}` `{diff['field']}` ({diff['change']}): "
            f"{json.dumps(diff['original'])} -> {json.dumps(diff['candidate'])}"
        )
    lines.extend(
        [
            "",
            "A behavior difference needs review against intended behavior. Passing these checks does not establish complete API or stored-data compatibility.",
            "",
        ]
    )
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--baseline", type=Path, required=True, help="original source and lockfile"
    )
    parser.add_argument(
        "--repo", type=Path, required=True, help="completed agent working copy"
    )
    parser.add_argument(
        "--probe", type=Path, required=True, help="independent Python API probe"
    )
    parser.add_argument(
        "--rules", type=Path, help="optional JSON difference attribution rules"
    )
    parser.add_argument("--out", type=Path, required=True, help="new output directory")
    args = parser.parse_args()
    baseline, candidate, probe, out = (
        path.resolve() for path in (args.baseline, args.repo, args.probe, args.out)
    )
    if out.exists():
        parser.error(
            "Output directory already exists; choose a new directory to preserve prior evidence"
        )
    if any(
        out == source or out.is_relative_to(source) for source in (baseline, candidate)
    ):
        parser.error("Output directory must be outside baseline and candidate trees")
    try:
        result = score(baseline, candidate, probe, out, load_rules(args.rules))
    except (ValueError, OSError, KeyError, re.error) as error:
        parser.exit(2, f"Scoring failed: {error}\n")
    (out / "score.json").write_text(json.dumps(result, indent=2) + "\n")
    summary = report(result)
    (out / "report.md").write_text(summary)
    print(summary)


if __name__ == "__main__":
    main()

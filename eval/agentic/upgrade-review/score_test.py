"""Secret-free regression checks for the portable scorer."""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import score


class ScorerTests(unittest.TestCase):
    def test_host_pytest_selection_does_not_enter_scoring(self) -> None:
        with (
            patch.dict(
                score.os.environ,
                {"PYTEST_ADDOPTS": "-k smoke", "VIRTUAL_ENV": "/other/venv"},
            ),
            patch.object(score.subprocess, "run") as command,
        ):
            score.run(["uv", "run", "pytest"], Path("example"))
        self.assertEqual(command.call_args.kwargs["env"]["PYTEST_ADDOPTS"], "")
        self.assertNotIn("VIRTUAL_ENV", command.call_args.kwargs["env"])

    def test_original_pytest_configuration_is_relocated_without_changing_dependencies(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            baseline, candidate = root / "baseline", root / "candidate"
            baseline.mkdir()
            candidate.mkdir()
            original = '[project]\ndependencies=["example==1"]\n[tool.pytest.ini_options]\npython_files=["check_*.py"]\npythonpath=["."]\naddopts="--import-mode=importlib"\n'
            upgraded = '[project]\ndependencies=["example==2"]\n'
            (baseline / "pyproject.toml").write_text(original)
            (candidate / "pyproject.toml").write_text(upgraded)
            config = score.pytest_config(baseline, candidate)
            self.assertEqual(config.parent, candidate)
            self.assertEqual(config.read_text(), original)
            self.assertEqual((candidate / "pyproject.toml").read_text(), upgraded)
            (baseline / "pytest.ini").write_text("[pytest]\npython_files=custom_*.py\n")
            self.assertEqual(
                score.pytest_config(baseline, candidate).name, "pytest.ini"
            )

    def test_failed_probe_diagnostics_stay_in_local_file(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            process = subprocess.CompletedProcess(
                ["probe"], 1, "", "private diagnostic"
            )
            message = score.failure_log(process, output, "candidate-probe.log")
            self.assertNotIn("private diagnostic", message)
            self.assertIn("candidate-probe.log", message)
            self.assertEqual(
                (output / "candidate-probe.log").read_text(), "private diagnostic"
            )

    def test_existing_score_is_not_overwritten(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            output = root / "score"
            output.mkdir()
            evidence = output / "score.json"
            evidence.write_text("original evidence\n")
            completed = subprocess.run(
                [
                    sys.executable,
                    str(Path(score.__file__)),
                    "--baseline",
                    str(root / "baseline"),
                    "--repo",
                    str(root / "candidate"),
                    "--probe",
                    str(root / "probe.py"),
                    "--out",
                    str(output),
                ],
                capture_output=True,
                text=True,
            )
            self.assertEqual(completed.returncode, 2)
            self.assertIn("already exists", completed.stderr)
            self.assertEqual(evidence.read_text(), "original evidence\n")

    def test_scoring_output_cannot_modify_an_input_tree(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            candidate = root / "candidate"
            candidate.mkdir()
            completed = subprocess.run(
                [
                    sys.executable,
                    str(Path(score.__file__)),
                    "--baseline",
                    str(root / "baseline"),
                    "--repo",
                    str(candidate),
                    "--probe",
                    str(root / "probe.py"),
                    "--out",
                    str(candidate / "score"),
                ],
                capture_output=True,
                text=True,
            )
            self.assertEqual(completed.returncode, 2)
            self.assertIn("outside", completed.stderr)
            self.assertEqual(list(candidate.iterdir()), [])

    def test_null_missing_and_numeric_types_are_not_equal(self) -> None:
        self.assertEqual(score.field_diffs({"value": None}, {})[0]["change"], "removed")
        self.assertEqual(score.field_diffs({}, {"value": None})[0]["change"], "added")
        self.assertEqual(len(score.field_diffs(True, 1)), 1)
        self.assertEqual(len(score.field_diffs(1, 1.0)), 1)
        self.assertEqual(
            score.field_diffs({"values": [1, None]}, {"values": [1, None]}), []
        )

    def test_status_change_does_not_hide_body_regressions(self) -> None:
        old = [{"req": "GET /items", "status": 200, "body": {"count": 1}}]
        new = [{"req": "GET /items", "status": 500, "body": {"count": 2}}]
        rules = [
            {
                "id": "status",
                "description": "Status changed",
                "tests_catch": False,
                "matches": [
                    {
                        "request": "^GET /items$",
                        "field": "^status$",
                        "status_changed": True,
                    }
                ],
            }
        ]
        result = score.compare(old, new, rules)
        self.assertEqual(result["calls_differing"], 1)
        self.assertFalse(result["breakages"]["status"]["fixed"])
        self.assertEqual(result["unexplained_differences"][0]["field"], ".count")

    def test_different_probe_sequences_cannot_be_scored_as_equal(self) -> None:
        row = {"req": "GET /items", "status": 200, "body": []}
        with self.assertRaisesRegex(ValueError, "at least one"):
            score.compare([], [], [])
        with self.assertRaisesRegex(ValueError, "at least one"):
            score.compare([row], [], [])
        with self.assertRaisesRegex(ValueError, "sequence"):
            score.compare([row, row], [row], [])

    def test_rule_ids_and_patterns_are_validated(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            rules = Path(temporary) / "rules.json"
            rule = {
                "id": "R1",
                "description": "Example",
                "tests_catch": False,
                "matches": [{"request": "^GET /items$", "field": "^status$"}],
            }
            rules.write_text(json.dumps([rule, rule]))
            with self.assertRaisesRegex(ValueError, "unique"):
                score.load_rules(rules)
            rule["id"] = ""
            rules.write_text(json.dumps([rule]))
            with self.assertRaisesRegex(ValueError, "nonempty"):
                score.load_rules(rules)

    def test_named_virtualenv_is_not_copied(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "source"
            source.mkdir()
            (source / "app.py").write_text("print('example')\n")
            environment = source / ".venv-upgraded"
            environment.mkdir()
            (environment / "pyvenv.cfg").write_text("home = /missing\n")
            (environment / "python").symlink_to("missing-interpreter")
            target = Path(temporary) / "copy"
            score.copy_project(source, target)
            self.assertEqual((target / "app.py").read_text(), "print('example')\n")
            self.assertFalse((target / ".venv-upgraded").exists())
            self.assertTrue(environment.exists())

    def test_original_tests_are_restored_only_in_disposable_copy(self) -> None:
        self.check_scoring(sync_ok=True)

    def test_failed_locked_install_does_not_claim_tests_or_parity_passed(self) -> None:
        self.check_scoring(sync_ok=False)

    def test_failed_candidate_probe_is_unassessed_with_local_diagnostics(self) -> None:
        self.check_scoring(sync_ok=True, probe_ok=False)

    def test_baseline_failure_preserves_diagnostics_and_stops_scoring(self) -> None:
        for failure in ("install", "probe"):
            with self.subTest(failure=failure):
                self.check_scoring(sync_ok=True, baseline_failure=failure)

    def check_scoring(
        self, sync_ok: bool, probe_ok: bool = True, baseline_failure: str | None = None
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            original, candidate = root / "original", root / "candidate"
            for project in (original, candidate):
                (project / "tests").mkdir(parents=True)
                (project / "pyproject.toml").write_text(
                    '[project]\nname="example"\nversion="0.1"\ndependencies=["example==1.0"]\n'
                )
                (project / "uv.lock").write_text("original lock\n")
            (original / "tests/test_app.py").write_text("assert True\n")
            (candidate / "tests/test_app.py").write_text("assert False\n")
            (original / "tests/helper.py").write_text("raise SystemExit(1)\n")
            probe = root / "probe.py"
            probe.write_text("# External probe\n")
            commands = []

            def fake_run(
                command: list[str], repo: Path
            ) -> subprocess.CompletedProcess[str]:
                commands.append((command, repo.name))
                self.assertNotIn(repo, (original, candidate))
                if repo.name == "baseline" and (
                    (baseline_failure == "install" and command[:2] == ["uv", "sync"])
                    or (baseline_failure == "probe" and str(probe) in command)
                ):
                    return subprocess.CompletedProcess(
                        command, 1, "", "baseline diagnostic"
                    )
                if repo.name == "candidate" and str(probe) in command and not probe_ok:
                    return subprocess.CompletedProcess(
                        command, 1, "", "probe diagnostic"
                    )
                if (
                    command[:2] == ["uv", "sync"]
                    and repo.name == "candidate"
                    and not sync_ok
                ):
                    return subprocess.CompletedProcess(command, 1, "", "install failed")
                if "pytest" in command:
                    self.assertIn("tests", command)
                    self.assertNotIn("tests/test_app.py", command)
                    self.assertEqual(
                        Path(command[command.index("-c") + 1]).parent, repo
                    )
                    self.assertEqual(command[command.index("--rootdir") + 1], str(repo))
                    self.assertNotIn("-o", command)
                    self.assertEqual(
                        (repo / "tests/helper.py").read_text(), "raise SystemExit(1)\n"
                    )
                    self.assertEqual(
                        (repo / "tests/test_app.py").read_text(), "assert True\n"
                    )
                if str(probe) in command:
                    Path(command[-1]).write_text(
                        json.dumps([{"req": "GET /items", "status": 200, "body": []}])
                    )
                return subprocess.CompletedProcess(
                    command, 0, "1 passed\n", "warning\n"
                )

            rules = [
                {
                    "id": "R1",
                    "description": "Example",
                    "tests_catch": False,
                    "matches": [{"request": "^GET /items$", "field": "^status$"}],
                }
            ]
            with (
                patch.object(score, "run", side_effect=fake_run),
                patch.object(score, "latest_release", return_value="1.0"),
            ):
                if baseline_failure:
                    with self.assertRaisesRegex(ValueError, "Baseline") as raised:
                        score.score(original, candidate, probe, root / "output", rules)
                    self.assertNotIn("baseline diagnostic", str(raised.exception))
                    self.assertEqual(
                        (
                            root / "output" / f"baseline-{baseline_failure}.log"
                        ).read_text(),
                        "baseline diagnostic",
                    )
                    return
                result = score.score(original, candidate, probe, root / "output", rules)
            self.assertEqual(
                result["tests_changed_by_agent"],
                ["tests/helper.py", "tests/test_app.py"],
            )
            if sync_ok:
                self.assertEqual(result["original_tests"], "1 passed")
            else:
                self.assertIn("candidate-install.log", result["install_error"])
                self.assertEqual(
                    (root / "output/candidate-install.log").read_text(),
                    "install failed",
                )
            self.assertEqual(
                (candidate / "tests/test_app.py").read_text(), "assert False\n"
            )
            self.assertEqual((candidate / "uv.lock").read_text(), "original lock\n")
            self.assertEqual(result["probe_ran"], sync_ok and probe_ok)
            self.assertEqual(result["original_tests_passed"], sync_ok)
            self.assertEqual(
                result["calls_differing"], 0 if sync_ok and probe_ok else None
            )
            self.assertEqual(
                result["breakages"]["R1"]["fixed"],
                True if sync_ok and probe_ok else None,
            )
            if sync_ok and not probe_ok:
                self.assertIn("candidate-probe.log", result["probe_error"])
                self.assertEqual(
                    (root / "output/candidate-probe.log").read_text(),
                    "probe diagnostic",
                )
            if not sync_ok:
                self.assertFalse(
                    any(
                        "pytest" in command or str(probe) in command
                        for command, project in commands
                        if project == "candidate"
                    )
                )
            self.assertIn("complete API", score.report(result))


if __name__ == "__main__":
    unittest.main()

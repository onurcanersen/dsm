"""The git adapter with subprocess mocked: clone command, error mapping, acquired
file records, version listing and the second address (SRS DSM-MDG req 11, 13-16)."""

import logging
import subprocess
from pathlib import Path

import pytest

from fakes import seed
from mdg.adapters.source_code.git_source_code_repository import GitSourceCodeRepository
from mdg.adapters.source_code.mandatory_files import MandatoryFiles
from mdg.domain.data_source import DataSourceConfig, SourceType
from mdg.domain.inventory import SoftwareUnitVersion
from mdg.ports.source_code_repository import (
    SourceRepoAccessError,
    SourceRepoAuthError,
    SourceRepoIntegrityError,
    SourceRepoOfflineError,
)

NAV_APP = SoftwareUnitVersion(seed.NAV_APP, seed.VERSION)
SENSOR_APP = SoftwareUnitVersion(seed.SENSOR_APP, seed.VERSION)


SECRET = "s3cr3t@pw"
NOT_FOUND = "fatal: repository not found"
UNREACHABLE = "fatal: unable to access 'http://localhost:3000/': Failed to connect to localhost port 3000: Connection refused"
AUTH_REFUSED = "fatal: Authentication failed"
LOGGER = "mdg.adapters.source_code.git_source_code_repository"


def _repository(credentials: str = seed.CREDENTIALS, fallback: str = "") -> GitSourceCodeRepository:
    source = DataSourceConfig(
        SourceType.SOURCE_CODE_REPO, "gitea", "git", seed.SOURCE_REPO_URL, credentials, fallback
    )
    return GitSourceCodeRepository.from_data_source_config(source, MandatoryFiles([seed.MAKEFILE_INCLUDE]), seed.SYSTEM_REPO)


def _fake_git(monkeypatch, stdout="", returncode=0, stderr="", captured=None, captured_env=None):
    def run(cmd, **kwargs):
        if captured is not None:
            captured.append(cmd)
        if captured_env is not None:
            captured_env.append(kwargs.get("env"))
        return subprocess.CompletedProcess(cmd, returncode, stdout=stdout, stderr=stderr)

    monkeypatch.setattr("mdg.adapters.source_code.git_source_code_repository.subprocess.run", run)


def _fake_git_calls(monkeypatch, outcomes, captured=None):
    """Answers every git call with the next (returncode, stderr[, stdout]) outcome;
    a call beyond the outcomes a test lists fails it, which is how a test says that
    nothing was retried."""
    remaining = list(outcomes)

    def run(cmd, **kwargs):
        if captured is not None:
            captured.append(cmd)
        assert remaining, f"unexpected git call: {' '.join(cmd[-3:])}"
        returncode, stderr, *stdout = remaining.pop(0)
        if returncode is None:
            raise subprocess.TimeoutExpired(cmd, kwargs["timeout"])
        return subprocess.CompletedProcess(cmd, returncode, stdout=stdout[0] if stdout else "", stderr=stderr)

    monkeypatch.setattr("mdg.adapters.source_code.git_source_code_repository.subprocess.run", run)


def test_check_access_reads_the_system_repo_with_the_credentials(monkeypatch):
    captured, captured_env = [], []
    _fake_git(monkeypatch, captured=captured, captured_env=captured_env)

    _repository().check_access()

    assert captured[0][-3:] == ["ls-remote", "--heads", "http://localhost:3000/dsm-src/system_repo.git"]
    assert captured_env[0]["DSM_GIT_USER"] == "dsm"
    assert captured_env[0]["DSM_GIT_PASSWORD"] == "dsm"
    assert captured_env[0]["GIT_TERMINAL_PROMPT"] == "0"


def test_the_password_is_kept_out_of_the_command_line(monkeypatch, tmp_path: Path):
    captured, captured_env = [], []
    _fake_git(monkeypatch, captured=captured, captured_env=captured_env)

    _repository(f"dsm:{SECRET}").clone(NAV_APP, tmp_path)

    assert not any(SECRET in arg for arg in captured[0])
    assert captured_env[0]["DSM_GIT_PASSWORD"] == SECRET


def test_a_timeout_maps_to_an_access_error_without_the_password(monkeypatch, tmp_path: Path):
    def run(cmd, **kwargs):
        raise subprocess.TimeoutExpired(cmd, kwargs["timeout"])

    monkeypatch.setattr("mdg.adapters.source_code.git_source_code_repository.subprocess.run", run)

    with pytest.raises(SourceRepoAccessError) as error:
        _repository(f"dsm:{SECRET}").clone(NAV_APP, tmp_path)

    assert SECRET not in str(error.value)


def test_the_password_is_redacted_from_git_error_output(monkeypatch):
    _fake_git(monkeypatch, returncode=128, stderr=f"fatal: unable to access 'http://dsm:{SECRET}@localhost/'")

    with pytest.raises(SourceRepoAccessError) as error:
        _repository(f"dsm:{SECRET}").check_access()

    assert SECRET not in str(error.value) and "***" in str(error.value)


def test_check_access_maps_refused_credentials_and_a_missing_repo(monkeypatch):
    _fake_git(monkeypatch, returncode=128, stderr="fatal: Authentication failed")
    with pytest.raises(SourceRepoAuthError, match=seed.SYSTEM_REPO):
        _repository().check_access()

    _fake_git(monkeypatch, returncode=128, stderr="fatal: repository not found")
    with pytest.raises(SourceRepoAccessError, match="repository not found"):
        _repository().check_access()


def test_clone_asks_for_the_version_tag_of_the_org_repository(monkeypatch, tmp_path: Path):
    captured = []
    _fake_git(monkeypatch, captured=captured)

    unit_dir = _repository().clone(NAV_APP, tmp_path)

    assert unit_dir == tmp_path / seed.NAV_APP
    assert captured[0][:3] == ["git", "-c", "http.sslVerify=false"]
    assert captured[0][-7:-2] == ["clone", "--depth", "1", "--branch", seed.VERSION]
    assert captured[0][-2] == "http://localhost:3000/dsm-src/nav_app.git"
    assert captured[0][-1] == str(unit_dir)


def test_git_failures_map_to_the_port_errors(monkeypatch, tmp_path: Path):
    _fake_git(monkeypatch, returncode=128, stderr=AUTH_REFUSED)
    with pytest.raises(SourceRepoAuthError, match=seed.NAV_APP):
        _repository().clone(NAV_APP, tmp_path)

    _fake_git(monkeypatch, returncode=128, stderr=NOT_FOUND)
    with pytest.raises(SourceRepoAccessError, match=NOT_FOUND):
        _repository().clone(NAV_APP, tmp_path)

    _fake_git(monkeypatch, returncode=128, stderr=UNREACHABLE)
    with pytest.raises(SourceRepoOfflineError, match=seed.NAV_APP):
        _repository().clone(NAV_APP, tmp_path)


def test_one_address_reports_the_failure_as_before(monkeypatch, tmp_path: Path):
    _fake_git(monkeypatch, returncode=128, stderr=NOT_FOUND)

    with pytest.raises(SourceRepoAccessError) as error:
        _repository().clone(NAV_APP, tmp_path)

    assert str(error.value) == f"Could not clone '{seed.NAV_APP}' at '{seed.VERSION}': {NOT_FOUND}"


def test_a_repository_absent_at_the_first_address_is_cloned_from_the_second(monkeypatch, tmp_path: Path, caplog):
    captured = []
    _fake_git_calls(monkeypatch, [(128, NOT_FOUND), (0, "")], captured)
    caplog.set_level(logging.DEBUG, logger=LOGGER)

    unit_dir = _repository(fallback=seed.FALLBACK_SOURCE_REPO_URL).clone(NAV_APP, tmp_path)

    assert unit_dir == tmp_path / seed.NAV_APP
    assert [command[-2] for command in captured] == [
        "http://localhost:3000/dsm-src/nav_app.git",
        "http://backup:3000/dsm-mirror/nav_app.git",
    ]
    assert "from the fallback address 'http://backup:3000/dsm-mirror'" in caplog.text


def test_a_repository_the_first_address_lacks_is_worth_no_warning(monkeypatch, tmp_path: Path, caplog):
    _fake_git_calls(monkeypatch, [(128, NOT_FOUND), (0, "")])
    caplog.set_level(logging.DEBUG, logger=LOGGER)

    _repository(fallback=seed.FALLBACK_SOURCE_REPO_URL).clone(NAV_APP, tmp_path)

    assert [record.levelno for record in caplog.records if record.name == LOGGER] == [logging.DEBUG, logging.INFO]
    assert seed.SOURCE_REPO_URL in caplog.records[0].getMessage()


def test_a_repository_no_address_holds_warns_once_about_both(monkeypatch, tmp_path: Path, caplog):
    _fake_git_calls(monkeypatch, [(128, NOT_FOUND), (128, NOT_FOUND)])
    caplog.set_level(logging.DEBUG, logger=LOGGER)

    with pytest.raises(SourceRepoAccessError):
        _repository(fallback=seed.FALLBACK_SOURCE_REPO_URL).clone(NAV_APP, tmp_path)

    assert [record.levelno for record in caplog.records if record.name == LOGGER] == [logging.DEBUG, logging.DEBUG, logging.WARNING]
    assert seed.SOURCE_REPO_URL in caplog.text and seed.FALLBACK_SOURCE_REPO_URL in caplog.text


def test_refused_credentials_are_never_tried_at_the_second_address(monkeypatch, tmp_path: Path):
    captured = []
    _fake_git_calls(monkeypatch, [(128, AUTH_REFUSED)], captured)

    with pytest.raises(SourceRepoAuthError, match=seed.NAV_APP):
        _repository(fallback=seed.FALLBACK_SOURCE_REPO_URL).clone(NAV_APP, tmp_path)

    assert len(captured) == 1


def test_an_address_that_cannot_be_reached_is_left_out_of_the_rest_of_the_run(monkeypatch, tmp_path: Path):
    captured = []
    _fake_git_calls(monkeypatch, [(128, UNREACHABLE), (0, ""), (0, "")], captured)
    repository = _repository(fallback=seed.FALLBACK_SOURCE_REPO_URL)

    repository.clone(NAV_APP, tmp_path)
    repository.clone(SENSOR_APP, tmp_path)

    assert [command[-2] for command in captured] == [
        "http://localhost:3000/dsm-src/nav_app.git",
        "http://backup:3000/dsm-mirror/nav_app.git",
        "http://backup:3000/dsm-mirror/sensor_app.git",
    ]


def test_a_failed_clone_clears_the_destination_before_the_next_address(monkeypatch, tmp_path: Path):
    unit_dir = tmp_path / seed.NAV_APP
    present = []

    def run(cmd, **kwargs):
        present.append(unit_dir.exists())
        if len(present) == 1:
            unit_dir.mkdir(parents=True)
            return subprocess.CompletedProcess(cmd, 128, stdout="", stderr=UNREACHABLE)
        return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

    monkeypatch.setattr("mdg.adapters.source_code.git_source_code_repository.subprocess.run", run)

    _repository(fallback=seed.FALLBACK_SOURCE_REPO_URL).clone(NAV_APP, tmp_path)

    assert present == [False, False]


def test_a_time_out_at_the_first_address_falls_back_too(monkeypatch, tmp_path: Path):
    captured = []
    _fake_git_calls(monkeypatch, [(None, ""), (0, "")], captured)

    _repository(fallback=seed.FALLBACK_SOURCE_REPO_URL).clone(NAV_APP, tmp_path)

    assert len(captured) == 2 and captured[1][-2].startswith("http://backup:3000/")


def test_a_repository_absent_at_both_addresses_names_both(monkeypatch, tmp_path: Path):
    _fake_git_calls(monkeypatch, [(128, NOT_FOUND), (128, NOT_FOUND)])

    with pytest.raises(SourceRepoAccessError) as error:
        _repository(fallback=seed.FALLBACK_SOURCE_REPO_URL).clone(NAV_APP, tmp_path)

    message = str(error.value)
    assert "repository not found" in message and seed.SOURCE_REPO_URL in message and seed.FALLBACK_SOURCE_REPO_URL in message


def test_the_second_address_is_redacted_like_the_first(monkeypatch, tmp_path: Path):
    _fake_git_calls(monkeypatch, [(128, f"fatal: unable to access 'http://dsm:{SECRET}@localhost/'"), (128, NOT_FOUND)])

    with pytest.raises(SourceRepoAccessError) as error:
        _repository(f"dsm:{SECRET}", fallback=f"http://dsm:{SECRET}@backup:3000/dsm-mirror").clone(NAV_APP, tmp_path)

    assert SECRET not in str(error.value) and "backup:3000" in str(error.value)


def test_check_access_and_the_versions_also_use_the_second_address(monkeypatch):
    captured = []
    _fake_git_calls(monkeypatch, [(128, NOT_FOUND), (0, "")], captured)
    repository = _repository(fallback=seed.FALLBACK_SOURCE_REPO_URL)

    repository.check_access()

    assert [command[-1] for command in captured] == [
        "http://localhost:3000/dsm-src/system_repo.git",
        "http://backup:3000/dsm-mirror/system_repo.git",
    ]

    captured.clear()
    _fake_git_calls(monkeypatch, [(128, NOT_FOUND), (0, "", "9f1c\trefs/tags/1.0.0\n")], captured)

    assert repository.list_versions(seed.SENSOR_APP) == ["1.0.0"]
    assert captured[1][-1] == "http://backup:3000/dsm-mirror/sensor_app.git"


def test_acquired_files_record_the_mandatory_files_at_the_paths_found(tmp_path: Path):
    (tmp_path / "build").mkdir()
    (tmp_path / "build" / "Makefile").write_text(seed.VALID_MAKEFILE, encoding="utf-8")
    (tmp_path / "src" / "sub").mkdir(parents=True)
    (tmp_path / "src" / "sub" / "nav_app.xml").write_text(seed.NAV_APP_MANIFEST, encoding="utf-8")

    records = {f.file_name: f for f in _repository().acquired_files(NAV_APP, tmp_path)}

    assert records["Makefile"].file_path == str(tmp_path / "build" / "Makefile")
    assert records["nav_app.xml"].file_path == str(tmp_path / "src" / "sub" / "nav_app.xml")
    assert all(f.package_version == seed.VERSION and f.unit_name == seed.NAV_APP for f in records.values())


def test_acquired_files_skip_what_is_absent_or_invalid(tmp_path: Path):
    (tmp_path / "Makefile").write_text(".PHONY: all\n", encoding="utf-8")

    assert _repository().acquired_files(NAV_APP, tmp_path) == []
    assert _repository().mandatory_files(seed.NAV_APP) == ["Makefile", "nav_app.xml"]


def test_unreadable_file_raises_integrity_error(monkeypatch, tmp_path: Path):
    (tmp_path / "Makefile").write_text(seed.VALID_MAKEFILE, encoding="utf-8")
    monkeypatch.setattr(Path, "read_bytes", lambda self: (_ for _ in ()).throw(OSError("disk error")))

    with pytest.raises(SourceRepoIntegrityError, match="disk error"):
        _repository().acquired_files(NAV_APP, tmp_path)


def test_versions_are_the_tags_newest_first_in_numeric_order(monkeypatch):
    captured = []
    _fake_git(
        monkeypatch,
        stdout="9f1c\trefs/tags/1.0.0\na2b3\trefs/tags/1.0.3\nc4d5\trefs/tags/1.0.10\ne5f6\trefs/heads/main\n",
        captured=captured,
    )

    assert _repository().list_versions(seed.SENSOR_APP) == ["1.0.10", "1.0.3", "1.0.0"]
    assert "ls-remote" in captured[0] and captured[0][-1].endswith("/dsm-src/sensor_app.git")


def test_version_key_orders_text_versions_without_error():
    versions = ["1.0.0", "1.1.0-rc1", "main", "1.0.10", "1.0.9"]

    assert sorted(versions, key=GitSourceCodeRepository.version_key)[:3] == ["1.0.0", "1.0.9", "1.0.10"]


def test_listing_versions_maps_failures_like_cloning(monkeypatch):
    _fake_git(monkeypatch, returncode=128, stderr="fatal: Authentication failed")

    with pytest.raises(SourceRepoAuthError):
        _repository().list_versions(seed.SENSOR_APP)

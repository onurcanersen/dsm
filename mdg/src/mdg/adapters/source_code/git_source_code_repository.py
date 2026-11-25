"""Git adapter of the source code repository port: shallow clones by version
tag from one organization on a git server, or from the organization of a second
address when the first does not hold the repository or cannot be reached
(SRS DSM-MDG req 2.2, 11, 13-16)."""

from __future__ import annotations

import logging
import os
import re
import shutil
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Callable, List, Optional, Tuple, TypeVar

from mdg.adapters.source_code.mandatory_files import MandatoryFiles
from mdg.domain.acquired_file import AcquiredFile
from mdg.domain.data_source import DataSourceConfig
from mdg.domain.inventory import SoftwareUnitVersion
from mdg.ports.source_code_repository import (
    ISourceCodeRepository,
    SourceRepoAccessError,
    SourceRepoAuthError,
    SourceRepoIntegrityError,
    SourceRepoOfflineError,
)

logger = logging.getLogger(__name__)

CLONE_TIMEOUT_SECONDS = 300
LS_REMOTE_TIMEOUT_SECONDS = 60
CHECK_TIMEOUT_SECONDS = 15
_TAG_PREFIX = "refs/tags/"
_T = TypeVar("_T")
Endpoint = Tuple[str, str]
"""One address of the repository, as its `<base_url>` and its `<org>`."""
_OFFLINE_MARKERS = (
    "could not resolve host",
    "failed to connect",
    "connection refused",
    "connection timed out",
    "network is unreachable",
    "unable to access",
    "the requested url returned error: 5",
)
"""What git reports when an address cannot be reached at all, as opposed to
answering that it does not hold the repository."""
_CREDENTIALS_IN_URL = re.compile(r"^([A-Za-z][A-Za-z0-9+.-]*://)[^/?#\s]+@")
"""The `<user>:<password>@` a connection address may carry, which never appears in
a message or a log line."""
# Answers git's credential request from the environment, so the password never
# appears in the command line, the URL or the cloned repository's config.
_CREDENTIAL_HELPER = (
    '!f() { test "$1" = get && printf "username=%s\\npassword=%s\\n" '
    '"$DSM_GIT_USER" "$DSM_GIT_PASSWORD"; }; f'
)


class GitSourceCodeRepository(ISourceCodeRepository):
    """Clones <base_url>/<org>/<unit>.git at the tag named by the unit version;
    the system repo is the repository the credential check reads. Every operation
    is retried at the second address when the first one lacks the repository or
    cannot be reached, and an address that cannot be reached is dropped for the
    rest of the run of this instance (req 4, 16)."""

    def __init__(
        self,
        base_url: str,
        org: str,
        user: str,
        password: str,
        files: MandatoryFiles,
        system_repo: str,
        fallback_base_url: str = "",
        fallback_org: str = "",
    ):
        self._endpoints: List[Endpoint] = [(base_url.rstrip("/"), org)]
        if fallback_base_url or fallback_org:
            fallback: Endpoint = (fallback_base_url.rstrip("/"), fallback_org)
            if fallback not in self._endpoints:
                self._endpoints.append(fallback)
        self._user = user
        self._password = password
        self._files = files
        self._system_repo = system_repo
        self._unreachable: List[Endpoint] = []

    @classmethod
    def from_data_source_config(cls, source: DataSourceConfig, files: MandatoryFiles, system_repo: str) -> "GitSourceCodeRepository":
        """Builds the repository from a "<base_url>/<org>" address and
        "<user>:<password>" user information, splitting the second address the
        same way when the source names one (req 4)."""
        base_url, _, org = source.connection_address.rpartition("/")
        fallback = source.fallback_connection_address.strip()
        fallback_base_url, _, fallback_org = fallback.rpartition("/") if fallback else ("", "", "")
        user, _, password = source.user_info.partition(":")
        return cls(base_url, org, user, password, files, system_repo, fallback_base_url, fallback_org)

    def check_access(self) -> None:
        self._at_every_address(
            f"reach '{self._system_repo}'",
            lambda address: self._git(
                ["ls-remote", "--heads", self._url(address, self._system_repo)],
                f"reach '{self._system_repo}'",
                CHECK_TIMEOUT_SECONDS,
            ),
        )

    def clone(self, unit: SoftwareUnitVersion, dest_dir: Path) -> Path:
        unit_dir = dest_dir / unit.unit_name
        self._at_every_address(
            f"clone '{unit.unit_name}' at '{unit.version}'",
            lambda address: self._git(
                ["clone", "--depth", "1", "--branch", unit.version, self._url(address, unit.unit_name), str(unit_dir)],
                f"clone '{unit.unit_name}' at '{unit.version}'",
                CLONE_TIMEOUT_SECONDS,
            ),
            # A timed-out clone can leave the destination behind, which the next
            # address would then refuse to clone into.
            lambda: shutil.rmtree(unit_dir, ignore_errors=True),
        )
        shutil.rmtree(unit_dir / ".git", ignore_errors=True)
        return unit_dir

    def acquired_files(self, unit: SoftwareUnitVersion, unit_dir: Path) -> List[AcquiredFile]:
        now = datetime.now()
        records = []
        for path in self._files.locate(unit_dir, unit.unit_name).values():
            if path is None:
                continue
            try:
                path.read_bytes()
            except OSError as exc:
                raise SourceRepoIntegrityError(f"Cannot read '{path}' of '{unit.unit_name}': {exc}") from exc
            records.append(AcquiredFile(unit.unit_name, path.name, str(path), unit.version, now))
        return records

    def mandatory_files(self, unit_name: str) -> List[str]:
        return self._files.expected(unit_name)

    def list_versions(self, unit_name: str) -> List[str]:
        result = self._at_every_address(
            f"list the versions of '{unit_name}'",
            lambda address: self._git(
                ["ls-remote", "--tags", "--refs", self._url(address, unit_name)],
                f"list the versions of '{unit_name}'",
                LS_REMOTE_TIMEOUT_SECONDS,
            ),
        )
        versions = [
            line.partition("\t")[2].strip()[len(_TAG_PREFIX):]
            for line in result.stdout.splitlines()
            if line.partition("\t")[2].strip().startswith(_TAG_PREFIX)
        ]
        versions.sort(key=self.version_key, reverse=True)
        return versions

    @staticmethod
    def version_key(version: str) -> Tuple[tuple, ...]:
        """Sort key ordering digit runs numerically, so 1.0.10 follows 1.0.9."""
        return tuple(
            (0, int(part), "") if part.isdigit() else (1, 0, part)
            for part in re.split(r"(\d+)", version) if part
        )

    def _at_every_address(self, attempt: str, git_at_address: Callable[[Endpoint], _T], before_retry: Optional[Callable[[], None]] = None) -> _T:
        """Runs one git operation at the addresses in order: a repository the first
        address does not hold is looked for at the next, an address that cannot be
        reached at all is dropped for the rest of this run, and refused credentials
        are never tried anywhere else (req 16).

        Repositories spread over both addresses is the normal case, so a repository
        one address does not hold is worth a debug line only; what is worth a warning
        is an address that cannot be reached and a repository no address can serve."""
        last: Optional[SourceRepoAccessError] = None
        for address in self._addresses():
            if address != self._endpoints[0] and before_retry is not None:
                before_retry()
            try:
                result = git_at_address(address)
            except SourceRepoAuthError:
                raise
            except SourceRepoOfflineError as exc:
                logger.warning("cannot reach '%s' to %s: %s", self._safe_address(address), attempt, exc)
                if address not in self._unreachable:
                    self._unreachable.append(address)
                last = exc
            except SourceRepoAccessError as exc:
                logger.debug("cannot %s from '%s': %s", attempt, self._safe_address(address), exc)
                last = exc
            else:
                if address != self._endpoints[0]:
                    logger.info("%s from the fallback address '%s'", attempt, self._safe_address(address))
                return result
        if last is None:
            raise SourceRepoAccessError(f"Could not {attempt}: no connection address configured")
        tried = ", ".join(f"'{self._safe_address(address)}'" for address in self._endpoints)
        logger.warning("%s (tried %s)", last, tried)
        if len(self._endpoints) == 1:
            raise last
        raise SourceRepoAccessError(f"{last} (tried {tried})")

    def _addresses(self) -> List[Endpoint]:
        """The addresses worth trying: one that could not be reached at all earlier
        in this run is dropped, unless that would leave nothing to try at all."""
        reachable = [address for address in self._endpoints if address not in self._unreachable]
        return reachable or self._endpoints

    @staticmethod
    def _address_of(address: Endpoint) -> str:
        base_url, org = address
        return f"{base_url}/{org}"

    def _safe_address(self, address: Endpoint) -> str:
        """An address as it may appear in a message or a log line: credentials written
        into the address itself are replaced, the rest of it stays readable; git's own
        output is redacted separately by `_redact`."""
        return _CREDENTIALS_IN_URL.sub(r"\1***@", self._address_of(address))

    def _url(self, address: Endpoint, unit_name: str) -> str:
        return f"{self._address_of(address)}/{unit_name}.git"

    def _redact(self, text: str) -> str:
        return text.replace(self._password, "***") if self._password else text

    def _is_offline(self, stderr: str) -> bool:
        lowered = stderr.lower()
        return any(marker in lowered for marker in _OFFLINE_MARKERS)

    def _git(self, args: List[str], attempt: str, timeout: int) -> subprocess.CompletedProcess:
        """Runs one git command with the credentials passed by environment;
        every failure raises SourceRepoAuthError, SourceRepoOfflineError or
        SourceRepoAccessError (req 16)."""
        command = [
            "git",
            "-c", "http.sslVerify=false",
            "-c", "credential.helper=",
            "-c", f"credential.helper={_CREDENTIAL_HELPER}",
            *args,
        ]
        env = {
            **os.environ,
            "DSM_GIT_USER": self._user,
            "DSM_GIT_PASSWORD": self._password,
            "GIT_TERMINAL_PROMPT": "0",
        }
        try:
            result = subprocess.run(command, capture_output=True, text=True, timeout=timeout, env=env)
        except (subprocess.TimeoutExpired, OSError) as exc:
            raise SourceRepoOfflineError(f"Could not {attempt}: {self._redact(str(exc))}") from exc
        if result.returncode != 0:
            stderr = self._redact(result.stderr.strip())
            if "Authentication" in stderr or "401" in stderr or "403" in stderr:
                raise SourceRepoAuthError(f"Authentication failed, could not {attempt}: {stderr}")
            if self._is_offline(stderr):
                raise SourceRepoOfflineError(f"Could not {attempt}: {stderr}")
            raise SourceRepoAccessError(f"Could not {attempt}: {stderr}")
        return result

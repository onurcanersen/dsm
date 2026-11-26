"""Per-session data source connections (SRS DSM-DVE req 4, 7)."""

import pytest

from fakes import seed
from fakes.fake_config_management_repository import FakeConfigManagementRepository
from fakes.fake_source_code_repository import FakeSourceCodeRepository
from mdg import ConfigManagementAccessError, SourceRepoAuthError, SourceType
from dve.services.data_source_service import DataSourceService


def _service(error=None, repo_error=None) -> DataSourceService:
    return DataSourceService(
        seed.DEFAULTS,
        lambda source: FakeConfigManagementRepository(error=error),
        lambda source: FakeSourceCodeRepository(error=repo_error),
    )


def test_open_returns_a_known_token_and_makes_a_new_one_otherwise():
    data_sources = _service()

    token = data_sources.open(None)

    assert data_sources.open(token) == token
    assert data_sources.open("unknown") not in (token, "unknown")


def test_connect_keeps_the_defaults_name_and_method_with_the_sessions_credentials():
    data_sources = _service()
    token = data_sources.open()

    data_sources.connect(token, SourceType.SOURCE_CODE_REPO, seed.SOURCE_REPO_URL, seed.USER, seed.PASSWORD)

    source = data_sources.connected(token)[SourceType.SOURCE_CODE_REPO]
    assert (source.source_name, source.access_method) == ("gitea", "git")
    assert (source.connection_address, source.user_info) == (seed.SOURCE_REPO_URL, "dsm:dsm")
    assert source.fallback_connection_address == seed.FALLBACK_SOURCE_REPO_URL
    assert SourceType.CONFIG_MGMT_DB not in data_sources.connected(token)


def test_connect_keeps_the_configured_second_address_for_another_first_one():
    data_sources = _service()
    token = data_sources.open()

    data_sources.connect(token, SourceType.SOURCE_CODE_REPO, "http://elsewhere:3000/other", seed.USER, seed.PASSWORD)

    source = data_sources.connected(token)[SourceType.SOURCE_CODE_REPO]
    assert source.connection_address == "http://elsewhere:3000/other"
    assert source.fallback_connection_address == seed.FALLBACK_SOURCE_REPO_URL


def test_connect_prefers_the_second_address_the_session_names():
    data_sources = _service()
    token = data_sources.open()

    data_sources.connect(
        token, SourceType.SOURCE_CODE_REPO, seed.SOURCE_REPO_URL, seed.USER, seed.PASSWORD,
        f" {seed.OTHER_FALLBACK_SOURCE_REPO_URL} ",
    )

    source = data_sources.connected(token)[SourceType.SOURCE_CODE_REPO]
    assert source.fallback_connection_address == seed.OTHER_FALLBACK_SOURCE_REPO_URL


def test_an_empty_second_address_drops_the_configured_one():
    data_sources = _service()
    token = data_sources.open()

    data_sources.connect(token, SourceType.SOURCE_CODE_REPO, seed.SOURCE_REPO_URL, seed.USER, seed.PASSWORD, "")

    source = data_sources.connected(token)[SourceType.SOURCE_CODE_REPO]
    assert source.fallback_connection_address == ""


def test_config_mgmt_db_is_verified_when_connected():
    data_sources = _service(error=ConfigManagementAccessError("bad creds"))
    token = data_sources.open()

    with pytest.raises(ConfigManagementAccessError, match="bad creds"):
        data_sources.connect(token, SourceType.CONFIG_MGMT_DB, seed.CONFIG_DB_ADDRESS, seed.USER, "wrong")

    assert data_sources.connected(token) == {}


def test_source_code_repo_is_verified_when_connected():
    data_sources = _service(repo_error=SourceRepoAuthError("authentication failed"))
    token = data_sources.open()

    with pytest.raises(SourceRepoAuthError, match="authentication failed"):
        data_sources.connect(token, SourceType.SOURCE_CODE_REPO, seed.SOURCE_REPO_URL, seed.USER, "wrong")

    assert data_sources.connected(token) == {}


def test_close_forgets_the_session():
    data_sources = _service()
    token = data_sources.open()
    data_sources.connect(token, SourceType.SOURCE_CODE_REPO, seed.SOURCE_REPO_URL, seed.USER, seed.PASSWORD)

    data_sources.close(token)

    assert data_sources.connected(token) == {}
    assert data_sources.open(token) != token

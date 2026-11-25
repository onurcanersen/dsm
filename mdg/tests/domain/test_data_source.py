"""The user-definable connection information of a data source and its payload
(SRS DSM-MDG req 4)."""

from mdg.domain.data_source import DataSourceConfig, SourceType

PAYLOAD = {
    "source_type": SourceType.SOURCE_CODE_REPO.value,
    "source_name": "gitea",
    "access_method": "git",
    "connection_address": "http://localhost:3000/dsm-src",
    "user_info": "dsm:dsm",
}


def test_the_second_address_is_optional_in_a_payload():
    assert DataSourceConfig.from_dict(PAYLOAD).fallback_connection_address == ""


def test_a_source_survives_its_payload_with_the_second_address():
    source = DataSourceConfig.from_dict({**PAYLOAD, "fallback_connection_address": "http://backup:3000/dsm-mirror"})

    assert DataSourceConfig.from_dict(source.to_dict()) == source

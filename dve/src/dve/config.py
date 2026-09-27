"""Loads dve.ini: the data source addresses and the API settings
(SRS DSM-DVE req 4, 7)."""

from __future__ import annotations

import configparser
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import List

from mdg import DataSourceConfig, SourceType

DVE_INI = Path(__file__).resolve().parent / "dve.ini"


@dataclass(frozen=True)
class ApiConfig:
    """Where the API listens, how long a session cookie lives, in seconds, and
    the largest file an upload may carry, in megabytes."""
    host: str = "127.0.0.1"
    port: int = 8080
    secret_key: str = "dev-insecure-change-me"
    session_lifetime: int = 86400
    max_upload_mb: int = 50


@dataclass(frozen=True)
class Config:
    data_sources: List[DataSourceConfig] = field(default_factory=list)
    api: ApiConfig = field(default_factory=ApiConfig)


def load(path: Path = DVE_INI) -> Config:
    """The configuration in an ini file; a missing file or option yields its default."""
    ini = configparser.ConfigParser(interpolation=None)
    ini.read(path, encoding="utf-8")

    def text(section: str, option: str, default: str) -> str:
        return ini.get(section, option, fallback=default).strip() or default

    data_sources = [
        DataSourceConfig(
            source_type,
            text(source_type.value, "source_name", ""),
            text(source_type.value, "access_method", ""),
            text(source_type.value, "connection_address", ""),
            "",
        )
        for source_type in SourceType if ini.has_section(source_type.value)
    ]
    return Config(
        data_sources=data_sources,
        api=ApiConfig(
            host=text("api", "host", ApiConfig.host),
            port=ini.getint("api", "port", fallback=ApiConfig.port),
            secret_key=text("api", "secret_key", ApiConfig.secret_key),
            session_lifetime=ini.getint("api", "session_lifetime", fallback=ApiConfig.session_lifetime),
            max_upload_mb=ini.getint("api", "max_upload_mb", fallback=ApiConfig.max_upload_mb),
        ),
    )


@lru_cache
def config() -> Config:
    """The shipped dve.ini, loaded once."""
    return load()

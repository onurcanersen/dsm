"""DSM-MSD, Model Setup Data Generation (SRS DSM-MSD req 1): the library facade.

A run (`produce_model_setup_data`) acquires the project context and the
Software Unit Version Inventory from the configuration management database
(req 5-11), clones the system repo named in msd.ini and parses it (req 3,
13), clones the software units it names and records their files and errors
(req 13-16), regenerates and parses each unit's source data, parses type
support once, checks mandatory fields (req 17-18) and saves the Model Setup
Data file under the workspace (req 19).
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Optional

from msd.adapters.config_management.mysql_config_management_repository import MysqlConfigManagementRepository
from msd.adapters.model_setup_data.filesystem_model_setup_data_store import FilesystemModelSetupDataStore
from msd.adapters.source_code.git_source_code_repository import GitSourceCodeRepository
from msd.adapters.source_code.gmake_build_runner import GmakeBuildRunner
from msd.adapters.source_code.mandatory_files import MandatoryFiles
from msd.adapters.source_data.source_code_parser import SourceCodeParser
from msd.adapters.source_data.system_repo_parser import SystemRepoParser
from msd.adapters.source_data.type_support_parser import TypeSupportParser
from msd.config import Config, load
from msd.domain.acquired_file import AcquiredFile
from msd.domain.data_source import DataSourceConfig, SourceType
from msd.domain.error_record import DataAcquisitionError, ErrorRecord, ErrorStatus
from msd.domain.inventory import CandidateUnitVersion
from msd.domain.model_setup_data import ModelSetupDataRecord
from msd.domain.source_data import Topic, UnitRelation
from msd.domain.workspace import Workspace
from msd.ports.config_management_repository import ConfigManagementAccessError, IConfigManagementRepository
from msd.ports.model_setup_data_store import IModelSetupDataStore
from msd.ports.source_code_repository import (
    ISourceCodeRepository,
    SourceRepoAccessError,
    SourceRepoAuthError,
    SourceRepoIntegrityError,
)
from msd.services.acquire_project_context import AcquireProjectContext
from msd.services.acquire_source_code import AcquireSourceCode
from msd.services.build_software_unit_inventory import BuildSoftwareUnitInventory
from msd.services.check_mandatory_fields import CheckMandatoryFields, MandatoryFieldRule
from msd.services.produce_model_setup_data import ProduceModelSetupData, ProductionResult

__all__ = [
    "CandidateUnitVersion",
    "ConfigManagementAccessError",
    "DataAcquisitionError",
    "DataSourceConfig",
    "ErrorRecord",
    "ErrorStatus",
    "IConfigManagementRepository",
    "IModelSetupDataStore",
    "ISourceCodeRepository",
    "ModelSetupDataRecord",
    "ProductionResult",
    "SourceRepoAccessError",
    "SourceRepoAuthError",
    "SourceRepoIntegrityError",
    "SourceType",
    "config_management_repository",
    "model_setup_data_store",
    "produce_model_setup_data",
    "source_code_repository",
]

MANDATORY_FIELD_RULES = [
    MandatoryFieldRule("file_name", AcquiredFile),
    MandatoryFieldRule("target", UnitRelation),
    MandatoryFieldRule("name", Topic),
]


@lru_cache
def config() -> Config:
    """The msd.ini configuration."""
    return load()


def config_management_repository(source: DataSourceConfig) -> IConfigManagementRepository:
    """The configuration management database of a data source (req 2.1, 4)."""
    return MysqlConfigManagementRepository.from_data_source_config(source)


def source_code_repository(source: DataSourceConfig) -> ISourceCodeRepository:
    """The source code repository of a data source (req 2.2, 4)."""
    return GitSourceCodeRepository.from_data_source_config(source, _mandatory_files(), config().workspace.system_repo)


def model_setup_data_store(workspace: Optional[Path] = None) -> IModelSetupDataStore:
    """The store of the Model Setup Data files under the workspace (req 19; DSM-VAE req 5)."""
    return FilesystemModelSetupDataStore(_workspace(workspace))


def produce_model_setup_data(
    config_repo: IConfigManagementRepository,
    source_repo: ISourceCodeRepository,
    project_id: str,
    platform_id: str,
    version_id: str,
    run_id: str,
    produced_by: Optional[str] = None,
    candidate: Optional[CandidateUnitVersion] = None,
    progress=None,
    workspace: Optional[Path] = None,
) -> ProductionResult:
    """Runs the Model Setup Data production process for one selection in the
    run directory keyed by run_id (req 5-19). `progress` receives the percent
    done and the phase name after each work unit."""
    settings = config()
    files = _mandatory_files()
    return ProduceModelSetupData(
        config_repo=config_repo,
        acquire_context=AcquireProjectContext(config_repo),
        build_inventory=BuildSoftwareUnitInventory(config_repo),
        acquire_source_code=AcquireSourceCode(source_repo),
        system_repo_parser=SystemRepoParser,
        source_code_parser=SourceCodeParser(settings.source_parser, files),
        type_support_parser=TypeSupportParser,
        build_runner=GmakeBuildRunner(files),
        check_mandatory_fields=CheckMandatoryFields(MANDATORY_FIELD_RULES),
        store=model_setup_data_store(workspace),
        workspace=_workspace(workspace),
        system_repo_name=settings.workspace.system_repo,
        run_regenerate_code=settings.build.run_regenerate_code,
    ).execute(project_id, platform_id, version_id, run_id, produced_by, candidate, progress)


def _mandatory_files() -> MandatoryFiles:
    return MandatoryFiles(config().mandatory_files.makefile_include_patterns)


def _workspace(root: Optional[Path]) -> Workspace:
    return Workspace(root if root is not None else config().workspace.root())

"""DSM-DVE, Design Verification Engine (SRS DSM-DVE req 1-8,
50): the serving layer over mdg. `runtime()` wires the data source defaults
and per-session connections (req 4, 7), the LDAP directory service (req 3),
the production runner and log (req 6, 8) and the Model Setup Data store
(req 5) from dve.ini; `dve.api.create_app` serves them, productions run as
child processes of the API, and `python -m dve` (the dsm command) starts it.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Dict, Optional

import mdg
from mdg import DataSourceConfig, IConfigManagementRepository, IModelSetupDataStore, ISourceCodeRepository, SourceType

from dve.adapters.ldap_directory_service import LdapDirectoryService
from dve.adapters.in_memory_task_log import InMemoryTaskLog
from dve.config import DVE_INI, Config, config
from dve.ports.directory_service import IDirectoryService
from dve.ports.production_log import IProductionLog
from dve.ports.production_runner import IProductionRunner
from dve.services.data_source_connections import DataSourceConnections
from dve.services.task_runner import TaskRunner

__all__ = ["Config", "Runtime", "config", "runtime"]


@dataclass
class Runtime:
    """The wired process: data source defaults and connections, the mdg
    factories, and the adapters the API serves."""
    defaults: Dict[SourceType, DataSourceConfig]
    connections: DataSourceConnections
    config_repo_factory: Callable[[DataSourceConfig], IConfigManagementRepository]
    source_repo_factory: Callable[[DataSourceConfig], ISourceCodeRepository]
    directory_service: IDirectoryService
    production_runner: IProductionRunner
    production_log: IProductionLog
    model_setup_data_store: IModelSetupDataStore


def runtime(concurrency: Optional[int] = None) -> Runtime:
    """The runtime dve.ini describes, `concurrency` overriding the [worker] section
    when given; raises RuntimeError when a data source section is missing (req 4)."""
    from dve.adapters.multiprocessing_production_runner import MultiprocessingProductionRunner

    settings = config()
    defaults = {source.source_type: source for source in settings.data_sources}
    missing = sorted(s.value for s in set(SourceType) - defaults.keys())
    if missing:
        raise RuntimeError(f"missing data source(s) [{', '.join(missing)}] in {DVE_INI}")
    log = InMemoryTaskLog()
    tasks = TaskRunner(log, concurrency if concurrency is not None else settings.worker.concurrency)
    return Runtime(
        defaults=defaults,
        connections=DataSourceConnections(defaults, mdg.config_management_repository, mdg.source_code_repository),
        config_repo_factory=mdg.config_management_repository,
        source_repo_factory=mdg.source_code_repository,
        directory_service=LdapDirectoryService(),
        production_runner=MultiprocessingProductionRunner(tasks),
        production_log=log,
        model_setup_data_store=mdg.model_setup_data_store(),
    )

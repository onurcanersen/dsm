"""Multiprocessing adapter of the production runner port: each production is
a task of the TaskRunner, run by `run_production` in a child process
(SRS DSM-DVE req 6, 50)."""

from __future__ import annotations

from typing import Any, Callable, Dict, Optional

import mdg
from mdg import CandidateUnitVersion, DataSourceConfig, SourceType

from dve.domain.production_status import ProductionStatus
from dve.domain.selection import Selection
from dve.ports.production_runner import IProductionRunner
from dve.services.task_runner import TaskRunner, TaskStatus


def _data_sources(sources: dict) -> Dict[SourceType, DataSourceConfig]:
    return {SourceType(key): DataSourceConfig.from_dict(value) for key, value in sources.items()}


def run_production(
    run_id: str,
    selection: dict,
    sources: dict,
    produced_by: Optional[str],
    candidate: Optional[dict],
    progress: Callable[[int, str], None],
) -> dict:
    """One Model Setup Data production with the task's id as the run id;
    `sources` maps source type values to DataSourceConfig payloads and
    `candidate` is the optional {"unit_name", "version"} under evaluation (req 6)."""
    chosen = Selection.from_dict(selection)
    if chosen is None:
        raise ValueError(f"incomplete selection: {selection}")
    data_sources = _data_sources(sources)
    return mdg.produce_model_setup_data(
        mdg.config_management_repository(data_sources[SourceType.CONFIG_MGMT_DB]),
        mdg.source_code_repository(data_sources[SourceType.SOURCE_CODE_REPO]),
        chosen.project_id,
        chosen.platform_id,
        chosen.version_id,
        run_id=run_id,
        produced_by=produced_by,
        candidate=CandidateUnitVersion.from_dict(candidate),
        progress=progress,
    ).to_dict()


class MultiprocessingProductionRunner(IProductionRunner):
    """Submits `run_production` to the task runner and reports its task status."""

    def __init__(self, tasks: TaskRunner):
        self._tasks = tasks

    def start(
        self,
        selection: Selection,
        sources: Dict[SourceType, DataSourceConfig],
        produced_by: Optional[str] = None,
        candidate: Optional[dict] = None,
    ) -> str:
        payload = {source_type.value: source.to_dict() for source_type, source in sources.items()}
        return self._tasks.submit(run_production, selection.to_dict(), payload, produced_by, candidate)

    def status(self, run_id: str) -> ProductionStatus:
        return self._status(self._tasks.status(run_id))

    def cancel(self, run_id: str) -> ProductionStatus:
        return self._status(self._tasks.cancel(run_id))

    @staticmethod
    def _status(status: TaskStatus) -> ProductionStatus:
        return ProductionStatus(status.task_id, status.state, result=status.result, error=status.error, progress=status.progress)

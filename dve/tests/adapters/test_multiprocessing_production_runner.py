"""The production runner over a recording task runner, and its child-side
production with mdg mocked (SRS DSM-DVE req 6)."""

from unittest import mock

import pytest

from fakes import seed
from mdg import CandidateUnitVersion, SourceType
from dve.adapters import multiprocessing_production_runner as adapter
from dve.adapters.multiprocessing_production_runner import MultiprocessingProductionRunner, run_production
from dve.domain.production_status import ProductionStatus
from dve.domain.selection import Selection
from dve.services.task_runner import TaskStatus

SELECTION = Selection(seed.PROJECT, seed.PLATFORM, seed.VERSION)
SOURCES = {source_type.value: source.to_dict() for source_type, source in seed.DEFAULTS.items()}


class _Tasks:
    def __init__(self, status=None):
        self.submitted = None
        self.cancelled = None
        self._status = status or TaskStatus(seed.RUN_1, "PENDING")

    def submit(self, target, *args):
        self.submitted = (target, args)
        return seed.RUN_1

    def status(self, task_id):
        return self._status

    def cancel(self, task_id):
        self.cancelled = task_id
        return self._status


def test_start_submits_the_production_with_json_payloads():
    tasks = _Tasks()

    run_id = MultiprocessingProductionRunner(tasks).start(SELECTION, seed.DEFAULTS, produced_by=seed.OPERATOR, candidate=seed.CANDIDATE)

    assert run_id == seed.RUN_1
    assert tasks.submitted == (run_production, (seed.SELECTION, SOURCES, seed.OPERATOR, seed.CANDIDATE))


@pytest.mark.parametrize("status", [
    TaskStatus(seed.RUN_1, "PENDING"),
    TaskStatus(seed.RUN_1, "STARTED", progress={"percent": 42, "phase": "clone"}),
    TaskStatus(seed.RUN_1, "SUCCESS", result={"run_id": seed.RUN_1}),
    TaskStatus(seed.RUN_1, "FAILURE", error="boom"),
    TaskStatus(seed.RUN_1, "REVOKED"),
])
def test_status_and_cancel_map_every_task_status_field(status):
    tasks = _Tasks(status)
    expected = ProductionStatus(seed.RUN_1, status.state, result=status.result, error=status.error, progress=status.progress)

    assert MultiprocessingProductionRunner(tasks).status(seed.RUN_1) == expected
    assert MultiprocessingProductionRunner(tasks).cancel(seed.RUN_1) == expected
    assert tasks.cancelled == seed.RUN_1


def _produce(result=None):
    produce = mock.Mock()
    produce.return_value.to_dict.return_value = result if result is not None else {}
    return produce


def _run(produce, produced_by=None, candidate=None, selection=seed.SELECTION):
    progress = mock.Mock()
    with mock.patch.object(adapter.mdg, "produce_model_setup_data", produce), \
         mock.patch.object(adapter.mdg, "config_management_repository") as config_repo, \
         mock.patch.object(adapter.mdg, "source_code_repository") as source_repo:
        result = run_production(seed.RUN_1, selection, SOURCES, produced_by, candidate, progress)
    return result, config_repo, source_repo, progress


def test_production_rebuilds_the_sources_and_calls_mdg_with_the_run_id():
    produce = _produce({"run_id": "sentinel"})

    result, config_repo, source_repo, progress = _run(produce)

    assert result == {"run_id": "sentinel"}
    assert config_repo.call_args.args[0] == seed.DEFAULTS[SourceType.CONFIG_MGMT_DB]
    assert source_repo.call_args.args[0] == seed.DEFAULTS[SourceType.SOURCE_CODE_REPO]
    produce.assert_called_once_with(
        config_repo.return_value, source_repo.return_value, seed.PROJECT, seed.PLATFORM, seed.VERSION,
        run_id=seed.RUN_1, produced_by=None, candidate=None, progress=progress,
    )


def test_production_forwards_the_producer_and_converts_the_candidate():
    produce = _produce()

    _run(produce, produced_by=seed.OPERATOR, candidate=seed.CANDIDATE)

    assert produce.call_args.kwargs["produced_by"] == seed.OPERATOR
    assert produce.call_args.kwargs["candidate"] == CandidateUnitVersion(seed.SENSOR_APP, seed.CANDIDATE_VERSION)


def test_production_ignores_an_unusable_candidate():
    produce = _produce()

    _run(produce, produced_by=seed.OPERATOR, candidate={"unit_name": seed.SENSOR_APP})

    assert produce.call_args.kwargs["candidate"] is None


def test_production_refuses_an_incomplete_selection():
    with pytest.raises(ValueError, match="incomplete selection"):
        _run(_produce(), selection={"project_id": seed.PROJECT})

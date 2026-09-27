"""Synchronous task runner: submit() runs a callable in-process in place of
the target and records the outcome as the task's status (SRS DSM-DVE req 6)."""

from __future__ import annotations

import uuid
from typing import Any, Callable, Dict, List, Optional, Union

from dve.domain.task_status import TaskStatus
from dve.ports.task_runner import ITaskRunner


class FakeTaskRunner(ITaskRunner):
    """Records every submit as (target, args) and takes the outcome from
    `run(*args)`, never calling the target; `states` are statuses reported in
    order before the recorded outcome."""

    def __init__(self, run: Optional[Callable[..., dict]] = None, states: List[Union[str, TaskStatus]] = ()):
        self._run = run or (lambda selection, *rest: {"selection": selection})
        self._states = list(states)
        self._reported = 0
        self._tasks: Dict[str, TaskStatus] = {}
        self.submitted: List[tuple] = []

    def submit(self, target: Callable[..., Any], *args: Any) -> str:
        task_id = uuid.uuid4().hex
        self.submitted.append((target, args))
        try:
            result = self._run(*args)
        except Exception as exc:
            self._tasks[task_id] = TaskStatus(task_id, "FAILURE", error=str(exc) or repr(exc))
        else:
            self._tasks[task_id] = TaskStatus(task_id, "SUCCESS", result=result)
        return task_id

    def status(self, task_id: str) -> TaskStatus:
        known = self._tasks.get(task_id)
        if known is None:
            return TaskStatus(task_id, "PENDING")
        if self._reported < len(self._states):
            entry = self._states[self._reported]
            self._reported += 1
            if isinstance(entry, TaskStatus):
                return TaskStatus(task_id, entry.state, progress=entry.progress)
            return TaskStatus(task_id, entry)
        return known

    def cancel(self, task_id: str) -> TaskStatus:
        known = self._tasks.get(task_id)
        if known is not None and known.state in ("SUCCESS", "FAILURE"):
            return known
        self._tasks[task_id] = TaskStatus(task_id, "REVOKED")
        return self._tasks[task_id]

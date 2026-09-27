"""In-memory adapter of the task log port: one line list per task,
kept for the process lifetime (SRS DSM-DVE req 6, 8)."""

from __future__ import annotations

import threading
from typing import Dict, List

from dve.ports.task_log import ITaskLog


class InMemoryTaskLog(ITaskLog):
    """Appends and reads under a lock, since task threads write while request threads read."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._lines: Dict[str, List[str]] = {}

    def append(self, task_id: str, line: str) -> None:
        with self._lock:
            self._lines.setdefault(task_id, []).append(line)

    def lines_since(self, task_id: str, index: int) -> List[str]:
        with self._lock:
            return list(self._lines.get(task_id, ())[max(index, 0):])

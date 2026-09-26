"""In-memory adapter of the production log port: one line list per task,
kept for the process lifetime (SRS DSM-DVE req 6, 8)."""

from __future__ import annotations

import threading
from typing import Dict, List

from dve.ports.production_log import IProductionLog


class InMemoryTaskLog(IProductionLog):
    """Appends and reads under a lock, since task threads write while request threads read."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._lines: Dict[str, List[str]] = {}

    def append(self, run_id: str, line: str) -> None:
        with self._lock:
            self._lines.setdefault(run_id, []).append(line)

    def lines_since(self, run_id: str, index: int) -> List[str]:
        with self._lock:
            return list(self._lines.get(run_id, ())[max(index, 0):])

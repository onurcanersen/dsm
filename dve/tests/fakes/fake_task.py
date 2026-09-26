"""A task the TaskRunner tests spawn: a module-level target the child can
import without pytest, scripted by its `mode` argument."""

from __future__ import annotations

import logging
import os
import time


def scripted_task(task_id: str, mode: str, progress) -> dict:
    """succeed: logs a line and returns; fail: raises; crash: exits without
    reporting; sleep: reports progress and waits to be terminated."""
    if mode == "succeed":
        logging.getLogger("fakes.child").info("hello from child")
        return {"task_id": task_id}
    if mode == "fail":
        raise ValueError("boom")
    if mode == "crash":
        os._exit(3)
    if mode == "sleep":
        progress(42, "clone")
        while True:
            time.sleep(0.1)
    raise AssertionError(f"unknown mode {mode}")

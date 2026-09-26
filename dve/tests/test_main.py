"""The dsm command with the runtime and the server mocked (SRS DSM-DVE req 6)."""

import signal

import pytest

from dve import __main__ as dsm


@pytest.fixture
def world(monkeypatch):
    state = {"runtime": [], "served": [], "signals": {}}
    monkeypatch.setattr(dsm, "runtime", lambda concurrency=None: state["runtime"].append(concurrency) or "the-runtime")
    monkeypatch.setattr(dsm, "serve", lambda runtime: state["served"].append(runtime))
    monkeypatch.setattr(dsm.signal, "signal", lambda signum, handler: state["signals"].__setitem__(signum, handler))
    return state


def test_serves_the_api_over_the_runtime_with_the_default_concurrency(world):
    code = dsm.main([])

    assert world["runtime"] == [None]
    assert world["served"] == ["the-runtime"]
    assert code == 0


def test_concurrency_is_passed_to_the_runtime(world):
    dsm.main(["-c", "4"])

    assert world["runtime"] == [4]


def test_sigterm_ends_the_command_like_ctrl_c(world):
    dsm.main([])

    with pytest.raises(SystemExit):
        world["signals"][signal.SIGTERM](signal.SIGTERM, None)

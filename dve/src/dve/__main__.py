"""The dsm command: serves the API, whose child processes run the productions;
Ctrl+C or SIGTERM stops it and them (SRS DSM-DVE req 6).

Run with: dsm [-c N]  (or: python -m dve)
"""

from __future__ import annotations

import argparse
import signal
import sys
from typing import List, Optional

from dve import runtime
from dve.api import serve


def _exit(signum, frame) -> None:
    sys.exit(0)


def main(argv: Optional[List[str]] = None) -> int:
    """Serves the API with the given task concurrency; returns 0 once it stops."""
    parser = argparse.ArgumentParser(prog="dsm", description="Start the DSM API and its production runs.")
    parser.add_argument("-c", "--concurrency", type=int, default=None, metavar="N", help="concurrent productions (default: CPU count)")
    args = parser.parse_args(argv)

    signal.signal(signal.SIGTERM, _exit)
    serve(runtime(concurrency=args.concurrency))
    return 0


if __name__ == "__main__":
    sys.exit(main())

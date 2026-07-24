"""Import shim: expose the standalone ``scripts/`` modules to the packaged index code.

The machinery scripts (``bootstrap.py``, ``drift_detector.py``) import each other via a
``sys.path`` insert of their own directory — there is deliberately no ``scripts/__init__.py``
so the vendored copies stay runnable as ``python3 .../scripts/cataloger.py``. Importing this
module puts that directory onto ``sys.path`` so the packaged index layer reuses the exact same
registry / root / git helpers instead of duplicating them (DRY).

Usage in an index module::

    from service_knowledge.index import _compat  # noqa: F401  (must be first)
    import bootstrap  # type: ignore[import-not-found]
"""
from __future__ import annotations

import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"

if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

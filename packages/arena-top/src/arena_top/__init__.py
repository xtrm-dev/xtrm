"""arena-top: top models from Arena AI leaderboards via daily JSON snapshots."""
from .cli import main, CATEGORIES, fetch_leaderboard, render_table

__version__ = "0.1.0"
__all__ = ["main", "CATEGORIES", "fetch_leaderboard", "render_table"]

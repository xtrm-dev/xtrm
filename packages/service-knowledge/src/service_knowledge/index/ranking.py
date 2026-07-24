"""Operator-tunable ranking constants for the service-knowledge index.

Implements research §3.5: ``score = 0.40 T + 0.30 L + 0.15 I + 0.10 A + 0.05 F`` plus the
post-rank penalty lattice. Every weight, penalty magnitude and the freshness half-life live
here so an operator can retune retrieval without touching the ranking logic in ``query.py``.
"""
from __future__ import annotations

# --- primary score weights (must sum to 1.0) ---------------------------------
WEIGHT_TERRITORY = 0.40  # T: deterministic routing signal
WEIGHT_LEXICAL = 0.30    # L: BM25 percentile within the candidate set
WEIGHT_INTENT = 0.15     # I: exact literal/trigger/path/symbol/metric/alert overlap
WEIGHT_AUTHORITY = 0.10  # A: source authority x verification verdict
WEIGHT_FRESHNESS = 0.05  # F: commit-based decay since source_ref

# --- T (territory) discrete levels -------------------------------------------
T_PATH_OWNED = 1.0       # a query path falls inside the item's service territory
T_SERVICE_EXPLICIT = 0.7 # the bead/caller declared the item's service_id
T_TRIGGER = 0.3          # a registry trigger matched the query
T_NONE = 0.0

# --- A (authority) base scores by authority tier -----------------------------
AUTHORITY_CURATED = "curated"
AUTHORITY_AUTO = "auto"
AUTHORITY_UNVERIFIED = "unverified"
AUTHORITY_MEMORY = "memory"

# verified multiplier applied on top of the tier base score
AUTHORITY_BASE = {
    AUTHORITY_CURATED: 1.0,
    AUTHORITY_AUTO: 0.8,
    AUTHORITY_UNVERIFIED: 0.3,
    AUTHORITY_MEMORY: 0.2,
}
VERIFIED_MULTIPLIER = 1.0
UNVERIFIED_MULTIPLIER = 1.0  # base scores already encode the unverified tier

# --- F (freshness) -----------------------------------------------------------
# F = exp(-ln(2) * changed_commits / FRESHNESS_HALF_LIFE_COMMITS). 20 is an operational
# parameter (research §3.5), not a theoretical constant: after 20 territory commits since
# source_ref the freshness signal has halved.
FRESHNESS_HALF_LIFE_COMMITS = 20
FRESHNESS_ABSENT_REF = 0.25  # low score + stale advisory when no source_ref is available

# --- post-rank penalties (applied after the weighted sum) --------------------
PENALTY_STALE_HIGH_RISK = -0.25
PENALTY_INSUFFICIENT_EVIDENCE_HIGH_RISK = -0.15
PENALTY_UNVERIFIED_SOURCE = -0.10

# --- status values (provenance, research §3.6) -------------------------------
STATUS_ACTIVE = "active"
STATUS_STALE = "stale"
STATUS_STALE_PENDING = "stale_pending_verification"
STATUS_CONFLICTED = "conflicted"
STATUS_SUPERSEDED = "superseded"
STATUS_INVALIDATED = "invalidated"

# statuses the default retrieval surface admits (current view; history is explicit)
RETRIEVABLE_STATUSES = frozenset({STATUS_ACTIVE, STATUS_STALE, STATUS_STALE_PENDING})

RISK_HIGH = "high"

# --- evidence bundle shape (research §3.2) -----------------------------------
BUNDLE_MIN_ITEMS = 3
BUNDLE_MAX_ITEMS = 7
BUNDLE_MAX_TOKENS = 8000
# rough chars-per-token for the serialized-size guard (4 chars ~= 1 token)
CHARS_PER_TOKEN = 4


def weighted_score(territory: float, lexical: float, intent: float, authority: float, freshness: float) -> float:
    """The §3.5 weighted sum: 0.40 T + 0.30 L + 0.15 I + 0.10 A + 0.05 F (pure, interpretable)."""
    return (
        WEIGHT_TERRITORY * territory
        + WEIGHT_LEXICAL * lexical
        + WEIGHT_INTENT * intent
        + WEIGHT_AUTHORITY * authority
        + WEIGHT_FRESHNESS * freshness
    )


def weights_sum_to_one() -> bool:
    total = WEIGHT_TERRITORY + WEIGHT_LEXICAL + WEIGHT_INTENT + WEIGHT_AUTHORITY + WEIGHT_FRESHNESS
    return abs(total - 1.0) < 1e-9

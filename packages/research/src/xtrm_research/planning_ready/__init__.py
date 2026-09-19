"""Planning Ready-contract research workload (Jira XTRM-99 comments 13435/13438).

Turns the current Planning Ready contract into deterministic checks plus an
atomic System One battery composed by explicit code, and evaluates it against
the incumbent readiness state and observed outcomes on the current Substrate
board population.

Modules:
- ``contracts``: faithful mirror of Substrate's deterministic structural
  validator plus contract rendering and reference extraction.
- ``dataset``: read-only Substrate snapshot, revision-level units, the three
  separated label channels, natural revision-transition counterfactuals, the
  frozen split policy and the frozen dataset writer.
"""

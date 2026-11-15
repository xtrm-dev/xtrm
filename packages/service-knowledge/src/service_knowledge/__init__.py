"""service-knowledge — first-class operational service-knowledge package.

Elevated from the vendored ``service-skills`` machinery (previously shipped INTO
consumer repos via ``xt update --apply``) to a standalone package with its own CLI,
versioning, release cadence, and CHANGELOG. Install into a service-hosting repo with
``service-knowledge install``; it is not routed through ``xt update --apply``.
"""

__version__ = "0.9.0"

__all__ = ["__version__"]

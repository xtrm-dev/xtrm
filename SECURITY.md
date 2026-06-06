# Security Policy

## Reporting a vulnerability

**Do not open a public issue** for security vulnerabilities.

Report privately via:

- GitHub Security Advisory: https://github.com/xtrm-dev/xtrm/security/advisories/new
- Email: jagger.xtrm@gmail.com

Please include:

- Affected package / version / commit
- Steps to reproduce
- Impact assessment (data exposure, RCE, DoS, …)
- Proposed mitigation if you have one

We aim to acknowledge within 72 hours and ship a fix or mitigation as soon as a
reasonable backport path is identified.

## Supported versions

`xtrm` is at 0.1.0 (pre-1.0). Only the latest `main` is supported during this
phase; backports to previous tags are best-effort.

## Out of scope

- Findings in deprecated packages explicitly marked archived
- Issues requiring social engineering of maintainers
- Self-XSS without elevation
- DoS via abusive rate of requests against a development instance

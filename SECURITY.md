# Security Policy

## Reporting a vulnerability

Please report security issues **privately**. Do not open a public GitHub issue.

- Use GitHub's private vulnerability reporting ("Report a vulnerability" under
  the repository's **Security** tab), or
- email the maintainers at the address listed on the organisation profile.

Include reproduction steps and the affected version/commit. We aim to
acknowledge within 72 hours and to agree a disclosure timeline with you.

## Scope and expectations

Campus OS handles student data. When reporting or fixing issues, keep these
invariants in mind:

- **Tenant isolation** is enforced by Postgres Row-Level Security, not by
  application filters alone. A cross-tenant read is a critical bug.
- **Authorisation** is checked server-side on every request. A hidden UI element
  is never an access-control boundary.
- **No PII** in URLs, logs, or analytics.
- University email verification uses time-limited, single-use, hashed OTPs.

## Supported versions

The project is pre-1.0; only the `main` branch is supported. Once releases
begin, this section will list supported version ranges.

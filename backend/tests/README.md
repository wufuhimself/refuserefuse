# Backend tests

```bash
make test-install   # once — builds backend/.venv with requirements + pytest + httpx
make test           # or: npm test, or: cd backend && ./.venv/bin/python -m pytest
```

87 tests, ~1s. No network, no Docker, no running server: each test gets its own
in-memory SQLite database and drives the app through FastAPI's `TestClient`.

## Layout

| File | Tests | Covers |
|---|---|---|
| `test_auth.py` | 31 | Registration, login, password hashing, JWT validation, the authenticated-endpoint boundary |
| `test_oauth_linking.py` | 16 | The one-provider-per-email rule and every branch of `_find_or_create_oauth_user` |
| `test_reports.py` | 17 | Public reads, authenticated writes, per-row ownership, soft delete, photo upload |
| `test_location_privacy.py` | 23 | Consent provenance, server-side minimization, cross-user scoping, read clamping, deletion |

Two custom markers (24 and 18 tests), so the boundaries can be run on their own:

```bash
./.venv/bin/python -m pytest -m security   # authorization / data-scoping boundaries
./.venv/bin/python -m pytest -m privacy    # location-privacy guarantees
```

## How the app is made testable

`main.py` holds `engine` as a module global and uses `with Session(engine)` inside each
endpoint rather than injecting a session dependency. Python resolves that global at call
time, so `conftest.py` patches the name on both `database` and `main` and every endpoint
picks up the test database. **No application code was changed to add these tests.**

Env vars (`JWT_SECRET`, `GOOGLE_CLIENT_IDS`, `APPLE_AUDIENCES`, `STORAGE_LOCAL_DIR`) are
read at import time in `main.py`, so `conftest.py` sets them before importing it. Uploads
go to a temp directory, never the real `backend/uploads/`.

OAuth ID-token *verification* is stubbed. Real verification fetches Google's or Apple's
JWKS and checks an RS256 signature — that is the provider's code path, not this app's.
What the tests exercise is the account-linking logic downstream of a successfully
verified token, which is where this app's actual decisions live.

## Bugs this suite found, and fixed

Both were caught on the suite's first run, and both now have regression guards rather
than xfail markers:

1. **Email addresses leaked on the public reports feed.** `_resolve_user_label()`
   returned `display_name or email`, and `GET /reports` is public and unauthenticated —
   so any user who registered with email/password and no display name had their email
   address published to anonymous readers. Fixed by dropping the email fallback and
   returning `None`; both clients already render a placeholder for a null display name,
   so no client change was needed. Guarded by
   `test_reports.py::test_list_exposes_no_email_addresses`,
   `::test_cleaner_email_is_not_exposed_either`, and
   `::test_display_name_is_still_shown_when_the_user_has_one`.

2. **A non-numeric JWT subject crashed the auth dependency.** `get_current_user()` called
   `int(payload["sub"])` outside the `try/except JWTError`, so a validly-signed token
   carrying a non-numeric subject raised `ValueError` and returned 500 from every
   authenticated endpoint instead of 401. Fixed with its own guard around the conversion.
   Guarded by `test_auth.py::test_token_with_non_numeric_subject_is_rejected_not_crashed`,
   parametrized over five malformed subjects.

The only other place a user's email reaches a response is `GET /auth/me`, which is
authenticated and returns the caller's own record — intended, and covered.

## Not covered

Report creation has **no input validation to test** — `severity` accepts any string,
`lat`/`lng` accept any float including out-of-range coordinates, and `notes` has no
length limit. Tests were not written to pin that behavior, because it is a gap to close
rather than a contract to protect. Nothing here covers the web or mobile clients.

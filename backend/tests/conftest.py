"""
Shared test fixtures for the RefuseRefuse backend.

Two things have to happen before `main` is imported, because `main` reads both at
module scope and never re-reads them:

  1. Env vars (JWT secret, OAuth audiences, upload dir) must already be set.
  2. `sys.path` must contain `backend/`, since main.py uses flat imports
     (`from database import ...`, not `from backend.database import ...`).

Each test then gets a fresh in-memory SQLite database, injected by patching the
module-level `engine` in both `database` and `main`. The endpoints resolve `engine`
as a module global at call time, so patching the name is enough — no app changes
were needed to make this testable.
"""

import os
import sys
import tempfile
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

# --- Env, before importing the app -------------------------------------------------
os.environ["JWT_SECRET"] = "test-secret-definitely-not-the-dev-default"
os.environ["GOOGLE_CLIENT_IDS"] = "test-google-client-id.apps.googleusercontent.com"
os.environ["APPLE_AUDIENCES"] = "com.refuserefuse.mobile"
os.environ["STORAGE_BACKEND"] = "local"
# Keep uploads out of the repo's real backend/uploads/ directory.
os.environ["STORAGE_LOCAL_DIR"] = tempfile.mkdtemp(prefix="refuserefuse-test-uploads-")

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402
from sqlmodel import SQLModel, create_engine  # noqa: E402

import database  # noqa: E402
import main  # noqa: E402


@pytest.fixture(name="engine")
def engine_fixture(monkeypatch):
    """A fresh, isolated in-memory database per test.

    StaticPool keeps every connection pointed at the same in-memory database —
    without it each new connection would get its own empty one.
    """
    test_engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(test_engine)

    monkeypatch.setattr(database, "engine", test_engine)
    monkeypatch.setattr(main, "engine", test_engine)

    yield test_engine

    test_engine.dispose()


@pytest.fixture(name="client")
def client_fixture(engine):
    """TestClient with the lifespan run, so init_db()'s schema-compatibility shim
    executes against the test database the same way it would in production."""
    with TestClient(main.app) as test_client:
        yield test_client


def bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


class TestUser:
    """A registered user plus the things tests need to act as them."""

    def __init__(self, client, email, password, token):
        self.client = client
        self.email = email
        self.password = password
        self.token = token
        self.headers = bearer(token)
        me = client.get("/auth/me", headers=self.headers)
        assert me.status_code == 200, me.text
        self.id = me.json()["id"]
        self.display_name = me.json()["display_name"]


@pytest.fixture(name="make_user")
def make_user_fixture(client):
    """Register a password user and return a TestUser handle."""
    counter = {"n": 0}

    def _make(email=None, password="password123", display_name=None):
        counter["n"] += 1
        email = email or f"user{counter['n']}@example.com"
        payload = {"email": email, "password": password}
        if display_name is not None:
            payload["display_name"] = display_name
        response = client.post("/auth/register", json=payload)
        assert response.status_code == 200, response.text
        return TestUser(client, email, password, response.json()["access_token"])

    return _make


@pytest.fixture(name="alice")
def alice_fixture(make_user):
    return make_user(email="alice@example.com", display_name="Alice")


@pytest.fixture(name="bob")
def bob_fixture(make_user):
    return make_user(email="bob@example.com", display_name="Bob")


@pytest.fixture(name="fake_google")
def fake_google_fixture(monkeypatch):
    """Replace Google ID-token verification with a stub.

    Real verification fetches Google's JWKS over the network and checks an RS256
    signature; that is Google's code path, not this app's. What these tests care
    about is the account-linking logic downstream of a *successfully verified*
    token, so the stub returns claims keyed by the fake token string.
    """
    tokens = {}

    def _register(token, *, sub, email=None, name=None, email_verified=True):
        claims = {"sub": sub, "email_verified": email_verified}
        if email is not None:
            claims["email"] = email
        if name is not None:
            claims["name"] = name
        tokens[token] = claims
        return token

    def _fake_verify(id_token):
        # Mirror the real function's contract: reject anything it wouldn't return.
        claims = tokens.get(id_token)
        if claims is None:
            from fastapi import HTTPException

            raise HTTPException(status_code=401, detail="Invalid Google token")
        return claims

    monkeypatch.setattr(main, "_verify_google_id_token", _fake_verify)
    return _register


@pytest.fixture(name="fake_apple")
def fake_apple_fixture(monkeypatch):
    """Same idea as fake_google. Apple tokens often carry no email at all, which
    is exactly the branch worth testing."""
    tokens = {}

    def _register(token, *, sub, email=None):
        claims = {"sub": sub}
        if email is not None:
            claims["email"] = email
        tokens[token] = claims
        return token

    def _fake_verify(id_token):
        claims = tokens.get(id_token)
        if claims is None:
            from fastapi import HTTPException

            raise HTTPException(status_code=401, detail="Invalid Apple token")
        return claims

    monkeypatch.setattr(main, "_verify_apple_id_token", _fake_verify)
    return _register

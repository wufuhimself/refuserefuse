"""Password auth, JWT handling, and the auth boundary on protected endpoints."""

import pytest
from jose import jwt
from sqlmodel import Session, select

import main
from conftest import bearer
from models import User


# --- Registration ------------------------------------------------------------------

def test_register_returns_usable_token(client):
    response = client.post(
        "/auth/register",
        json={"email": "new@example.com", "password": "password123", "display_name": "New"},
    )
    assert response.status_code == 200
    token = response.json()["access_token"]
    assert response.json()["token_type"] == "bearer"

    me = client.get("/auth/me", headers=bearer(token))
    assert me.status_code == 200
    assert me.json()["email"] == "new@example.com"
    assert me.json()["display_name"] == "New"


def test_register_rejects_short_password(client):
    response = client.post(
        "/auth/register", json={"email": "short@example.com", "password": "12345"}
    )
    assert response.status_code == 400
    assert "at least 6" in response.json()["detail"]


def test_register_rejects_duplicate_email(client, alice):
    response = client.post(
        "/auth/register", json={"email": alice.email, "password": "differentpassword"}
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Email already registered"


def test_register_rejects_malformed_email(client):
    response = client.post(
        "/auth/register", json={"email": "not-an-email", "password": "password123"}
    )
    assert response.status_code == 422


def test_password_is_hashed_not_stored_plaintext(client, engine, alice):
    with Session(engine) as session:
        stored = session.exec(select(User).where(User.email == alice.email)).first()

    assert stored is not None
    assert stored.password_hash != alice.password
    assert alice.password not in stored.password_hash
    assert stored.password_hash.startswith("$pbkdf2-sha256$")


# --- Login -------------------------------------------------------------------------

def test_login_with_correct_password(client, alice):
    response = client.post(
        "/auth/login", json={"email": alice.email, "password": alice.password}
    )
    assert response.status_code == 200
    me = client.get("/auth/me", headers=bearer(response.json()["access_token"]))
    assert me.json()["email"] == alice.email


def test_login_with_wrong_password_is_rejected(client, alice):
    response = client.post(
        "/auth/login", json={"email": alice.email, "password": "wrongpassword"}
    )
    assert response.status_code == 401


def test_login_for_unknown_email_is_rejected(client):
    response = client.post(
        "/auth/login", json={"email": "nobody@example.com", "password": "password123"}
    )
    assert response.status_code == 401


def test_login_error_does_not_reveal_whether_email_exists(client, alice):
    """Wrong password and unknown account must be indistinguishable, or the endpoint
    becomes an account-enumeration oracle."""
    wrong_password = client.post(
        "/auth/login", json={"email": alice.email, "password": "wrongpassword"}
    )
    unknown_email = client.post(
        "/auth/login", json={"email": "nobody@example.com", "password": "password123"}
    )
    assert wrong_password.status_code == unknown_email.status_code
    assert wrong_password.json()["detail"] == unknown_email.json()["detail"]


# --- Token handling ----------------------------------------------------------------

def test_token_subject_is_the_user_id(client, alice):
    claims = jwt.decode(alice.token, main.JWT_SECRET, algorithms=[main.JWT_ALGORITHM])
    assert claims["sub"] == str(alice.id)
    assert "exp" in claims


def test_garbage_token_is_rejected(client):
    response = client.get("/auth/me", headers=bearer("not-a-jwt"))
    assert response.status_code == 401


def test_token_signed_with_wrong_secret_is_rejected(client, alice):
    forged = jwt.encode({"sub": str(alice.id)}, "the-wrong-secret", algorithm="HS256")
    response = client.get("/auth/me", headers=bearer(forged))
    assert response.status_code == 401


def test_expired_token_is_rejected(client, alice):
    from datetime import datetime, timedelta, timezone

    expired = jwt.encode(
        {"sub": str(alice.id), "exp": datetime.now(timezone.utc) - timedelta(hours=1)},
        main.JWT_SECRET,
        algorithm=main.JWT_ALGORITHM,
    )
    response = client.get("/auth/me", headers=bearer(expired))
    assert response.status_code == 401


def test_token_for_deleted_user_is_rejected(client, engine, alice):
    with Session(engine) as session:
        session.delete(session.get(User, alice.id))
        session.commit()

    response = client.get("/auth/me", headers=alice.headers)
    assert response.status_code == 401


def test_token_without_subject_is_rejected(client):
    tokenless_sub = jwt.encode({"foo": "bar"}, main.JWT_SECRET, algorithm=main.JWT_ALGORITHM)
    response = client.get("/auth/me", headers=bearer(tokenless_sub))
    assert response.status_code == 401


@pytest.mark.parametrize("subject", ["not-an-integer", "", "1.5", "0x10", " 1 ; drop"])
def test_token_with_non_numeric_subject_is_rejected_not_crashed(client, subject):
    """Regression guard. int(payload['sub']) used to sit outside the JWTError handler, so
    a validly-signed token with a non-numeric subject raised ValueError and surfaced as a
    500 from every authenticated endpoint instead of a 401."""
    weird = jwt.encode({"sub": subject}, main.JWT_SECRET, algorithm=main.JWT_ALGORITHM)
    response = client.get("/auth/me", headers=bearer(weird))
    assert response.status_code == 401


# --- The auth boundary -------------------------------------------------------------

@pytest.mark.security
@pytest.mark.parametrize(
    "method,path",
    [
        ("get", "/auth/me"),
        ("post", "/reports"),
        ("patch", "/reports/1"),
        ("patch", "/reports/1/photo"),
        ("delete", "/reports/1"),
        ("post", "/location/sessions/start"),
        ("post", "/location/sessions/1/points"),
        ("post", "/location/sessions/1/stop"),
        ("get", "/location/history"),
        ("delete", "/location/history"),
    ],
)
def test_protected_endpoints_reject_anonymous_requests(client, method, path):
    """Every write, plus every location endpoint, requires a token.

    Pinned at 401 (not 403): older FastAPI versions had HTTPBearer answer a missing
    Authorization header with 403, which is the wrong code for "unauthenticated". The
    version in requirements.txt returns 401. If a dependency bump ever regresses that,
    both clients' "log in and retry" flows key off 401 and would silently stop working.
    """
    response = getattr(client, method)(path)
    assert response.status_code == 401


@pytest.mark.security
def test_reports_list_is_public(client):
    """The map has to be useful to a visitor with no account."""
    assert client.get("/reports").status_code == 200

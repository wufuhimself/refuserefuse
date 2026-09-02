"""The OAuth account-linking rules.

These encode the deliberate, documented decision that an email belongs to exactly one
provider. Auto-linking on a matching email is friendlier, but it treats the provider's
email claim as an identity assertion, which is the classic account-takeover vector for
this pattern. The strict branch is the one the app chose; these tests are what stop it
being relaxed by accident.
"""

import pytest
from sqlmodel import Session, select

from conftest import bearer
from models import User


def _me(client, response):
    return client.get("/auth/me", headers=bearer(response.json()["access_token"])).json()


# --- Creating and re-using OAuth accounts ------------------------------------------

def test_google_signin_creates_an_account(client, fake_google):
    fake_google("tok-1", sub="google-sub-1", email="g@example.com", name="Gina")

    response = client.post("/auth/oauth/google", json={"id_token": "tok-1"})
    assert response.status_code == 200

    user = _me(client, response)
    assert user["email"] == "g@example.com"
    assert user["display_name"] == "Gina"


def test_repeat_google_signin_returns_the_same_account(client, fake_google):
    fake_google("tok-1", sub="google-sub-1", email="g@example.com")

    first = _me(client, client.post("/auth/oauth/google", json={"id_token": "tok-1"}))
    second = _me(client, client.post("/auth/oauth/google", json={"id_token": "tok-1"}))

    assert first["id"] == second["id"]


def test_same_subject_is_matched_even_if_the_email_changed(client, fake_google):
    """Provider subject is the stable identity; email is not."""
    fake_google("tok-old", sub="google-sub-1", email="old@example.com")
    fake_google("tok-new", sub="google-sub-1", email="new@example.com")

    first = _me(client, client.post("/auth/oauth/google", json={"id_token": "tok-old"}))
    second = _me(client, client.post("/auth/oauth/google", json={"id_token": "tok-new"}))

    assert first["id"] == second["id"]


def test_display_name_is_updated_on_later_signin(client, fake_google):
    fake_google("tok-1", sub="google-sub-1", email="g@example.com", name="Old Name")
    client.post("/auth/oauth/google", json={"id_token": "tok-1"})

    fake_google("tok-1", sub="google-sub-1", email="g@example.com", name="New Name")
    user = _me(client, client.post("/auth/oauth/google", json={"id_token": "tok-1"}))

    assert user["display_name"] == "New Name"


# --- The 409 rule ------------------------------------------------------------------

@pytest.mark.security
def test_apple_cannot_claim_an_email_already_linked_to_google(client, fake_google, fake_apple):
    fake_google("g-tok", sub="google-sub-1", email="shared@example.com")
    fake_apple("a-tok", sub="apple-sub-1", email="shared@example.com")

    assert client.post("/auth/oauth/google", json={"id_token": "g-tok"}).status_code == 200

    conflict = client.post("/auth/oauth/apple", json={"id_token": "a-tok"})
    assert conflict.status_code == 409
    assert "already linked to google" in conflict.json()["detail"]


@pytest.mark.security
def test_google_cannot_claim_an_email_already_linked_to_apple(client, fake_google, fake_apple):
    """The rule holds in both directions, not just the one that was built first."""
    fake_apple("a-tok", sub="apple-sub-1", email="shared@example.com")
    fake_google("g-tok", sub="google-sub-1", email="shared@example.com")

    assert client.post("/auth/oauth/apple", json={"id_token": "a-tok"}).status_code == 200

    conflict = client.post("/auth/oauth/google", json={"id_token": "g-tok"})
    assert conflict.status_code == 409
    assert "already linked to apple" in conflict.json()["detail"]


@pytest.mark.security
def test_conflict_does_not_reassign_the_existing_account(client, engine, fake_google, fake_apple):
    """A rejected link must leave the original account's provider untouched."""
    fake_google("g-tok", sub="google-sub-1", email="shared@example.com")
    fake_apple("a-tok", sub="apple-sub-1", email="shared@example.com")

    client.post("/auth/oauth/google", json={"id_token": "g-tok"})
    client.post("/auth/oauth/apple", json={"id_token": "a-tok"})

    with Session(engine) as session:
        users = session.exec(select(User).where(User.email == "shared@example.com")).all()

    assert len(users) == 1
    assert users[0].auth_provider == "google"
    assert users[0].auth_subject == "google-sub-1"


def test_different_emails_on_different_providers_are_fine(client, fake_google, fake_apple):
    """The rule is per-email, not per-person — separate emails must still work."""
    fake_google("g-tok", sub="google-sub-1", email="me@gmail.com")
    fake_apple("a-tok", sub="apple-sub-1", email="me@icloud.com")

    google_user = _me(client, client.post("/auth/oauth/google", json={"id_token": "g-tok"}))
    apple_user = _me(client, client.post("/auth/oauth/apple", json={"id_token": "a-tok"}))

    assert google_user["id"] != apple_user["id"]


# --- Claiming a pre-existing password account --------------------------------------

def test_first_provider_links_to_an_unclaimed_password_account(client, engine, alice, fake_google):
    """Rule 3: an email that exists with no provider gets linked by the first one to arrive."""
    fake_google("g-tok", sub="google-sub-1", email=alice.email)

    user = _me(client, client.post("/auth/oauth/google", json={"id_token": "g-tok"}))
    assert user["id"] == alice.id

    with Session(engine) as session:
        stored = session.get(User, alice.id)
    assert stored.auth_provider == "google"
    assert stored.auth_subject == "google-sub-1"


@pytest.mark.security
def test_second_provider_is_locked_out_after_the_first_claims_the_account(
    client, alice, fake_google, fake_apple
):
    fake_google("g-tok", sub="google-sub-1", email=alice.email)
    fake_apple("a-tok", sub="apple-sub-1", email=alice.email)

    client.post("/auth/oauth/google", json={"id_token": "g-tok"})
    assert client.post("/auth/oauth/apple", json={"id_token": "a-tok"}).status_code == 409


def test_linking_preserves_an_existing_display_name(client, alice, fake_google):
    """display_name is only filled in when absent — the provider must not overwrite
    a name the user already chose."""
    fake_google("g-tok", sub="google-sub-1", email=alice.email, name="Google Display Name")

    user = _me(client, client.post("/auth/oauth/google", json={"id_token": "g-tok"}))
    assert user["display_name"] == "Alice"


# --- Tokens with no email ----------------------------------------------------------

def test_apple_token_without_email_gets_a_synthetic_address(client, fake_apple):
    """Apple lets users hide their email; the account still needs a stable unique key."""
    fake_apple("a-tok", sub="apple-sub-1")

    user = _me(client, client.post("/auth/oauth/apple", json={"id_token": "a-tok"}))
    assert user["email"] == "apple-apple-sub-1@noemail.refuserefuse.local"


def test_two_emailless_apple_users_get_distinct_accounts(client, fake_apple):
    fake_apple("a-tok-1", sub="apple-sub-1")
    fake_apple("a-tok-2", sub="apple-sub-2")

    first = _me(client, client.post("/auth/oauth/apple", json={"id_token": "a-tok-1"}))
    second = _me(client, client.post("/auth/oauth/apple", json={"id_token": "a-tok-2"}))

    assert first["id"] != second["id"]


def test_emailless_apple_user_is_recognised_on_return(client, fake_apple):
    fake_apple("a-tok", sub="apple-sub-1")

    first = _me(client, client.post("/auth/oauth/apple", json={"id_token": "a-tok"}))
    second = _me(client, client.post("/auth/oauth/apple", json={"id_token": "a-tok"}))

    assert first["id"] == second["id"]


# --- Verification failures ---------------------------------------------------------

def test_unverifiable_google_token_is_rejected(client, fake_google):
    response = client.post("/auth/oauth/google", json={"id_token": "never-registered"})
    assert response.status_code == 401


def test_oauth_endpoints_500_when_the_provider_is_not_configured(client, monkeypatch):
    """Real verification refuses to run without configured audiences, rather than
    silently accepting anything. Worth pinning: the failure mode of a missing env var
    must not be 'accepts all tokens'."""
    import main

    monkeypatch.setattr(main, "GOOGLE_CLIENT_IDS", [])
    response = client.post("/auth/oauth/google", json={"id_token": "anything"})
    assert response.status_code == 500
    assert "not configured" in response.json()["detail"]

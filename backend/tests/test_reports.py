"""Report CRUD: public reads, authenticated writes, per-row ownership, soft delete."""

import pytest
from sqlmodel import Session

from models import Report


def create_report(client, user, **overrides):
    form = {"lat": "39.95", "lng": "-75.15", "severity": "light", "picked_up": "false"}
    form.update({k: str(v) for k, v in overrides.items()})
    response = client.post("/reports", data=form, headers=user.headers)
    assert response.status_code == 200, response.text
    return response.json()


# --- Creating ----------------------------------------------------------------------

def test_create_report_attributes_it_to_the_token_holder(client, alice):
    report = create_report(client, alice, severity="trashy", notes="behind the bins")

    assert report["user_id"] == str(alice.id)
    assert report["reporter_display_name"] == "Alice"
    assert report["severity"] == "trashy"
    assert report["notes"] == "behind the bins"
    assert report["picked_up"] is False
    assert report["picked_up_at"] is None


@pytest.mark.security
def test_reporter_identity_comes_from_the_token_not_the_form(client, alice, bob):
    """A client must not be able to file a report as someone else."""
    response = client.post(
        "/reports",
        data={"lat": "39.95", "lng": "-75.15", "severity": "light", "user_id": str(bob.id)},
        headers=alice.headers,
    )
    assert response.status_code == 200
    assert response.json()["user_id"] == str(alice.id)


def test_report_created_as_already_cleaned_records_the_cleaner(client, alice):
    """Reporting a spot you just cleaned yourself is a real flow in both clients."""
    report = create_report(client, alice, picked_up="true")

    assert report["picked_up"] is True
    assert report["picked_up_by_user_id"] == str(alice.id)
    assert report["picked_up_at"] is not None


def test_incident_reports_round_trip_their_marker(client, alice):
    """Incident kind is encoded in the notes body rather than a column. Pinning this
    because both clients parse the marker back out — if the API ever normalises or
    trims notes, incident filtering breaks silently on web and mobile."""
    notes = "[ENVIRONMENTAL INCIDENT]\nType: Illegal dumping\nImmediate hazard: yes"
    report = create_report(client, alice, notes=notes, severity="trashy")

    assert report["notes"] == notes
    assert client.get("/reports").json()[0]["notes"] == notes


# --- Listing -----------------------------------------------------------------------

def test_list_is_public_and_newest_first(client, alice):
    first = create_report(client, alice, notes="first")
    second = create_report(client, alice, notes="second")

    listed = client.get("/reports").json()
    assert [r["id"] for r in listed] == [second["id"], first["id"]]


@pytest.mark.security
def test_list_exposes_no_email_addresses(client, alice):
    """Regression guard. GET /reports is public and unauthenticated, and the display-name
    resolver used to fall back to the user's email — publishing the address of anyone who
    registered without a display name. It must resolve to null instead."""
    nameless = client.post(
        "/auth/register", json={"email": "nameless@example.com", "password": "password123"}
    ).json()
    headers = {"Authorization": f"Bearer {nameless['access_token']}"}
    client.post(
        "/reports",
        data={"lat": "39.9", "lng": "-75.1", "severity": "light"},
        headers=headers,
    )

    listed = client.get("/reports")
    assert "nameless@example.com" not in listed.text
    assert listed.json()[0]["reporter_display_name"] is None
    assert listed.json()[0]["user_id"] is not None, "attribution still works, just not by email"


@pytest.mark.security
def test_cleaner_email_is_not_exposed_either(client, alice):
    """The same resolver fills picked_up_by_display_name, so it needs the same guard."""
    nameless = client.post(
        "/auth/register", json={"email": "cleaner@example.com", "password": "password123"}
    ).json()
    headers = {"Authorization": f"Bearer {nameless['access_token']}"}
    report = create_report(client, alice)
    client.patch(f"/reports/{report['id']}", data={"picked_up": "true"}, headers=headers)

    listed = client.get("/reports")
    assert "cleaner@example.com" not in listed.text
    assert listed.json()[0]["picked_up_by_display_name"] is None


def test_display_name_is_still_shown_when_the_user_has_one(client, alice):
    """The fix must not have flattened everyone to null."""
    create_report(client, alice)
    assert client.get("/reports").json()[0]["reporter_display_name"] == "Alice"


# --- Marking cleaned ---------------------------------------------------------------

def test_marking_cleaned_records_who_and_when(client, alice, bob):
    """Reporter and cleaner are deliberately separate identities on the row."""
    report = create_report(client, alice)

    response = client.patch(
        f"/reports/{report['id']}", data={"picked_up": "true"}, headers=bob.headers
    )
    assert response.status_code == 200

    updated = response.json()
    assert updated["user_id"] == str(alice.id)
    assert updated["picked_up_by_user_id"] == str(bob.id)
    assert updated["picked_up_by_display_name"] == "Bob"
    assert updated["picked_up_at"] is not None


def test_unmarking_cleaned_clears_the_cleanup_attribution(client, alice):
    report = create_report(client, alice)
    client.patch(f"/reports/{report['id']}", data={"picked_up": "true"}, headers=alice.headers)

    response = client.patch(
        f"/reports/{report['id']}", data={"picked_up": "false"}, headers=alice.headers
    )
    assert response.json()["picked_up_by_user_id"] is None
    assert response.json()["picked_up_at"] is None


def test_marking_a_missing_report_is_404(client, alice):
    response = client.patch("/reports/9999", data={"picked_up": "true"}, headers=alice.headers)
    assert response.status_code == 404


# --- Ownership ---------------------------------------------------------------------

@pytest.mark.security
def test_only_the_reporter_can_delete(client, alice, bob):
    report = create_report(client, alice)

    assert client.delete(f"/reports/{report['id']}", headers=bob.headers).status_code == 403
    assert client.delete(f"/reports/{report['id']}", headers=alice.headers).status_code == 200


@pytest.mark.security
def test_only_the_reporter_can_attach_a_photo(client, alice, bob):
    report = create_report(client, alice)
    photo = {"file": ("x.jpg", b"fake-jpeg-bytes", "image/jpeg")}

    forbidden = client.patch(
        f"/reports/{report['id']}/photo", files=photo, headers=bob.headers
    )
    assert forbidden.status_code == 403

    allowed = client.patch(
        f"/reports/{report['id']}/photo", files=photo, headers=alice.headers
    )
    assert allowed.status_code == 200


# --- Soft delete -------------------------------------------------------------------

def test_delete_is_soft_and_hides_the_report(client, engine, alice):
    report = create_report(client, alice)

    response = client.delete(f"/reports/{report['id']}", headers=alice.headers)
    assert response.json() == {"ok": True, "soft_deleted": True}

    assert client.get("/reports").json() == []

    with Session(engine) as session:
        row = session.get(Report, report["id"])
    assert row is not None, "delete must not destroy the row"
    assert row.deleted_at is not None


def test_soft_deleted_reports_cannot_be_modified(client, alice):
    report = create_report(client, alice)
    client.delete(f"/reports/{report['id']}", headers=alice.headers)

    assert (
        client.patch(
            f"/reports/{report['id']}", data={"picked_up": "true"}, headers=alice.headers
        ).status_code
        == 404
    )
    assert (
        client.delete(f"/reports/{report['id']}", headers=alice.headers).status_code == 404
    )


# --- Photo upload ------------------------------------------------------------------

def test_photo_upload_stores_a_file_and_returns_its_path(client, alice):
    response = client.post(
        "/reports",
        data={"lat": "39.95", "lng": "-75.15", "severity": "light"},
        files={"file": ("trash.jpg", b"fake-jpeg-bytes", "image/jpeg")},
        headers=alice.headers,
    )
    assert response.status_code == 200

    photo_path = response.json()["photo_path"]
    assert photo_path.startswith("/uploads/")
    assert photo_path.endswith(".jpg")


def test_uploaded_filenames_are_randomised(client, alice):
    """Uploads are served as static files; keeping the caller's filename would let a
    client choose the path and collide with (or overwrite) another user's photo."""
    photo = {"file": ("same-name.jpg", b"bytes", "image/jpeg")}

    first = client.post(
        "/reports", data={"lat": "1", "lng": "1"}, files=photo, headers=alice.headers
    ).json()["photo_path"]
    second = client.post(
        "/reports", data={"lat": "1", "lng": "1"}, files=photo, headers=alice.headers
    ).json()["photo_path"]

    assert first != second
    assert "same-name" not in first

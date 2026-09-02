"""Location history: consent provenance, server-side minimization, scoping, deletion.

This is the subsystem the project documentation leans on hardest, so it gets the most
coverage. The organising principle under test is that the client's filtering is a
bandwidth optimisation and the server's filtering is the actual control — every
assertion here goes through the API, never through a client-side helper.
"""

from datetime import datetime, timedelta, timezone

import pytest
from sqlmodel import Session, select

from models import LocationPoint, LocationSession

CONSENT_VERSION = "2026-04-location-history-v1"


def start_session(client, user, consent_version=CONSENT_VERSION):
    response = client.post(
        "/location/sessions/start",
        json={"consent_version": consent_version},
        headers=user.headers,
    )
    assert response.status_code == 200, response.text
    return response.json()


def send_points(client, user, session_id, points):
    return client.post(
        f"/location/sessions/{session_id}/points",
        json={"points": points},
        headers=user.headers,
    )


def point(lat=39.95, lng=-75.15, accuracy_m=10.0, recorded_at=None):
    body = {"lat": lat, "lng": lng, "accuracy_m": accuracy_m}
    if recorded_at is not None:
        body["recorded_at"] = recorded_at.isoformat()
    return body


# --- Consent provenance ------------------------------------------------------------

@pytest.mark.privacy
def test_session_records_the_consent_version_it_was_started_under(client, alice):
    """The point of versioning consent is being able to say later which policy text
    governed which rows. If this is not persisted, changing the policy leaves no
    option but to delete everything."""
    session = start_session(client, alice)
    assert session["consent_version"] == CONSENT_VERSION
    assert session["user_id"] == str(alice.id)
    assert session["source"] == "live_tracking"
    assert session["ended_at"] is None


@pytest.mark.privacy
def test_consent_version_survives_to_the_history_read(client, alice):
    start_session(client, alice)
    history = client.get("/location/history", headers=alice.headers).json()
    assert history["sessions"][0]["consent_version"] == CONSENT_VERSION


# --- Server-side minimization ------------------------------------------------------

@pytest.mark.privacy
def test_low_accuracy_points_are_dropped_server_side(client, alice):
    """The clients filter at 120m; the server independently enforces 200m. A modified
    or outdated client must not be able to push junk fixes into stored history."""
    session = start_session(client, alice)

    response = send_points(
        client,
        alice,
        session["id"],
        [point(accuracy_m=10.0), point(accuracy_m=250.0), point(accuracy_m=15.0)],
    )
    assert response.status_code == 200
    assert response.json() == {"accepted": 3, "stored": 2}


@pytest.mark.privacy
def test_the_accuracy_boundary_is_exclusive(client, alice):
    """200.0 is kept, 200.1 is dropped — pinning the boundary so a later refactor
    cannot quietly widen what gets stored."""
    session = start_session(client, alice)

    assert send_points(client, alice, session["id"], [point(accuracy_m=200.0)]).json()["stored"] == 1
    assert send_points(client, alice, session["id"], [point(accuracy_m=200.1)]).json()["stored"] == 0


@pytest.mark.privacy
def test_points_with_unknown_accuracy_are_kept(client, alice):
    """A missing accuracy reading is not a reason to discard the fix."""
    session = start_session(client, alice)
    response = send_points(client, alice, session["id"], [{"lat": 39.95, "lng": -75.15}])
    assert response.json() == {"accepted": 1, "stored": 1}


@pytest.mark.privacy
def test_coordinates_are_rounded_server_side(client, alice):
    """Client-side rounding is treated as a hint, not a guarantee."""
    session = start_session(client, alice)
    send_points(client, alice, session["id"], [point(lat=39.123456789, lng=-75.987654321)])

    stored = client.get("/location/history", headers=alice.headers).json()["points"][0]
    assert stored["lat"] == 39.12346
    assert stored["lng"] == -75.98765


@pytest.mark.privacy
def test_is_coarse_is_computed_by_the_server_not_accepted_from_the_client(client, alice):
    """`is_coarse` is a server-derived classification. The request schema has no such
    field, so a client cannot assert that a precise fix was coarse (or vice versa)."""
    session = start_session(client, alice)
    send_points(
        client,
        alice,
        session["id"],
        [
            {"lat": 1.0, "lng": 1.0, "accuracy_m": 30.0, "is_coarse": True},
            {"lat": 2.0, "lng": 2.0, "accuracy_m": 90.0, "is_coarse": False},
        ],
    )

    points = client.get("/location/history", headers=alice.headers).json()["points"]
    by_lat = {p["lat"]: p["is_coarse"] for p in points}
    assert by_lat[1.0] is False, "30m fix is precise, regardless of what the client claimed"
    assert by_lat[2.0] is True, "90m fix is coarse, regardless of what the client claimed"


@pytest.mark.privacy
def test_empty_batch_is_a_no_op(client, alice):
    session = start_session(client, alice)
    assert send_points(client, alice, session["id"], []).json() == {"accepted": 0, "stored": 0}


def test_naive_timestamps_are_interpreted_as_utc(client, alice):
    """A client that sends a naive timestamp must not have it read as local time.

    Sends the same instant twice — once naive, once with an explicit +02:00 offset —
    and asserts both land on the same stored value. If naive input were treated as
    anything other than UTC, the two would disagree by two hours.
    """
    session = start_session(client, alice)
    instant = datetime.now(timezone.utc) - timedelta(hours=2)

    send_points(
        client,
        alice,
        session["id"],
        [
            point(lat=1.0, recorded_at=instant.replace(tzinfo=None)),
            point(lat=2.0, recorded_at=instant.astimezone(timezone(timedelta(hours=2)))),
        ],
    )

    points = client.get("/location/history", headers=alice.headers).json()["points"]
    stored = {p["lat"]: p["recorded_at"] for p in points}
    assert stored[1.0] == stored[2.0]


# --- Session lifecycle -------------------------------------------------------------

def test_stopping_a_session_sets_ended_at(client, alice):
    session = start_session(client, alice)
    stopped = client.post(
        f"/location/sessions/{session['id']}/stop", headers=alice.headers
    ).json()
    assert stopped["ended_at"] is not None


def test_stopping_twice_is_idempotent(client, alice):
    session = start_session(client, alice)
    first = client.post(f"/location/sessions/{session['id']}/stop", headers=alice.headers).json()
    second = client.post(f"/location/sessions/{session['id']}/stop", headers=alice.headers).json()
    assert first["ended_at"] == second["ended_at"]


@pytest.mark.privacy
def test_a_stopped_session_refuses_new_points(client, alice):
    """Once tracking is off, that session cannot be used to keep writing location."""
    session = start_session(client, alice)
    client.post(f"/location/sessions/{session['id']}/stop", headers=alice.headers)

    response = send_points(client, alice, session["id"], [point()])
    assert response.status_code == 409


# --- Cross-user scoping ------------------------------------------------------------

@pytest.mark.security
@pytest.mark.privacy
def test_points_cannot_be_written_into_another_users_session(client, alice, bob):
    session = start_session(client, alice)

    response = send_points(client, bob, session["id"], [point()])
    assert response.status_code == 404, "must not confirm the session exists"


@pytest.mark.security
def test_another_users_session_cannot_be_stopped(client, alice, bob):
    session = start_session(client, alice)
    response = client.post(
        f"/location/sessions/{session['id']}/stop", headers=bob.headers
    )
    assert response.status_code == 404


@pytest.mark.security
@pytest.mark.privacy
def test_history_only_ever_returns_the_callers_own_data(client, alice, bob):
    alice_session = start_session(client, alice)
    send_points(client, alice, alice_session["id"], [point(lat=39.95, lng=-75.15)])

    bob_session = start_session(client, bob)
    send_points(client, bob, bob_session["id"], [point(lat=40.71, lng=-74.00)])

    alice_history = client.get("/location/history", headers=alice.headers).json()
    bob_history = client.get("/location/history", headers=bob.headers).json()

    assert [p["lat"] for p in alice_history["points"]] == [39.95]
    assert [p["lat"] for p in bob_history["points"]] == [40.71]
    assert {s["user_id"] for s in alice_history["sessions"]} == {str(alice.id)}
    assert {s["user_id"] for s in bob_history["sessions"]} == {str(bob.id)}


# --- Read-window clamping ----------------------------------------------------------

@pytest.mark.privacy
def test_days_parameter_is_clamped_to_90(client, alice):
    """A caller must not be able to widen the retention window by inflating a query
    parameter — asking for 9999 days returns at most 90 days of points."""
    session = start_session(client, alice)
    now = datetime.now(timezone.utc)
    send_points(
        client,
        alice,
        session["id"],
        [
            point(lat=1.0, recorded_at=now - timedelta(days=200)),
            point(lat=2.0, recorded_at=now - timedelta(days=30)),
        ],
    )

    history = client.get("/location/history?days=9999", headers=alice.headers).json()
    assert [p["lat"] for p in history["points"]] == [2.0]


@pytest.mark.privacy
def test_days_parameter_is_clamped_to_a_minimum_of_one(client, alice):
    session = start_session(client, alice)
    now = datetime.now(timezone.utc)
    send_points(
        client,
        alice,
        session["id"],
        [
            point(lat=1.0, recorded_at=now - timedelta(days=3)),
            point(lat=2.0, recorded_at=now - timedelta(hours=1)),
        ],
    )

    history = client.get("/location/history?days=-5", headers=alice.headers).json()
    assert [p["lat"] for p in history["points"]] == [2.0]


@pytest.mark.privacy
def test_limit_is_clamped_so_history_cannot_become_a_bulk_export(client, alice):
    session = start_session(client, alice)
    send_points(
        client, alice, session["id"], [point(lat=39.0 + i / 1000) for i in range(150)]
    )

    assert len(client.get("/location/history?limit=1", headers=alice.headers).json()["points"]) == 100
    assert (
        len(client.get("/location/history?limit=99999", headers=alice.headers).json()["points"])
        == 150
    )


def test_history_points_are_returned_oldest_first(client, alice):
    session = start_session(client, alice)
    now = datetime.now(timezone.utc)
    send_points(
        client,
        alice,
        session["id"],
        [
            point(lat=2.0, recorded_at=now - timedelta(hours=1)),
            point(lat=1.0, recorded_at=now - timedelta(hours=5)),
        ],
    )

    history = client.get("/location/history", headers=alice.headers).json()
    assert [p["lat"] for p in history["points"]] == [1.0, 2.0]


# --- Deletion ----------------------------------------------------------------------

@pytest.mark.privacy
def test_deletion_removes_points_and_sessions_and_reports_the_counts(client, engine, alice):
    """Sessions must go too. Leaving them behind would preserve a record of when the
    user was out walking, which is most of what the trail revealed."""
    first = start_session(client, alice)
    send_points(client, alice, first["id"], [point(lat=1.0), point(lat=2.0)])
    second = start_session(client, alice)
    send_points(client, alice, second["id"], [point(lat=3.0)])

    response = client.delete("/location/history", headers=alice.headers)
    assert response.json() == {"ok": True, "deleted_points": 3, "deleted_sessions": 2}

    with Session(engine) as session:
        assert session.exec(select(LocationPoint)).all() == []
        assert session.exec(select(LocationSession)).all() == []


@pytest.mark.privacy
def test_deletion_is_a_hard_delete_not_a_flag(client, engine, alice):
    """Reports are soft-deleted by design. Location history must not be — a 'deleted'
    trail that is still on disk is not deleted."""
    session_row = start_session(client, alice)
    send_points(client, alice, session_row["id"], [point()])

    client.delete("/location/history", headers=alice.headers)

    with Session(engine) as db:
        assert db.exec(select(LocationPoint)).first() is None


@pytest.mark.security
@pytest.mark.privacy
def test_deletion_is_scoped_to_the_caller(client, alice, bob):
    alice_session = start_session(client, alice)
    send_points(client, alice, alice_session["id"], [point(lat=1.0)])
    bob_session = start_session(client, bob)
    send_points(client, bob, bob_session["id"], [point(lat=2.0)])

    response = client.delete("/location/history", headers=alice.headers)
    assert response.json()["deleted_points"] == 1

    bob_history = client.get("/location/history", headers=bob.headers).json()
    assert [p["lat"] for p in bob_history["points"]] == [2.0]
    assert len(bob_history["sessions"]) == 1


@pytest.mark.privacy
def test_deleting_an_empty_history_is_safe(client, alice):
    response = client.delete("/location/history", headers=alice.headers)
    assert response.json() == {"ok": True, "deleted_points": 0, "deleted_sessions": 0}

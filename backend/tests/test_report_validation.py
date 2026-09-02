"""Input validation and rate limiting on report creation.

Before this, `POST /reports` accepted any string as a severity and any float as a
coordinate, so an authenticated client could put unrenderable pins anywhere on the map —
including off it. Errors are raised as 400 with a plain-string `detail` rather than
FastAPI's automatic 422, because the mobile client renders `detail` straight into an
alert and a structured validation list would surface to the user as noise.
"""

from datetime import datetime, timedelta, timezone

import pytest
from sqlmodel import Session

import main
from models import Report

VALID = {"lat": "39.95", "lng": "-75.15", "severity": "light"}


def post_report(client, user, **overrides):
    form = dict(VALID)
    form.update(overrides)
    form = {k: v for k, v in form.items() if v is not None}
    return client.post("/reports", data=form, headers=user.headers)


def detail(response):
    return response.json()["detail"]


# --- Coordinates -------------------------------------------------------------------

@pytest.mark.parametrize(
    "lat,lng",
    [
        ("91", "-75.15"),
        ("-91", "-75.15"),
        ("39.95", "181"),
        ("39.95", "-181"),
        ("1000", "1000"),
    ],
)
def test_out_of_range_coordinates_are_rejected(client, alice, lat, lng):
    response = post_report(client, alice, lat=lat, lng=lng)
    assert response.status_code == 400
    assert "between" in detail(response)


@pytest.mark.parametrize("lat,lng", [("90", "180"), ("-90", "-180"), ("0", "0")])
def test_boundary_coordinates_are_accepted(client, alice, lat, lng):
    """The poles and the antimeridian are real places; don't reject them off-by-one."""
    assert post_report(client, alice, lat=lat, lng=lng).status_code == 200


@pytest.mark.parametrize("bad", ["nan", "inf", "-inf"])
def test_non_finite_coordinates_are_rejected(client, alice, bad):
    """float('nan') passes FastAPI's float coercion. Every comparison against NaN is
    False, so the range check rejects it — but only because it is written as a range
    test rather than a pair of negated bounds."""
    response = post_report(client, alice, lat=bad)
    assert response.status_code == 400


def test_non_numeric_coordinates_are_rejected(client, alice):
    """This one is FastAPI's own coercion failing, so it is a 422, not our 400."""
    assert post_report(client, alice, lat="north").status_code == 422


# --- Severity ----------------------------------------------------------------------

@pytest.mark.parametrize("severity", ["light", "moderate", "trashy", "urgent"])
def test_the_four_client_severities_are_accepted(client, alice, severity):
    response = post_report(client, alice, severity=severity)
    assert response.status_code == 200
    assert response.json()["severity"] == severity


@pytest.mark.parametrize("severity", ["catastrophic", "light ; drop table", "0", "LIGHTS"])
def test_unknown_severities_are_rejected(client, alice, severity):
    response = post_report(client, alice, severity=severity)
    assert response.status_code == 400
    assert "Severity must be one of" in detail(response)


@pytest.mark.parametrize("sent,stored", [("LIGHT", "light"), ("  Urgent  ", "urgent")])
def test_severity_is_normalised(client, alice, sent, stored):
    """Case and stray whitespace are normalised rather than rejected — the clients
    colour pins by exact string match, so a stored 'LIGHT' would render as undefined."""
    response = post_report(client, alice, severity=sent)
    assert response.status_code == 200
    assert response.json()["severity"] == stored


def test_severity_defaults_to_light_when_omitted(client, alice):
    response = post_report(client, alice, severity=None)
    assert response.status_code == 200
    assert response.json()["severity"] == "light"


def test_an_empty_severity_field_falls_back_to_the_default(client, alice):
    """An empty form field does not reach the endpoint as an empty string — it is
    indistinguishable from an omitted one, so FastAPI applies the default. Pinned
    because it looks like it should be a validation error and is not."""
    response = post_report(client, alice, severity="")
    assert response.status_code == 200
    assert response.json()["severity"] == "light"


# --- Notes and duration ------------------------------------------------------------

def test_notes_at_the_limit_are_accepted(client, alice):
    assert post_report(client, alice, notes="x" * main.MAX_NOTES_LENGTH).status_code == 200


def test_overlong_notes_are_rejected(client, alice):
    response = post_report(client, alice, notes="x" * (main.MAX_NOTES_LENGTH + 1))
    assert response.status_code == 400
    assert "characters or fewer" in detail(response)


def test_a_full_incident_block_still_fits(client, alice):
    """Incident reports serialise structured fields into notes, so the cap has to leave
    room for the real thing rather than just a short comment."""
    notes = (
        "[ENVIRONMENTAL INCIDENT]\nType: Ground contamination\n"
        "Immediate hazard: yes\nSuspected source: " + "x" * 500
    )
    assert post_report(client, alice, notes=notes).status_code == 200


@pytest.mark.parametrize("duration", ["-1", "1441", "99999"])
def test_out_of_range_durations_are_rejected(client, alice, duration):
    response = post_report(client, alice, duration_minutes=duration)
    assert response.status_code == 400
    assert "Duration" in detail(response)


@pytest.mark.parametrize("duration", ["0", "45", "1440"])
def test_plausible_durations_are_accepted(client, alice, duration):
    assert post_report(client, alice, duration_minutes=duration).status_code == 200


# --- Photo uploads -----------------------------------------------------------------

@pytest.mark.security
@pytest.mark.parametrize(
    "filename,content_type",
    [
        ("payload.html", "text/html"),
        ("payload.svg", "image/svg+xml"),
        ("script.js", "application/javascript"),
        ("doc.pdf", "application/pdf"),
    ],
)
def test_non_image_uploads_are_rejected(client, alice, filename, content_type):
    """Uploads are served back as static files from the same origin, so an HTML or SVG
    upload would be a stored-XSS vector. SVG is excluded on purpose: it is an image
    type, but it can carry script."""
    response = client.post(
        "/reports",
        data=VALID,
        files={"file": (filename, b"<html>hi</html>", content_type)},
        headers=alice.headers,
    )
    assert response.status_code == 400
    assert "Photo must be one of" in detail(response)


@pytest.mark.parametrize(
    "content_type", ["image/jpeg", "image/png", "image/webp", "image/heic"]
)
def test_real_image_types_are_accepted(client, alice, content_type):
    """HEIC matters — it is what an iPhone camera produces by default."""
    response = client.post(
        "/reports",
        data=VALID,
        files={"file": ("photo.img", b"fake-bytes", content_type)},
        headers=alice.headers,
    )
    assert response.status_code == 200


def test_content_type_parameters_are_tolerated(client, alice):
    response = client.post(
        "/reports",
        data=VALID,
        files={"file": ("photo.jpg", b"bytes", "image/jpeg; charset=binary")},
        headers=alice.headers,
    )
    assert response.status_code == 200


def test_oversized_uploads_are_rejected(client, alice, monkeypatch):
    monkeypatch.setattr(main, "MAX_UPLOAD_BYTES", 100)
    response = client.post(
        "/reports",
        data=VALID,
        files={"file": ("big.jpg", b"x" * 500, "image/jpeg")},
        headers=alice.headers,
    )
    assert response.status_code == 400
    assert "or smaller" in detail(response)


@pytest.mark.security
def test_the_photo_patch_endpoint_validates_too(client, alice):
    """Same guard on the other upload path — otherwise the rule is trivially bypassed
    by creating a report first and attaching the file afterwards."""
    report = post_report(client, alice).json()
    response = client.patch(
        f"/reports/{report['id']}/photo",
        files={"file": ("payload.html", b"<html>", "text/html")},
        headers=alice.headers,
    )
    assert response.status_code == 400


def test_a_rejected_report_stores_nothing(client, alice):
    """Validation runs before the write, so a bad request must not leave a row behind."""
    post_report(client, alice, severity="catastrophic")
    assert client.get("/reports").json() == []


# --- Rate limiting -----------------------------------------------------------------

@pytest.mark.security
def test_report_creation_is_rate_limited(client, alice, monkeypatch):
    monkeypatch.setattr(main, "REPORT_RATE_LIMIT_MAX", 3)

    for _ in range(3):
        assert post_report(client, alice).status_code == 200

    blocked = post_report(client, alice)
    assert blocked.status_code == 429
    assert "Report limit reached" in detail(blocked)


@pytest.mark.security
def test_the_limit_is_per_user(client, alice, bob, monkeypatch):
    """One noisy account must not lock everyone else out."""
    monkeypatch.setattr(main, "REPORT_RATE_LIMIT_MAX", 2)

    post_report(client, alice)
    post_report(client, alice)
    assert post_report(client, alice).status_code == 429
    assert post_report(client, bob).status_code == 200


@pytest.mark.security
def test_deleting_reports_does_not_reset_the_quota(client, alice, monkeypatch):
    """Soft-deleted reports still count. Otherwise the limit is bypassed by looping
    create-then-delete."""
    monkeypatch.setattr(main, "REPORT_RATE_LIMIT_MAX", 2)

    first = post_report(client, alice).json()
    post_report(client, alice)
    client.delete(f"/reports/{first['id']}", headers=alice.headers)

    assert post_report(client, alice).status_code == 429


def test_reports_outside_the_window_do_not_count(client, engine, alice, monkeypatch):
    monkeypatch.setattr(main, "REPORT_RATE_LIMIT_MAX", 2)
    old = datetime.now(timezone.utc) - timedelta(
        minutes=main.REPORT_RATE_LIMIT_WINDOW_MINUTES + 5
    )

    with Session(engine) as session:
        for _ in range(5):
            session.add(Report(lat=1.0, lng=1.0, user_id=str(alice.id), created_at=old))
        session.commit()

    assert post_report(client, alice).status_code == 200


def test_the_limit_can_be_disabled(client, alice, monkeypatch):
    monkeypatch.setattr(main, "REPORT_RATE_LIMIT_MAX", 0)

    for _ in range(15):
        assert post_report(client, alice).status_code == 200

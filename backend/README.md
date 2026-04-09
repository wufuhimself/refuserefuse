FastAPI backend for RefuseRefuse (dev)

Run locally:

1. Create a virtualenv and install requirements:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

2. Start the server:

```bash
uvicorn backend.main:app --reload --port 8000
```

3. Configure OAuth verification (recommended for social auth):

```bash
export GOOGLE_CLIENT_IDS="<web-client-id>,<ios-client-id>,<android-client-id>"
export APPLE_AUDIENCES="<apple-service-id>,<ios-bundle-id>"
```

## API Endpoints

### Authentication

- **POST /auth/register** - Create a password-based account
  - Body: `{ email, password: string (min 6), display_name?: string }`
  - Returns: `{ access_token, token_type }`

- **POST /auth/login** - Login with email/password
  - Body: `{ email, password }`
  - Returns: `{ access_token, token_type }`

- **POST /auth/oauth/google** - Exchange Google ID token for RefuseRefuse JWT
  - Body: `{ id_token, display_name?: string }`
  - Returns: `{ access_token, token_type }`
  - Errors:
    - 401: Invalid or unverified Google token
    - 409: Email already linked to a different provider

- **POST /auth/oauth/apple** - Exchange Apple ID token for RefuseRefuse JWT
  - Body: `{ id_token, display_name?: string }`
  - Returns: `{ access_token, token_type }`
  - Errors:
    - 401: Invalid Apple token
    - 409: Email already linked to a different provider

- **GET /auth/me** - Get current authenticated user
  - Headers: `Authorization: Bearer <token>`
  - Returns: `{ id, email, display_name }`

### Reports

- **GET /reports** - List all reports (no auth required)
  - Returns: Array of reports

- **POST /reports** - Create a new report (authenticated)
  - Headers: `Authorization: Bearer <token>`
  - Body (multipart/form-data):
    - `lat: float`
    - `lng: float`
    - `severity: string` (light, moderate, trashy, urgent)
    - `notes: string` (optional; use `[ENVIRONMENTAL INCIDENT]\n...` format for incident reports)
    - `picked_up: boolean` (default false)
    - `duration_minutes: integer` (optional; cleanup time in minutes)
    - `file: binary` (optional; photo upload)
  - Returns: Created report object

- **PATCH /reports/{id}** - Mark report as picked up (authenticated)
  - Headers: `Authorization: Bearer <token>`
  - Body (multipart/form-data): `{ picked_up: boolean }`
  - Returns: Updated report object

- **PATCH /reports/{id}/photo** - Add or update photo on existing report (authenticated)
  - Headers: `Authorization: Bearer <token>`
  - Body (multipart/form-data): `{ file: binary }`
  - Returns: Updated report object
  - Only the original reporter can add a photo.

- **DELETE /reports/{id}** - Soft-delete a report (authenticated)
  - Headers: `Authorization: Bearer <token>`
  - Only the original reporter can delete their report.
  - Returns: `{ ok: true, soft_deleted: true }`

## OAuth Account Linking Rules

- **Single provider per email**: Once an email is linked to Google (or Apple), it cannot be linked to Apple (or Google). Users must create a separate account if they want to use a different provider.
- **No cross-provider linking**: If user1@gmail.com authenticates via Google and later tries to authenticate via Apple, the system returns HTTP 409 (Conflict) with a message directing them to use a different email or sign in with their original provider.
- **Existing email, no provider**: If an email exists in the system but was never linked to any OAuth provider, the first OAuth provider to claim it will be linked to that account.

## Photo Storage

Uploaded photos are stored in `backend/uploads/` and served at `/uploads/<filename>`.

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

API endpoints:
- GET /reports -> list reports
- POST /reports -> create a report (multipart/form-data: lat, lng, severity, notes, file)
- POST /auth/register -> email/password registration
- POST /auth/login -> email/password login
- POST /auth/oauth/google -> exchange Google ID token for RefuseRefuse JWT
- POST /auth/oauth/apple -> exchange Apple ID token for RefuseRefuse JWT
- GET /auth/me -> current user from JWT

Uploaded photos are stored in `backend/uploads/` and served at `/uploads/<filename>`.

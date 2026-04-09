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

API endpoints:
- GET /reports -> list reports
- POST /reports -> create a report (multipart/form-data: lat, lng, severity, notes, file)

Uploaded photos are stored in `backend/uploads/` and served at `/uploads/<filename>`.

## RefuseRefuse Architecture

Current state

- Primary runtime is browser-first:
  - `frontend/` is the Vite app.
  - `backend/` is the FastAPI API.
- Earlier Expo/mobile scaffolding was removed from the repo root to avoid startup ambiguity.
- If mobile work resumes, create a dedicated `mobile/` directory.

## Local development

Quick commands

- `npm run dev`: restart backend + frontend and tail both logs.
- `npm run start`: start backend + frontend.
- `npm run stop`: stop backend + frontend.
- `npm run restart`: restart backend + frontend.
- `npm run status`: show backend/frontend status.
- `npm run frontend:build`: build the Vite frontend.

Equivalent Make targets

- `make start`, `make stop`, `make restart`, `make status`, `make logs`

Default local URLs

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:8000`

## Browser stack details

Frontend (`frontend/`)

- React + Vite app.
- Map/UI code lives under `frontend/src/`.
- Build output goes to `frontend/dist/`.

Backend (`backend/`)

- FastAPI app with local SQLite (`backend/dev.db`).
- File uploads are stored in `backend/uploads/`.
- Common endpoints:
  - `GET /reports`
  - `POST /reports`

## Product direction (reference)

The long-term product direction can still include mobile, auth, scoring, and anti-abuse controls, but implementation should be split by surface area:

- Browser iteration remains in `frontend/` + `backend/`.
- Future mobile app should live in `mobile/` and have its own dependencies/config.

This separation prevents root-level dependency conflicts and keeps startup/testing behavior predictable.

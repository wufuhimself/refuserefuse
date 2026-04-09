## RefuseRefuse Architecture

Current state

- Primary runtime is browser-first:
  - `frontend/` is the Vite app.
  - `backend/` is the FastAPI API.
- Mobile now lives in a dedicated `mobile/` directory to avoid root-level startup ambiguity.

## Local development

Quick commands

- `npm run dev`: restart backend + frontend and tail both logs.
- `npm run start`: start backend + frontend.
- `npm run stop`: stop backend + frontend.
- `npm run restart`: restart backend + frontend.
- `npm run status`: show backend/frontend status.
- `npm run frontend:build`: build the Vite frontend.
- `npm run mobile:start`: launch Expo from `mobile/`.
- `npm run mobile:ios`: run the iOS native target from `mobile/`.
- `npm run mobile:android`: run the Android native target from `mobile/`.

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

Mobile (`mobile/`)

- Expo React Native app with its own dependencies and config.
- Current scope is UI-first and mirrors the web app’s visual language.
- Uses `GET /reports` when available and demo fallback data when the backend is unreachable.

Backend (`backend/`)

- FastAPI app with local SQLite (`backend/dev.db`).
- File uploads are stored in `backend/uploads/`.
- All report creation/updates require authentication (JWT token in Authorization header).
- Common endpoints:
  - `GET /reports` (public)
  - `POST /reports` (authenticated; supports multipart photo upload)
  - `PATCH /reports/{id}` (authenticated; mark as picked up)
  - `PATCH /reports/{id}/photo` (authenticated; upload photo)
  - `DELETE /reports/{id}` (authenticated; soft delete)
  - `POST /auth/oauth/google`
  - `POST /auth/oauth/apple`
  - `GET /auth/me` (authenticated)

Auth configuration

- Backend verifies provider ID tokens and exchanges them for RefuseRefuse JWTs.
- **OAuth account linking is strict**: One provider per email. Attempting to link an email to a second provider returns HTTP 409 (Conflict). Users must use a different email or stick to their original provider.
- Required backend env vars:
  - `GOOGLE_CLIENT_IDS`: comma-separated Google OAuth client IDs allowed to mint ID tokens.
  - `APPLE_AUDIENCES`: comma-separated Apple audiences (Service ID for web and bundle ID for iOS app).
- Required frontend env vars:
  - `VITE_GOOGLE_CLIENT_ID`
  - `VITE_APPLE_CLIENT_ID`
  - `VITE_APPLE_REDIRECT_URI`
- Required mobile env vars:
  - `EXPO_PUBLIC_GOOGLE_EXPO_CLIENT_ID`
  - `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`
  - `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID`
  - `EXPO_PUBLIC_API_BASE_URL` (especially for physical devices)

## Social auth smoke test

### Prerequisites

Before running any auth flow tests, ensure:

1. **Google OAuth credentials configured**
   - Backend: `GOOGLE_CLIENT_IDS` env var includes the web/iOS Google OAuth client ID.
   - Frontend: `VITE_GOOGLE_CLIENT_ID` matches the above.
   - Mobile: `EXPO_PUBLIC_GOOGLE_EXPO_CLIENT_ID` and `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` are the Expo/iOS Google OAuth client IDs.

2. **Apple Sign In credentials configured** (iOS only)
   - Backend: `APPLE_AUDIENCES` env var includes your web Service ID and iOS bundle ID (`com.refuserefuse.mobile`).
   - Frontend: `VITE_APPLE_CLIENT_ID`, `VITE_APPLE_REDIRECT_URI` configured for your web domain.
   - Mobile: iOS bundle identifier is correct and Apple Sign-In is enabled in Xcode.

3. **Services running** (`make start` or `npm run start` from repo root)

### Browser / Web flow

1. **Navigate to frontend** → `http://localhost:5173`
2. **Open the map** and tap the **Login / Profile** button in the top-right.
3. **Test Google Sign-In**
   - Click **Google** button.
   - Authenticate with your Google account.
   - Verify the modal closes and the top-right now shows your Google display name.
   - Verify `/auth/me` returned a token and user object (check browser DevTools Network tab).
4. **Test logout**
   - Click **Profile** → **Logout**.
   - Verify the button returns to **Login / Profile**.
5. **Reopen auth modal and test Google again**
   - Verify the **Google** button appears (it should render fresh each time the modal opens).
   - Verify authentication completes without errors.
6. **Test Apple Sign-In** (Safari on macOS only)
   - Close any active session.
   - Tap **Login / Profile** → click **Apple** button.
   - Authenticate with your Apple ID.
   - Verify the modal closes and display name is shown.
   - Verify `/auth/me` returned a valid token and user object.

### Mobile / iOS flow

1. **Start the Expo app** → `npm run mobile:start` from repo root (or `cd mobile && npm start`).
2. **Build and run simulator** → `npm run mobile:ios` (builds and launches iPhone simulator).
3. **On app launch**
   - Tap the **Login / Profile** button if not already logged in.
   - The auth modal should appear with Google + Apple sign-in options.
4. **Test Google Sign-In**
   - Tap **Google**.
   - Complete Google authentication in the system prompt or browser.
   - When returned to the app, verify the top-right status bar shows your Google display name.
   - Verify a token was exchanged with `POST /auth/oauth/google` on the backend (check backend logs).
5. **Test logout**
   - Tap **Profile** → **Logout**.
   - Verify the status bar returns to **Login / Profile**.
6. **Test Apple Sign-In**
   - Reopen the auth modal.
   - Tap **Apple**.
   - Complete Apple ID authentication.
   - Verify the status bar now shows your Apple display name.
   - Verify `POST /auth/oauth/apple` succeeded on the backend.
7. **Verify session persistence**
   - In the simulator, open Developer Menu → Simulator (or `xcrun simctl help`).
   - Force quit the app (or simulate background termination).
   - Relaunch the app.
   - Verify the profile still shows the logged-in display name (session token persisted).

### Backend endpoint validation

After any successful sign-in (web or mobile), verify backend logs show:
- `POST /auth/oauth/google` → call received, token verified, user found or created, app JWT returned.
- `POST /auth/oauth/apple` → call received, token verified, user found or created, app JWT returned.

### Troubleshooting

| Issue | Diagnosis |
|-------|-----------|
| Google button doesn't appear on web | Check `VITE_GOOGLE_CLIENT_ID` is set and correct. Inspect DevTools for script load errors on `accounts.google.com`. |
| "Could not load Google Sign-In" error | Network issue or incorrect client ID. Check frontend env and console. |
| Google auth fails on mobile (Expo) | Verify `EXPO_PUBLIC_GOOGLE_EXPO_CLIENT_ID` is a valid web/Expo OAuth credential. Check `EXPO_PUBLIC_API_BASE_URL` points to accessible backend. |
| Apple auth unavailable | Apple Sign-In only works on iOS (not Android or web simulator). Use Safari on macOS for web testing. |
| Backend returns 422 on OAuth exchange | Provider ID token is invalid or `GOOGLE_CLIENT_IDS`/`APPLE_AUDIENCES` doesn't include your credential. Check backend logs for specific validation error. |
| After logout, login button doesn't work | Refresh the page (web) or restart the app (mobile). Check that token was actually cleared in storage. |

## Authenticated Submissions

All report submissions require user authentication. The flow is:

1. **User taps/clicks to create report** → App opens report composer modal.
2. **User enters details** (location, severity, notes, optional photo).
3. **User taps "Submit Report"** → App checks if user has a valid token.
4. **If not authenticated**: App opens auth modal; user logs in via OAuth or email/password.
5. **After auth**: App automatically retries the submission with the new token.
6. **On backend**: `POST /reports` is authenticated-only (returns 401 if no valid Bearer token).
7. **Success**: Report created with `user_id` set to the authenticated user's ID; modal closes; reports list refreshes.

### Submission endpoints (authenticated)

- **POST /reports** - Create a new trash report or incident
  - Required header: `Authorization: Bearer <jwt_token>`
  - Form body: lat, lng, severity, notes (optional), picked_up (bool), file (optional photo).
  - Returns: Created report object.
  - User ID is automatically set from the JWT token.

- **PATCH /reports/{id}** - Mark a report as picked up/cleaned
  - Required header: `Authorization: Bearer <jwt_token>`
  - Form body: `picked_up` (bool).
  - Only the original reporter can modify their reports.

- **PATCH /reports/{id}/photo** - Add a photo to a report
  - Required header: `Authorization: Bearer <jwt_token>`
  - Form body: `file` (binary photo).
  - Only the original reporter can add a photo.

- **DELETE /reports/{id}** - Soft-delete a report
  - Required header: `Authorization: Bearer <jwt_token>`
  - Only the original reporter can delete their report.

### Mobile submission (React Native / Expo)

- Call `submitReport()` for trash reports (uses FormData + fetch with Bearer token).
- Call `submitIncident()` for environmental incidents (prefixes notes with `[ENVIRONMENTAL INCIDENT]` marker).
- Both functions check user authentication; if missing, open auth modal and retry after login.
- Photos are attached via FormData (future work; currently form-only).

### Web submission (Vite / React)

- Already wired and functional.
- Uses axios with `Authorization: Bearer ${token}` header.
- Submission form checks `token` state; if missing, opens auth modal.
- After successful login, form can be resubmitted.

## Product direction (reference)

The long-term product direction can still include mobile, auth, scoring, and anti-abuse controls, but implementation should be split by surface area:

- Browser iteration remains in `frontend/` + `backend/`.
- Mobile iteration lives in `mobile/` and has its own dependencies/config.

This separation prevents root-level dependency conflicts and keeps startup/testing behavior predictable.

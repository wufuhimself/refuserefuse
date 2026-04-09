# RefuseRefuse Mobile

This directory contains the first dedicated mobile surface for RefuseRefuse.

Current scope

- Expo-based app shell under `mobile/`
- Visual system intentionally matched to the web app: Space Grotesk, glassy top bar, stat chips, map-first layout, settings modal, profile card, incident workflow shell, and report composer sheet
- Reads `GET /reports` from the same backend when available
- Exchanges Google and Apple ID tokens with backend OAuth endpoints
- Falls back to demo report data when the backend is not reachable so the UI is still explorable

Run it

1. Install dependencies:
   - `cd mobile && npm install`
2. Start Expo:
   - `npm start`
3. Optionally run a simulator build:
   - `npm run ios`
   - `npm run android`

Backend URL

- The app reads `EXPO_PUBLIC_API_BASE_URL` if set.
- Default fallback values are:
  - iOS simulator: `http://127.0.0.1:8000`
  - Android emulator: `http://10.0.2.2:8000`
  - Other environments: `http://localhost:8000`

Example:

- `EXPO_PUBLIC_API_BASE_URL=http://192.168.1.25:8000 npm start`

Google sign-in env vars

- `EXPO_PUBLIC_GOOGLE_EXPO_CLIENT_ID`
- `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`
- `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID`

Apple sign-in notes

- Apple Sign-In is available only on iOS.
- Backend `APPLE_AUDIENCES` must include your iOS bundle identifier.

What is intentionally not wired yet

- Report submission and photo upload
- Incident submission
- Cross-device settings sync

Those behaviors can be layered onto the current shell without changing the app’s structure or visual language.
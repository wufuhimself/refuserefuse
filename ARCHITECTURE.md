## RefuseRefuse — Architecture and Starter Plan

This document outlines a practical, opinionated architecture to get your RefuseRefuse mobile app to the App Store and Play Store quickly while keeping pathways to more advanced capabilities.

## Contract (tiny)
- Inputs: user location (foreground), optional photo upload(s), simple user actions (report severity, picked-up toggle), OAuth identity from Google/Apple/Facebook.
- Outputs: map view with zones (GeoJSON polygons) and report pins, user profile with points and streaks, reports stored with photos and metadata.
- Error modes: network failures (queue/report later), auth failure, permission denied (location/camera), photo upload failure.
- Success: user can view zones, report an area (optionally with photo), earn points, and upload proof when required.

## High-level opinionated stack (recommended for speed)
- Frontend: Expo (managed) -> React Native + TypeScript. Use EAS Build for native dependencies.
  - Why: you know React; Expo speeds cross-platform development, TestFlight/Play builds supported via EAS.
- Map: Mapbox SDK via `@rnmapbox/maps` (requires prebuild/EAS) or MapLibre as a fallback. Mapbox gives vector tiles, style control and offline options.
- Auth + Backend: Firebase (Auth, Firestore, Storage, Cloud Functions).
  - Why: easiest to support Google/Apple/Facebook auth quickly; Storage for photos; Firestore for flexible schemas; Cloud Functions for scoring and server logic.
  - Alternative: Supabase (Postgres + storage + auth) if you prefer Postgres and open-source stack — slightly more setup for Apple Sign-In.

## Why this stack? tradeoffs
- Expo + EAS: fastest developer iteration; native Mapbox needs prebuild but EAS handles building native binaries.
- Firebase: lots of managed services that map directly to app needs (auth providers, file storage, realtime/transactions for points). Quick MVP.
- If you want total control (self-hosting, Postgres, advanced queries) pick Supabase or a small Node/Go server with Postgres.

## Data model (Firestore collections or Postgres tables)
- zones (GeoJSON polygon or bounding box)
  - id, name, geojson (polygon), severity (enum: clean/light/trashy/urgent), lastReportedAt, reportCount
- reports
  - id, zoneId (nullable), location: {lat,lng}, severity, photoUrl (nullable), pickedUp (bool), notes, userId, durationMinutes, createdAt
- users
  - id, displayName, authProviders, points, lastActiveAt, streakCount, createdAt
- activities (optional)
  - userId, type (report/cleanup), deltaPoints, metadata, createdAt

Security rules / server logic notes:
- Prevent fake reports: require photo when severity is 'too much' or when user marks they picked up > X volume. Use Cloud Functions to validate (e.g., ensure photo exists) and throttle reports per user per zone.
- Use Firestore rules to restrict writes to authenticated users, and Cloud Functions for points calculation to avoid client manipulation.

## Map & UI design notes
- Zones: store polygon GeoJSON; render on map with fill color by severity and subtle border.
- Reports: render as clustered pins; tap to view report details and mark as verified/picked-up.
- Reporting workflow:
  1. User taps region or uses a FAB to report current location.
  2. Quick modal: severity selector (clean/light/trashy/too-much), optional notes, camera button (required for 'too-much').
  3. If user picks 'I picked it up', allow toggling and small confirm — points awarded differently.
- UX rule: discourage reporting single pieces of trash — add a small hint in form and require photo when severity >= 'trashy'.

## Auth
- Use Firebase Auth providers for Google, Facebook, and Apple.
- On iOS, Apple Sign In is required if you offer third-party sign-in. Expo + EAS supports Apple sign-in.

## Photo uploads
- Use Firebase Storage with content-type validation and size limits.
- Use Cloud Function to generate thumbnails (optional) and scan for abusive content (3rd-party API) if desired.

## Points & Streaks
- Keep scoring logic server-side (Cloud Function): points for report submission, time spent, photo proof bonus, streak bonuses, and penalty/limits to prevent farming.
- Use transactions to update user points and append activity record.

## Offline and resilience
- Cache zones locally; allow creating a report offline and queue for upload when network returns.
- Store queued report with attached photo in secure local storage and retry logic.

## Privacy and Permissions
- Request foreground location only (no background unless you need continuous tracking). Explain why in permission prompt.
- Request camera and photo permissions. Keep uploaded photos private by default in storage with protected access rules.

## Folder structure (starter)
```
src/
  screens/
    MapScreen.tsx
    ReportForm.tsx
    ProfileScreen.tsx
  components/
    ZoneLayer.tsx
    ReportPin.tsx
  services/
    firebase.ts
    api.ts  # Cloud functions client wrappers
  models/
    ## RefuseRefuse — Architecture and Starter Plan

    This document outlines a practical, opinionated architecture to get your RefuseRefuse mobile app to the App Store and Play Store quickly while keeping pathways to more advanced capabilities.

    ## Contract (tiny)
    - Inputs: user location (foreground), optional photo upload(s), simple user actions (report severity, picked-up toggle), OAuth identity from Google/Apple/Facebook.
    - Outputs: map view with report pins (point markers) and clustered summaries, user profile with points and streaks, reports stored with photos and metadata.
    - Error modes: network failures (queue/report later), auth failure, permission denied (location/camera), photo upload failure.
    - Success: user can view nearby report pins, create a new report (with photo when required), earn points, and upload proof when required.

    ## High-level opinionated stack (recommended for speed)
    - Frontend: Expo (managed) -> React Native + TypeScript. Use EAS Build for native dependencies.
      - Why: you know React; Expo speeds cross-platform development, TestFlight/Play builds supported via EAS.
    - Map: Mapbox SDK via `@rnmapbox/maps` (requires prebuild/EAS) or MapLibre / `react-native-maps` as a fallback. For MVP, clustered point markers work well with any.
    - Auth + Backend: Firebase (Auth, Firestore, Storage, Cloud Functions).
      - Why: easiest to support Google/Apple/Facebook auth quickly; Storage for photos; Firestore for flexible schemas; Cloud Functions for scoring and server logic.
      - Alternative: Supabase (Postgres + storage + auth) if you prefer Postgres and open-source stack — slightly more setup for Apple Sign-In.

    ## Why this stack? tradeoffs
    - Expo + EAS: fastest developer iteration; native Mapbox needs prebuild but EAS handles building native binaries.
    - Firebase: lots of managed services that map directly to app needs (auth providers, file storage, realtime/transactions for points). Quick MVP.
    - If you want total control (self-hosting, Postgres, advanced queries) pick Supabase or a small Node/Go server with Postgres.

    ## Data model (Firestore collections or Postgres tables)
    - reports
      - id, location: {lat,lng}, severity (enum: clean/light/trashy/too-much), photoUrl (nullable), pickedUp (bool), notes, userId, durationMinutes, createdAt
    - users
      - id, displayName, authProviders, points, lastActiveAt, streakCount, createdAt
    - activities (optional)
      - userId, type (report/cleanup), deltaPoints, metadata, createdAt

    Security rules / server logic notes:
    - Prevent fake reports: require photo when severity is 'too-much' or when user marks they picked up > X volume. Use Cloud Functions to validate (e.g., ensure photo exists) and throttle reports per user per area/time window.
    - Use Firestore rules to restrict writes to authenticated users, and Cloud Functions for points calculation to avoid client manipulation.

    ## Map & UI design notes
    - Reports: represent trash as point markers (trash icon) placed at the reported location. Use clustering for nearby reports and cluster counts.
    - Pin styling: small colored trash icon by severity; cluster bubbles show a count and optionally average severity.
    - Report detail: tapping a pin opens a bottom sheet with photo (if any), severity, who reported (optional), time, and buttons: 'I picked this up' (small confirmation) or 'Report still trashy'.
    - Reporting workflow:
      1. User taps FAB or the map to report current location.
      2. Quick modal: severity selector (clean/light/trashy/too-much), optional notes, camera button (required for 'too-much').
      3. If user marks 'I picked it up', allow toggling and confirm — points awarded differently.
    - UX rule: discourage reporting single pieces of trash — add a small hint in form and require photo when severity >= 'trashy'.

    ## Auth
    - Use Firebase Auth providers for Google, Facebook, and Apple.
    - On iOS, Apple Sign In is required if you offer third-party sign-in. Expo + EAS supports Apple sign-in.

    ## Photo uploads
    - Use Firebase Storage with content-type validation and size limits.
    - Use Cloud Function to generate thumbnails (optional) and scan for abusive content (3rd-party API) if desired.

    ## Points & Streaks
    - Keep scoring logic server-side (Cloud Function): points for report submission, time spent, photo proof bonus, streak bonuses, and penalty/limits to prevent farming.
    - Use transactions to update user points and append activity record.

    ## Offline and resilience
    - Cache recent reports locally; allow creating a report offline and queue for upload when network returns.
    - Store queued report with attached photo in secure local storage and retry logic.

    ## Privacy and Permissions
    - Request foreground location only (no background unless you need continuous tracking). Explain why in permission prompt.
    - Request camera and photo permissions. Keep uploaded photos private by default in storage with protected access rules.

    ## Folder structure (starter)
    ```
    src/
      screens/
        MapScreen.tsx
        ReportForm.tsx
        ProfileScreen.tsx
      components/
        ReportMarker.tsx
        ClusterBubble.tsx
      services/
        firebase.ts
        api.ts  # Cloud functions client wrappers
      models/
        report.ts
      hooks/
        useLocation.ts
        useOfflineQueue.ts
      navigation/
        AppNavigator.tsx
      utils/
        scoring.ts
    app.json (or app.config.js)
    README.md
    ```

    ## Starter commands (Expo + TypeScript + EAS for Mapbox native support)
    1) Create app:
    ```
    npx create-expo-app refuserefuse --template expo-template-blank-typescript
    cd refuserefuse
    ```
    2) Add packages (initial):
    ```
    npm install firebase react-native-gesture-handler react-native-reanimated @react-navigation/native @react-navigation/native-stack react-native-maps react-native-map-clustering
    # For Mapbox (native) you'll need @rnmapbox/maps and to prebuild/EAS; or use MapLibre if you want fully OSS path.
    ```
    3) Initialize Firebase in `src/services/firebase.ts` and create Firestore/Storage buckets.
    4) When you need Mapbox native features, run `expo prebuild` and then use EAS to build for device, or follow `@rnmapbox/maps` setup docs.

    Notes: For MVP you can use `react-native-maps` + clustering to implement point markers quickly and postpone Mapbox native work until needed.

    ## Edge cases & anti-abuse
    - Users spamming reports to farm points -> limit reports per user per area per time window and require photo proof for high severity.
    - Fake photos -> consider a lightweight photo review workflow or add heuristics (file size, identical hashes across many reports) and optionally manual moderation.
    - Permission denied -> show a clear flow to let user continue by manual location entry.

    ## Quality gates (what I'll check early)
    - Lint + TypeScript compile PASS
    - Basic smoke-run of Expo app on simulator or device PASS
    - Auth sign-in flows (Google/Apple) basic PASS via Firebase
    - Map shows clustered pins PASS

    ## Next steps (I can do these for you)
    1. If you agree with Expo + Firebase, I can scaffold the Expo TypeScript project, add Firebase wiring, and create a Map screen with a sample clustered report pin and a tiny report form.
    2. Or, if you prefer Supabase/Postgres or a different map SDK, tell me which and I’ll adapt the scaffold.

    If you'd like, I can now scaffold the Expo + Firebase starter (create app files, `src/services/firebase.ts` skeleton, and a `MapScreen` that renders a sample pin). Tell me to proceed and I will create the scaffold and wire a minimal working map UI.

Getting started (local) — Expo + Supabase starter

1) Install deps

```bash
npm install
```

2) Fill in Supabase keys

- Edit `app.json` and put your `supabaseUrl` and `supabaseAnonKey` into `expo.extra`, or use EAS secrets for production.

3) Start the app

```bash
npm run start
```

Notes
- This scaffold uses `react-native-maps` for native maps and a small `MapScreen` with sample markers. To keep costs low, we avoid Mapbox by default.
- Before building for iOS/Android on real devices you may need to run `npx expo prebuild` and use EAS if you add native modules.

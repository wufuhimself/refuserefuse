export const SEVERITIES = ['light', 'moderate', 'trashy', 'urgent']

export const SEV_COLOR = {
  light: '#1cb58e',
  moderate: '#f59f00',
  trashy: '#ef476f',
  urgent: '#7c3aed',
}

export const MAP_THEMES = [
  {
    id: 'voyager',
    label: 'Voyager',
    emoji: '🌍',
    tileUrl: 'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
  },
  {
    id: 'light',
    label: 'Pastel',
    emoji: '🧊',
    tileUrl: 'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
  },
  {
    id: 'dark',
    label: 'Neon Night',
    emoji: '🌃',
    tileUrl: 'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
  },
  {
    id: 'satellite',
    label: 'Satellite',
    emoji: '🛰️',
    tileUrl: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  },
]

export const COLORS = {
  ink900: '#0f152b',
  ink800: '#16203b',
  ink700: '#24355f',
  glow: '#58d5f7',
  border: 'rgba(141, 173, 255, 0.25)',
  softBorder: 'rgba(145, 233, 208, 0.35)',
  textPrimary: '#ffffff',
  textMuted: '#d5defa',
}

export const INITIAL_REGION = {
  latitude: 39.9526,
  longitude: -75.1652,
  latitudeDelta: 0.08,
  longitudeDelta: 0.08,
}

export const WALK_RADIUS_METERS = 1609.34

export const CLEANED_MARKER_TTL_MS = 24 * 60 * 60 * 1000

export function shouldShowMarker(report) {
  if (!report?.picked_up) return true
  const timestamp = Date.parse(report.picked_up_at || report.created_at)
  if (Number.isNaN(timestamp)) return true
  return Date.now() - timestamp < CLEANED_MARKER_TTL_MS
}

export function isIncidentReport(report) {
  return String(report?.notes || '').includes('[ENVIRONMENTAL INCIDENT]')
}

export function distanceMeters(a, b) {
  const toRad = (value) => (value * Math.PI) / 180
  const earth = 6371000
  const dLat = toRad(b.latitude - a.latitude)
  const dLng = toRad(b.longitude - a.longitude)
  const lat1 = toRad(a.latitude)
  const lat2 = toRad(b.latitude)
  const hav = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * earth * Math.atan2(Math.sqrt(hav), Math.sqrt(1 - hav))
}
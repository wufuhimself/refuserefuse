import React, { useEffect, useState, useRef } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Circle, CircleMarker, useMapEvents, useMap } from 'react-leaflet'
import L from 'leaflet'
import axios from 'axios'

const API = import.meta.env.VITE_API_BASE_URL || '/api'
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''
const APPLE_CLIENT_ID = import.meta.env.VITE_APPLE_CLIENT_ID || ''
const APPLE_REDIRECT_URI = import.meta.env.VITE_APPLE_REDIRECT_URI || window.location.origin

// ── Severity config ────────────────────────────────────────────────────────────
const SEVERITIES = ['light', 'moderate', 'trashy', 'urgent']
const SEV_COLOR = { light: '#1cb58e', moderate: '#f59f00', trashy: '#ef476f', urgent: '#7c3aed' }

const MAP_THEMES = [
  {
    id: 'voyager',
    label: 'Voyager',
    emoji: '🌍',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
  },
  {
    id: 'light',
    label: 'Pastel',
    emoji: '🧊',
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
  },
  {
    id: 'dark',
    label: 'Neon Night',
    emoji: '🌃',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
  },
  {
    id: 'satellite',
    label: 'Satellite',
    emoji: '🛰️',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri',
  },
]

// ── SVG pin icon factory ───────────────────────────────────────────────────────
function makePinIcon(color, opacity = 1) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="40" viewBox="0 0 28 40"><path d="M14 0C6.27 0 0 6.27 0 14c0 9.63 14 26 14 26S28 23.63 28 14C28 6.27 21.73 0 14 0z" fill="${color}" fill-opacity="${opacity}" stroke="#fff" stroke-width="1.5"/><circle cx="14" cy="14" r="5" fill="#fff" fill-opacity="0.85"/></svg>`
  return L.divIcon({ html: svg, className: '', iconSize: [28, 40], iconAnchor: [14, 40], popupAnchor: [0, -40] })
}

const ICONS = Object.fromEntries(SEVERITIES.map(s => [s, makePinIcon(SEV_COLOR[s])]))
const PENDING_ICON = makePinIcon('#1976d2', 0.6)
const WALK_RADIUS_METERS = 1609.34
const INCIDENT_DUPLICATE_RADIUS_METERS = 120
const CLEANED_MARKER_TTL_MS = 24 * 60 * 60 * 1000
const LOCATION_SAMPLE_MIN_MS = 30000
const LOCATION_SAMPLE_MIN_DISTANCE_METERS = 50
const LOCATION_MAX_ACCEPTED_ACCURACY_M = 120
const LOCATION_BATCH_SIZE = 6
const LOCATION_BATCH_FLUSH_MS = 15000

const INCIDENT_ICON = L.divIcon({
  html: '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="38" viewBox="0 0 30 38"><path d="M15 0C6.72 0 0 6.72 0 15c0 10.35 15 23 15 23S30 25.35 30 15C30 6.72 23.28 0 15 0Z" fill="#b71c1c" stroke="#fff" stroke-width="1.6"/><path d="M15 7 8 20h14L15 7Z" fill="#fff"/><rect x="14" y="11" width="2" height="6" fill="#b71c1c"/><circle cx="15" cy="19" r="1.2" fill="#b71c1c"/></svg>',
  className: '',
  iconSize: [30, 38],
  iconAnchor: [15, 38],
  popupAnchor: [0, -38],
})

function distanceMeters(a, b) {
  const toRad = (n) => (n * Math.PI) / 180
  const earth = 6371000
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const hav = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * earth * Math.atan2(Math.sqrt(hav), Math.sqrt(1 - hav))
}

function roundCoord(value) {
  return Math.round(value * 100000) / 100000
}

function isIncidentReport(report) {
  return String(report?.notes || '').includes('[ENVIRONMENTAL INCIDENT]')
}

function getIncidentKindFromReport(report) {
  const notes = String(report?.notes || '')
  if (!notes.includes('[ENVIRONMENTAL INCIDENT]')) return null
  const typeLine = notes.split('\n').find((line) => line.startsWith('Type:'))
  if (!typeLine) return null
  if (typeLine.toLowerCase().includes('ground contamination')) return 'ground_contamination'
  if (typeLine.toLowerCase().includes('illegal dumping')) return 'illegal_dumping'
  return null
}

function getPhotoUrl(path) {
  if (!path) return ''
  return /^https?:\/\//i.test(path) ? path : `${API}${path}`
}

function shouldShowMarker(report) {
  if (!report?.picked_up) return true
  const timestamp = Date.parse(report.picked_up_at || report.created_at)
  if (Number.isNaN(timestamp)) return true
  return (Date.now() - timestamp) < CLEANED_MARKER_TTL_MS
}

// ── Sub-components ─────────────────────────────────────────────────────────────
function MapClickHandler({ onMapClick }) {
  useMapEvents({ click: (e) => onMapClick(e.latlng) })
  return null
}

function FlyToUser({ target }) {
  const map = useMap()
  useEffect(() => {
    if (!target) return
    map.flyTo([target.lat, target.lng], 16)
  }, [target, map])
  return null
}

function FlyToCleanupTarget({ target }) {
  const map = useMap()
  useEffect(() => {
    if (!target) return
    map.flyTo([target.lat, target.lng], 15)
  }, [target, map])
  return null
}

function FlyToIncidentTarget({ target }) {
  const map = useMap()
  useEffect(() => {
    if (!target) return
    map.flyTo([target.lat, target.lng], 16)
  }, [target, map])
  return null
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function MapPage() {
  const [reports, setReports]           = useState([])
  const [pending, setPending]           = useState(null)
  const [form, setForm]                 = useState({ severity: 'light', notes: '', picked_up: false })
  const [photo, setPhoto]               = useState(null)
  const [submitting, setSubmitting]     = useState(false)
  const [userLocation, setUserLocation] = useState(null)
  const [locateError, setLocateError]   = useState('')
  const [liveTracking, setLiveTracking] = useState(false)
  const [locationConsentAccepted, setLocationConsentAccepted] = useState(localStorage.getItem('rr_location_history_consent') === 'true')
  const [token, setToken]               = useState(localStorage.getItem('tg_token') || '')
  const [currentUser, setCurrentUser]   = useState(null)
  const [authMode, setAuthMode]         = useState('login')
  const [authOpen, setAuthOpen]         = useState(false)
  const [authErr, setAuthErr]           = useState('')
  const [authForm, setAuthForm]         = useState({ email: '', password: '', display_name: '' })
  const [profileOpen, setProfileOpen]   = useState(false)
  const [uploadingReportId, setUploadingReportId] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState('appearance')
  const [mapTheme, setMapTheme] = useState(localStorage.getItem('rr_map_theme') || 'voyager')
  const [uiPreset, setUiPreset] = useState(localStorage.getItem('rr_ui_preset') || 'modern')
  const [showTapHint, setShowTapHint] = useState(localStorage.getItem('rr_show_tap_hint') !== 'false')
  const [cleanupTarget, setCleanupTarget] = useState(null)
  const [cleanupMessage, setCleanupMessage] = useState('')
  const [incidentFocusTarget, setIncidentFocusTarget] = useState(null)
  const [incidentOpen, setIncidentOpen] = useState(false)
  const [incidentSubmitting, setIncidentSubmitting] = useState(false)
  const [incidentErr, setIncidentErr] = useState('')
  const [incidentForm, setIncidentForm] = useState({
    kind: 'illegal_dumping',
    suspectedParty: '',
    description: '',
    immediateHazard: false,
  })
  const [incidentPhoto, setIncidentPhoto] = useState(null)
  const watchIdRef = useRef(null)
  const trackingSessionIdRef = useRef(null)
  const pendingLocationPointsRef = useRef([])
  const locationFlushTimerRef = useRef(null)
  const lastSentLocationRef = useRef(null)
  const fileRef = useRef()
  const incidentFileRef = useRef()
  const googleRenderedRef = useRef(false)
  const appleInitRef = useRef(false)
  const activeTheme = MAP_THEMES.find((t) => t.id === mapTheme) || MAP_THEMES[0]

  function loadScriptOnce(id, src) {
    return new Promise((resolve, reject) => {
      const existing = document.getElementById(id)
      if (existing) {
        resolve()
        return
      }

      const script = document.createElement('script')
      script.id = id
      script.src = src
      script.async = true
      script.defer = true
      script.onload = () => resolve()
      script.onerror = () => reject(new Error(`Failed to load ${src}`))
      document.head.appendChild(script)
    })
  }

  useEffect(() => {
    localStorage.setItem('rr_map_theme', mapTheme)
  }, [mapTheme])

  useEffect(() => {
    localStorage.setItem('rr_ui_preset', uiPreset)
  }, [uiPreset])

  useEffect(() => {
    localStorage.setItem('rr_show_tap_hint', String(showTapHint))
  }, [showTapHint])

  useEffect(() => {
    localStorage.setItem('rr_location_history_consent', String(locationConsentAccepted))
  }, [locationConsentAccepted])

  useEffect(() => { fetchReports() }, [])
  useEffect(() => {
    if (!token) {
      setCurrentUser(null)
      localStorage.removeItem('tg_token')
      return
    }
    localStorage.setItem('tg_token', token)
    fetchMe(token)
  }, [token])

  useEffect(() => {
    if (!liveTracking) {
      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
      stopTrackingSession()
      return
    }

    if (!navigator.geolocation) {
      setLocateError('Geolocation is not available in this browser.')
      setLiveTracking(false)
      return
    }

    setLocateError('')
    startTrackingSession()
    watchIdRef.current = navigator.geolocation.watchPosition(
      ({ coords }) => {
        setUserLocation({
          lat: coords.latitude,
          lng: coords.longitude,
          accuracy: coords.accuracy,
        })
        queueLocationPoint(coords)
      },
      (error) => {
        const msg = error.code === 1
          ? 'Location permission denied. Allow location access for this site.'
          : error.code === 2
            ? 'Unable to determine your location right now.'
            : 'Location request timed out. Try again.'
        setLocateError(msg)
        setLiveTracking(false)
      },
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 3000,
      },
    )

    return () => {
      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
      stopTrackingSession()
    }
  }, [liveTracking, token])

  useEffect(() => {
    return () => {
      if (locationFlushTimerRef.current) {
        clearTimeout(locationFlushTimerRef.current)
        locationFlushTimerRef.current = null
      }
      if (trackingSessionIdRef.current && token) {
        flushQueuedLocationPoints(token)
        axios.post(`${API}/location/sessions/${trackingSessionIdRef.current}/stop`, {}, {
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => null)
      }
    }
  }, [token])

  useEffect(() => {
    let cancelled = false

    if (!authOpen) {
      googleRenderedRef.current = false
      return () => {
        cancelled = true
      }
    }

    async function initGoogleSignInButton() {
      if (!authOpen || !GOOGLE_CLIENT_ID) return

      try {
        await loadScriptOnce('google-identity-services', 'https://accounts.google.com/gsi/client')
      } catch {
        if (!cancelled) setAuthErr('Could not load Google Sign-In. Check your network or client ID settings.')
        return
      }

      if (cancelled || !window.google?.accounts?.id) return

      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async ({ credential }) => {
          if (!credential) {
            setAuthErr('Google authentication failed to provide an ID token.')
            return
          }
          await submitOAuthToken('google', credential)
        },
      })

      const mount = document.getElementById('google-signin-button')
      if (!mount || googleRenderedRef.current) return
      mount.innerHTML = ''
      window.google.accounts.id.renderButton(mount, {
        theme: 'outline',
        size: 'large',
        shape: 'pill',
        text: 'continue_with',
        width: 320,
      })
      googleRenderedRef.current = true
    }

    initGoogleSignInButton()

    return () => {
      cancelled = true
    }
  }, [authOpen])

  async function fetchReports() {
    try {
      const res = await axios.get(`${API}/reports`)
      setReports(res.data)
    } catch (err) { console.error(err) }
  }

  async function fetchMe(activeToken) {
    try {
      const res = await axios.get(`${API}/auth/me`, {
        headers: { Authorization: `Bearer ${activeToken}` },
      })
      setCurrentUser(res.data)
    } catch (err) {
      setToken('')
      setCurrentUser(null)
    }
  }

  async function startTrackingSession() {
    if (!token || trackingSessionIdRef.current) return
    try {
      const res = await axios.post(`${API}/location/sessions/start`, {
        consent_version: '2026-04-location-history-v1',
      }, {
        headers: { Authorization: `Bearer ${token}` },
      })
      trackingSessionIdRef.current = res.data.id
      pendingLocationPointsRef.current = []
      lastSentLocationRef.current = null
    } catch (err) {
      console.error(err)
      setLocateError('Could not start location history right now. Live map tracking still works.')
    }
  }

  async function flushQueuedLocationPoints(activeToken = token) {
    const sessionId = trackingSessionIdRef.current
    const queued = pendingLocationPointsRef.current
    if (!sessionId || !activeToken || queued.length === 0) return

    pendingLocationPointsRef.current = []
    try {
      await axios.post(`${API}/location/sessions/${sessionId}/points`, {
        points: queued,
      }, {
        headers: { Authorization: `Bearer ${activeToken}` },
      })
    } catch (err) {
      pendingLocationPointsRef.current = queued.concat(pendingLocationPointsRef.current).slice(-30)
      console.error(err)
    }
  }

  function scheduleLocationFlush() {
    if (locationFlushTimerRef.current) return
    locationFlushTimerRef.current = setTimeout(async () => {
      locationFlushTimerRef.current = null
      await flushQueuedLocationPoints()
    }, LOCATION_BATCH_FLUSH_MS)
  }

  function queueLocationPoint(coords) {
    if (!trackingSessionIdRef.current || !token) return
    if (typeof coords?.latitude !== 'number' || typeof coords?.longitude !== 'number') return
    if (typeof coords?.accuracy === 'number' && coords.accuracy > LOCATION_MAX_ACCEPTED_ACCURACY_M) return

    const point = {
      lat: roundCoord(coords.latitude),
      lng: roundCoord(coords.longitude),
      accuracy_m: typeof coords?.accuracy === 'number' ? Math.round(coords.accuracy) : null,
      recorded_at: new Date().toISOString(),
    }

    const now = Date.now()
    const last = lastSentLocationRef.current
    if (last) {
      const movedMeters = distanceMeters(last, point)
      const elapsed = now - last.ts
      if (elapsed < LOCATION_SAMPLE_MIN_MS && movedMeters < LOCATION_SAMPLE_MIN_DISTANCE_METERS) {
        return
      }
    }

    lastSentLocationRef.current = { lat: point.lat, lng: point.lng, ts: now }
    pendingLocationPointsRef.current.push(point)

    if (pendingLocationPointsRef.current.length >= LOCATION_BATCH_SIZE) {
      flushQueuedLocationPoints()
      return
    }
    scheduleLocationFlush()
  }

  async function stopTrackingSession() {
    if (locationFlushTimerRef.current) {
      clearTimeout(locationFlushTimerRef.current)
      locationFlushTimerRef.current = null
    }
    await flushQueuedLocationPoints()

    const sessionId = trackingSessionIdRef.current
    if (!sessionId || !token) return
    trackingSessionIdRef.current = null
    lastSentLocationRef.current = null

    try {
      await axios.post(`${API}/location/sessions/${sessionId}/stop`, {}, {
        headers: { Authorization: `Bearer ${token}` },
      })
    } catch (err) {
      console.error(err)
    }
  }

  function cancelForm() {
    setPending(null); setPhoto(null)
    setForm({ severity: 'light', notes: '', picked_up: false })
  }

  async function submitReport(e) {
    e.preventDefault()
    if (!pending) return
    if (!token) {
      setAuthMode('login')
      setAuthOpen(true)
      return
    }
    setSubmitting(true)
    try {
      const fd = new FormData()
      fd.append('lat', pending.lat); fd.append('lng', pending.lng)
      fd.append('severity', form.severity); fd.append('notes', form.notes)
      fd.append('picked_up', form.picked_up)
      if (photo) fd.append('file', photo)
      await axios.post(`${API}/reports`, fd, {
        headers: { Authorization: `Bearer ${token}` },
      })
      await fetchReports(); cancelForm()
    } catch (err) {
      console.error(err)
      alert('Failed to submit report (are you logged in?)')
    }
    finally { setSubmitting(false) }
  }

  async function togglePickedUp(report) {
    if (!token) {
      setAuthMode('login')
      setAuthOpen(true)
      return
    }
    try {
      const fd = new FormData()
      fd.append('picked_up', !report.picked_up)
      const res = await axios.patch(`${API}/reports/${report.id}`, fd, {
        headers: { Authorization: `Bearer ${token}` },
      })
      setReports(prev => prev.map(r => r.id === res.data.id ? res.data : r))
    } catch (err) { console.error(err) }
  }

  async function uploadReportPhoto(report, file) {
    if (!file || !token) return
    setUploadingReportId(report.id)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await axios.patch(`${API}/reports/${report.id}/photo`, fd, {
        headers: { Authorization: `Bearer ${token}` },
      })
      setReports(prev => prev.map(r => r.id === res.data.id ? res.data : r))
    } catch (err) {
      alert(err?.response?.data?.detail || 'Photo upload failed')
    } finally {
      setUploadingReportId(null)
    }
  }

  async function deleteReport(report) {
    if (!token) return
    const ok = window.confirm('Archive this report as a mistake? You can not restore it yet.')
    if (!ok) return

    try {
      await axios.delete(`${API}/reports/${report.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      setReports(prev => prev.filter(r => r.id !== report.id))
    } catch (err) {
      alert(err?.response?.data?.detail || 'Delete failed')
    }
  }

  function handleLocateMe() {
    if (!navigator.geolocation) {
      setLocateError('Geolocation is not available in this browser.')
      setLiveTracking(false)
      return
    }

    setLocateError('')
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setUserLocation({
          lat: coords.latitude,
          lng: coords.longitude,
          accuracy: coords.accuracy,
        })
      },
      (error) => {
        const msg = error.code === 1
          ? 'Location permission denied. Allow location access for this site.'
          : error.code === 2
            ? 'Unable to determine your location right now.'
            : 'Location request timed out. Try again.'
        setLocateError(msg)
        setLiveTracking(false)
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000,
      },
    )
  }

  function handleGpsControl() {
    if (liveTracking) {
      setLiveTracking(false)
      return
    }

    if (!token) {
      setAuthMode('login')
      setAuthOpen(true)
      setLocateError('Login required to save private location history while live tracking is active.')
      return
    }

    if (!locationConsentAccepted) {
      const consent = window.confirm(
        'While Live Tracking is ON, we save your route history to your account so you can review cleanup history over time. You can stop anytime and clear history later in settings. Continue?'
      )
      if (!consent) return
      setLocationConsentAccepted(true)
    }

    handleLocateMe()
    setLiveTracking(true)
  }

  function handleFindNearbyCleanup() {
    if (!userLocation) {
      handleLocateMe()
      setCleanupMessage('Getting your location. Tap find cleanup again in a moment.')
      return
    }

    const openReports = reports.filter((r) => !r.picked_up)
    if (openReports.length === 0) {
      setCleanupTarget(null)
      setCleanupMessage('No open cleanup spots right now. Check back soon.')
      return
    }

    const ranked = openReports
      .map((r) => ({ report: r, meters: distanceMeters(userLocation, { lat: r.lat, lng: r.lng }) }))
      .sort((a, b) => a.meters - b.meters)

    const withinWalk = ranked.find((r) => r.meters <= WALK_RADIUS_METERS)
    if (!withinWalk) {
      const nearest = ranked[0]
      setCleanupTarget(null)
      setCleanupMessage(`No spots within 1 mile. Nearest is ${(nearest.meters / 1609.34).toFixed(2)} miles away.`)
      return
    }

    setCleanupTarget({ ...withinWalk.report, distanceMeters: withinWalk.meters })
    setCleanupMessage('')
  }

  function getWalkingDirectionsUrl(target) {
    const destination = `${target.lat},${target.lng}`
    const origin = userLocation ? `${userLocation.lat},${userLocation.lng}` : null
    if (!origin) {
      return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=walking`
    }
    return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=walking`
  }

  function resetIncidentForm() {
    setIncidentForm({
      kind: 'illegal_dumping',
      suspectedParty: '',
      description: '',
      immediateHazard: false,
    })
    setIncidentPhoto(null)
    setIncidentErr('')
  }

  function openIncidentWorkflow() {
    setIncidentErr('')
    setIncidentOpen(true)
    if (!userLocation) handleLocateMe()
  }

  function buildIncidentEvidenceText() {
    const typeLabel = incidentForm.kind === 'ground_contamination' ? 'Ground contamination' : 'Illegal dumping'
    const coords = userLocation
      ? `${userLocation.lat.toFixed(5)}, ${userLocation.lng.toFixed(5)}`
      : 'Location not captured yet'

    return [
      '[ENVIRONMENTAL INCIDENT]',
      `Type: ${typeLabel}`,
      `Time recorded: ${new Date().toLocaleString()}`,
      `Location: ${coords}`,
      `Immediate hazard: ${incidentForm.immediateHazard ? 'Yes' : 'No'}`,
      `Suspected source: ${incidentForm.suspectedParty || 'Not provided'}`,
      `Details: ${incidentForm.description || 'Not provided'}`,
    ].join('\n')
  }

  async function copyIncidentSummary() {
    try {
      await navigator.clipboard.writeText(buildIncidentEvidenceText())
      setIncidentErr('Evidence summary copied. Paste it into your local and federal reporting forms.')
    } catch {
      setIncidentErr('Could not copy automatically. You can still submit this incident here.')
    }
  }

  async function submitIncident(e) {
    e.preventDefault()
    if (!userLocation) {
      setIncidentErr('Location not available yet. Tap GPS first, then try again.')
      return
    }
    if (!incidentForm.description.trim()) {
      setIncidentErr('Please add incident details so agencies can investigate.')
      return
    }
    if (nearbyIncidentDuplicate) {
      setIncidentErr('This type of incident has already been reported nearby. Please avoid duplicate reports and add evidence to the existing marker instead.')
      return
    }
    if (!token) {
      setAuthMode('login')
      setAuthOpen(true)
      setIncidentErr('Login required to save incident evidence in RefuseRefuse.')
      return
    }

    setIncidentSubmitting(true)
    setIncidentErr('')
    try {
      const fd = new FormData()
      fd.append('lat', userLocation.lat)
      fd.append('lng', userLocation.lng)
      fd.append('severity', incidentForm.kind === 'ground_contamination' ? 'urgent' : 'trashy')
      fd.append('notes', buildIncidentEvidenceText())
      fd.append('picked_up', false)
      if (incidentPhoto) fd.append('file', incidentPhoto)

      await axios.post(`${API}/reports`, fd, {
        headers: { Authorization: `Bearer ${token}` },
      })
      await fetchReports()
      setIncidentOpen(false)
      resetIncidentForm()
    } catch (err) {
      setIncidentErr(err?.response?.data?.detail || 'Failed to submit incident evidence')
    } finally {
      setIncidentSubmitting(false)
    }
  }

  async function submitAuth(e) {
    e.preventDefault()
    setAuthErr('')
    try {
      const endpoint = authMode === 'login' ? '/auth/login' : '/auth/register'
      const payload = authMode === 'login'
        ? { email: authForm.email, password: authForm.password }
        : { email: authForm.email, password: authForm.password, display_name: authForm.display_name || null }
      const res = await axios.post(`${API}${endpoint}`, payload)
      setToken(res.data.access_token)
      setAuthOpen(false)
      setAuthForm({ email: '', password: '', display_name: '' })
    } catch (err) {
      setAuthErr(err?.response?.data?.detail || 'Authentication failed')
    }
  }

  async function submitOAuthToken(provider, idToken, displayName = null) {
    setAuthErr('')
    try {
      const res = await axios.post(`${API}/auth/oauth/${provider}`, {
        id_token: idToken,
        display_name: displayName,
      })
      setToken(res.data.access_token)
      setAuthOpen(false)
      setAuthForm({ email: '', password: '', display_name: '' })
    } catch (err) {
      setAuthErr(err?.response?.data?.detail || `${provider} authentication failed`)
    }
  }

  async function handleAppleSignIn() {
    if (!APPLE_CLIENT_ID) {
      setAuthErr('Apple Sign-In is not configured. Set VITE_APPLE_CLIENT_ID in frontend/.env.')
      return
    }

    try {
      await loadScriptOnce('appleid-signin', 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js')

      if (!appleInitRef.current) {
        window.AppleID.auth.init({
          clientId: APPLE_CLIENT_ID,
          scope: 'name email',
          redirectURI: APPLE_REDIRECT_URI,
          usePopup: true,
        })
        appleInitRef.current = true
      }

      const response = await window.AppleID.auth.signIn()
      const token = response?.authorization?.id_token
      if (!token) {
        setAuthErr('Apple authentication did not return an ID token.')
        return
      }

      const firstName = response?.user?.name?.firstName || ''
      const lastName = response?.user?.name?.lastName || ''
      const displayName = `${firstName} ${lastName}`.trim() || null
      await submitOAuthToken('apple', token, displayName)
    } catch (err) {
      const maybeMessage = err?.error || err?.message || 'Apple authentication failed'
      if (!String(maybeMessage).toLowerCase().includes('popup_closed_by_user')) {
        setAuthErr(maybeMessage)
      }
    }
  }

  function logout() {
    setLiveTracking(false)
    setToken('')
    setCurrentUser(null)
  }

  const counts   = SEVERITIES.reduce((acc, s) => { acc[s] = reports.filter(r => r.severity === s && !r.picked_up).length; return acc }, {})
  const total    = reports.length
  const pickedUp = reports.filter(r => r.picked_up).length
  const userId = currentUser ? String(currentUser.id) : null
  const myReports = userId ? reports.filter(r => r.user_id === userId) : []
  const myCleanups = userId ? reports.filter(r => r.picked_up_by_user_id === userId) : []
  const myActiveReports = myReports.filter(r => !r.picked_up)
  const myRecentReports = [...myReports]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 5)
  const myRecentCleanups = [...myCleanups]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 5)
  const visibleReports = reports.filter(shouldShowMarker)
  const nearbyIncidentDuplicate = userLocation
    ? visibleReports.find((r) => {
        if (!isIncidentReport(r)) return false
        if (r.picked_up) return false
        if (getIncidentKindFromReport(r) !== incidentForm.kind) return false
        return distanceMeters(userLocation, { lat: r.lat, lng: r.lng }) <= INCIDENT_DUPLICATE_RADIUS_METERS
      })
    : null

  return (
    <div className={`app-shell ui-${uiPreset}`} style={{ height: '100vh', display: 'flex', flexDirection: 'column', fontFamily: 'Space Grotesk, Avenir Next, system-ui, sans-serif' }}>

      {/* Stats bar */}
      <div className="topbar" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', color: '#fff', flexShrink: 0, flexWrap: 'wrap', zIndex: 1000 }}>
        <span style={{ fontWeight: 800, fontSize: 16, marginRight: 4, letterSpacing: 0.2 }}>♻️ RefuseRefuse</span>
        <span style={{ fontSize: 12, color: '#d5defa', marginRight: 8 }}>{total} report{total !== 1 ? 's' : ''} · {pickedUp} cleaned</span>
        {SEVERITIES.map(s => (
          <span key={s} className="severity-chip" style={{ fontSize: 12, padding: '3px 9px', borderRadius: 999, background: SEV_COLOR[s] + '22', color: '#fff', border: `1px solid ${SEV_COLOR[s]}88`, fontWeight: 700 }}>
            {counts[s]} {s}
          </span>
        ))}
        <button
          onClick={() => {
            setSettingsTab('appearance')
            setSettingsOpen(true)
          }}
          title="Settings"
          aria-label="Open settings"
          style={{ marginLeft: 'auto', width: 34, height: 34, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#2b365a', border: '1px solid #5f6c93', color: '#fff', borderRadius: 8, cursor: 'pointer', fontSize: 16 }}
        >
          <span aria-hidden="true">⚙️</span>
        </button>
        <button
          onClick={handleGpsControl}
          title={liveTracking ? 'Stop live tracking' : 'Center on my location and enable live tracking'}
          aria-label={liveTracking ? 'Stop live tracking' : 'Center on my location and enable live tracking'}
          style={{ width: 34, height: 34, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: liveTracking ? '#2e7d32' : 'none', border: '1px solid #555', color: '#fff', borderRadius: 8, cursor: 'pointer' }}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3"/>
            <circle cx="12" cy="12" r="8" opacity="0.9"/>
            <line x1="12" y1="2" x2="12" y2="5"/>
            <line x1="12" y1="19" x2="12" y2="22"/>
            <line x1="2" y1="12" x2="5" y2="12"/>
            <line x1="19" y1="12" x2="22" y2="12"/>
          </svg>
        </button>
        {liveTracking && (
          <span style={{ fontSize: 11, padding: '4px 8px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.35)', background: 'rgba(22, 83, 38, 0.72)', color: '#fff', fontWeight: 700 }}>
            Recording location history (tracking ON)
          </span>
        )}
        {!liveTracking && locationConsentAccepted && (
          <span style={{ fontSize: 11, color: '#cfd8f3' }}>
            Location history saves only while tracking is ON.
          </span>
        )}
        <button
          onClick={handleFindNearbyCleanup}
          style={{ background: '#17324f', border: '1px solid #4a6f94', color: '#fff', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
        >
          Find cleanup ≤ 1 mile
        </button>
        <button
          onClick={openIncidentWorkflow}
          style={{ background: '#4c1d1d', border: '1px solid #925050', color: '#fff', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}
        >
          Report environmental incident
        </button>
        {!currentUser ? (
          <button
            onClick={() => { setAuthMode('login'); setAuthOpen(true) }}
            style={{ background: '#1976d2', border: 'none', color: '#fff', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontSize: 13 }}
          >
            Login
          </button>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: '#c9d3ff' }}>{currentUser.display_name || currentUser.email}</span>
            <button
              onClick={() => setProfileOpen(v => !v)}
              style={{ background: 'none', border: '1px solid #555', color: '#fff', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontSize: 13 }}
            >
              {profileOpen ? 'Hide profile' : 'Profile'}
            </button>
            <button
              onClick={logout}
              style={{ background: 'none', border: '1px solid #555', color: '#fff', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontSize: 13 }}
            >
              Logout
            </button>
          </div>
        )}
      </div>

      {/* Map */}
      <div className="map-shell" style={{ flex: 1, position: 'relative' }}>
        <MapContainer center={[39.95, -75.15]} zoom={13} style={{ height: '100%', width: '100%' }}>
          <TileLayer url={activeTheme.url} attribution={activeTheme.attribution} />
          <MapClickHandler onMapClick={setPending} />
          <FlyToUser target={userLocation} />
          <FlyToCleanupTarget target={cleanupTarget} />
          <FlyToIncidentTarget target={incidentFocusTarget} />

          {userLocation && (
            <>
              <Circle
                center={[userLocation.lat, userLocation.lng]}
                radius={Math.max(20, userLocation.accuracy)}
                pathOptions={{ color: '#1976d2', fillColor: '#1976d2', fillOpacity: 0.12, weight: 1 }}
              />
              <CircleMarker
                center={[userLocation.lat, userLocation.lng]}
                radius={7}
                pathOptions={{ color: '#fff', weight: 2, fillColor: '#1976d2', fillOpacity: 1 }}
              >
                <Popup>
                  <div style={{ minWidth: 130 }}>
                    <strong>You are here</strong>
                    <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                      Accuracy: {Math.round(userLocation.accuracy)}m
                    </div>
                  </div>
                </Popup>
              </CircleMarker>
            </>
          )}

          {cleanupTarget && (
            <Circle
              center={[cleanupTarget.lat, cleanupTarget.lng]}
              radius={55}
              pathOptions={{ color: '#00c853', fillColor: '#00c853', fillOpacity: 0.18, weight: 2 }}
            />
          )}

          {visibleReports.map(r => (
            <Marker key={`${r.id}-${r.picked_up ? 'picked' : 'open'}-${isIncidentReport(r) ? 'incident' : 'trash'}`} position={[r.lat, r.lng]} icon={isIncidentReport(r) ? INCIDENT_ICON : (ICONS[r.severity] ?? ICONS.light)} opacity={r.picked_up ? 0.4 : 1}>
              <Popup>
                <div style={{ minWidth: 180 }}>
                  {isIncidentReport(r) && (
                    <div style={{ marginBottom: 6 }}>
                      <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 999, background: '#b71c1c', color: '#fff', fontSize: 11, fontWeight: 700 }}>
                        Environmental incident
                      </span>
                    </div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 700, background: SEV_COLOR[r.severity] ?? '#888', color: '#fff' }}>{r.severity}</span>
                    {r.picked_up && <span style={{ fontSize: 12, color: '#4caf50' }}>✓ Cleaned</span>}
                  </div>
                  <div style={{ fontSize: 11, color: '#666', marginBottom: 6 }}>
                    Reported by: {r.reporter_display_name || (r.user_id ? `User ${r.user_id}` : 'Unknown')}
                    {r.picked_up ? ` | Cleaned by ${r.picked_up_by_display_name || (r.picked_up_by_user_id ? `User ${r.picked_up_by_user_id}` : 'Unknown')}` : ''}
                  </div>
                  {r.notes && <div style={{ fontSize: 13, marginBottom: 6 }}>{r.notes}</div>}
                  {r.photo_path && <img src={getPhotoUrl(r.photo_path)} alt="report" style={{ width: '100%', borderRadius: 6, marginBottom: 6 }} />}
                  <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>{new Date(r.created_at).toLocaleString()}</div>
                  <button onClick={() => togglePickedUp(r)} style={{ width: '100%', padding: '6px 0', borderRadius: 6, border: 'none', background: r.picked_up ? '#eee' : '#4caf50', color: r.picked_up ? '#555' : '#fff', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
                    {r.picked_up ? 'Mark as not cleaned' : '✓ Mark as cleaned'}
                  </button>

                  {userId && r.user_id === userId && (
                    <>
                      <label style={{ display: 'block', marginTop: 8 }}>
                        <span style={{ display: 'block', width: '100%', padding: '6px 0', borderRadius: 6, border: '1px dashed #999', textAlign: 'center', fontSize: 12, cursor: 'pointer' }}>
                          {uploadingReportId === r.id ? 'Uploading photo...' : (r.photo_path ? 'Replace photo' : 'Add photo')}
                        </span>
                        <input
                          type="file"
                          accept="image/*"
                          disabled={uploadingReportId === r.id}
                          style={{ display: 'none' }}
                          onChange={(e) => uploadReportPhoto(r, e.target.files?.[0])}
                        />
                      </label>

                      <button
                        onClick={() => deleteReport(r)}
                        style={{ width: '100%', marginTop: 8, padding: '6px 0', borderRadius: 6, border: 'none', background: '#c62828', color: '#fff', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}
                      >
                        Undo report (archive)
                      </button>
                    </>
                  )}
                </div>
              </Popup>
            </Marker>
          ))}

          {pending && <Marker position={pending} icon={PENDING_ICON} />}
        </MapContainer>

        {!pending && showTapHint && (
          <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.65)', color: '#fff', padding: '6px 16px', borderRadius: 20, fontSize: 13, pointerEvents: 'none', zIndex: 500, whiteSpace: 'nowrap' }}>
            Tap the map to report trash
          </div>
        )}

        {settingsOpen && (
          <div className="settings-overlay" onClick={() => setSettingsOpen(false)}>
            <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <h3 style={{ margin: 0, fontSize: 19 }}>Settings</h3>
                <button
                  onClick={() => setSettingsOpen(false)}
                  className="modal-close-btn"
                  aria-label="Close settings"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="1" y1="1" x2="13" y2="13"/><line x1="13" y1="1" x2="1" y2="13"/></svg>
                </button>
              </div>

              <div className="settings-tabs" role="tablist" aria-label="Settings sections">
                <button
                  type="button"
                  role="tab"
                  aria-selected={settingsTab === 'appearance'}
                  className={`settings-tab ${settingsTab === 'appearance' ? 'active' : ''}`}
                  onClick={() => setSettingsTab('appearance')}
                >
                  Appearance
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={settingsTab === 'map'}
                  className={`settings-tab ${settingsTab === 'map' ? 'active' : ''}`}
                  onClick={() => setSettingsTab('map')}
                >
                  Map
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={settingsTab === 'account'}
                  className={`settings-tab ${settingsTab === 'account' ? 'active' : ''}`}
                  onClick={() => setSettingsTab('account')}
                >
                  Account
                </button>
              </div>

              {settingsTab === 'appearance' && (
                <>
                  <div className="settings-section">
                    <div className="settings-title">Interface style</div>
                    <div className="settings-grid settings-grid-2">
                      <button
                        type="button"
                        className={`settings-choice ${uiPreset === 'modern' ? 'active' : ''}`}
                        onClick={() => setUiPreset('modern')}
                      >
                        <span>✨</span>
                        <span>Modern glass</span>
                      </button>
                      <button
                        type="button"
                        className={`settings-choice ${uiPreset === 'soft' ? 'active' : ''}`}
                        onClick={() => setUiPreset('soft')}
                      >
                        <span>🌿</span>
                        <span>Soft clean</span>
                      </button>
                    </div>
                  </div>

                  <div className="settings-section">
                    <div className="settings-title">App behavior</div>
                    <label className="settings-toggle">
                      <input
                        type="checkbox"
                        checked={showTapHint}
                        onChange={(e) => setShowTapHint(e.target.checked)}
                      />
                      <span>Show tap-to-report hint</span>
                    </label>
                    <div style={{ marginTop: 10, fontSize: 12, color: '#65718f' }}>
                      Appearance controls are local today and designed to map to future mobile settings.
                    </div>
                  </div>
                </>
              )}

              {settingsTab === 'map' && (
                <div className="settings-section">
                  <div className="settings-title">Map style</div>
                  <div className="settings-grid">
                    {MAP_THEMES.map((theme) => (
                      <button
                        key={theme.id}
                        type="button"
                        className={`settings-choice ${mapTheme === theme.id ? 'active' : ''}`}
                        onClick={() => setMapTheme(theme.id)}
                      >
                        <span>{theme.emoji}</span>
                        <span>{theme.label}</span>
                      </button>
                    ))}
                  </div>
                  <div style={{ marginTop: 10, fontSize: 12, color: '#65718f' }}>
                    More map toggles can be added here, like marker density, cluster behavior, and overlays.
                  </div>
                </div>
              )}

              {settingsTab === 'account' && (
                <div className="settings-section">
                  <div className="settings-title">Account & sync (coming soon)</div>
                  <div style={{ fontSize: 13, color: '#44537a', lineHeight: 1.5 }}>
                    This section is reserved for cross-device preferences and account-level settings.
                    Later, the same categories can be mirrored in Expo for a native app feel.
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {locateError && (
          <div style={{ position: 'absolute', top: 50, left: '50%', transform: 'translateX(-50%)', background: 'rgba(176, 0, 32, 0.92)', color: '#fff', padding: '6px 12px', borderRadius: 8, fontSize: 12, zIndex: 550, maxWidth: '90%', textAlign: 'center' }}>
            {locateError}
          </div>
        )}

        {cleanupMessage && !cleanupTarget && (
          <div style={{ position: 'absolute', top: 88, left: '50%', transform: 'translateX(-50%)', background: 'rgba(17, 34, 58, 0.92)', color: '#fff', padding: '8px 12px', borderRadius: 8, fontSize: 12, zIndex: 550, maxWidth: '92%', textAlign: 'center' }}>
            {cleanupMessage}
          </div>
        )}

        {cleanupTarget && (
          <div style={{ position: 'absolute', left: 12, bottom: 14, width: 'min(340px, calc(100% - 24px))', background: 'rgba(255,255,255,0.97)', borderRadius: 12, boxShadow: '0 10px 28px rgba(0,0,0,0.2)', zIndex: 565, padding: 12 }}>
            <div style={{ fontSize: 12, color: '#3f4f73', fontWeight: 700, marginBottom: 4 }}>Nearby cleanup target</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 12, fontWeight: 700, background: SEV_COLOR[cleanupTarget.severity] ?? '#888', color: '#fff', textTransform: 'capitalize' }}>
                {cleanupTarget.severity}
              </span>
              <span style={{ fontSize: 12, color: '#34466d' }}>
                {(cleanupTarget.distanceMeters / 1609.34).toFixed(2)} miles away
              </span>
            </div>
            {cleanupTarget.notes && <div style={{ fontSize: 13, color: '#2b3552', marginBottom: 8 }}>{cleanupTarget.notes}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <a
                href={getWalkingDirectionsUrl(cleanupTarget)}
                target="_blank"
                rel="noreferrer"
                style={{ flex: 1, textAlign: 'center', textDecoration: 'none', padding: '8px 10px', borderRadius: 8, background: '#1e88e5', color: '#fff', fontSize: 12, fontWeight: 700 }}
              >
                Open walking directions
              </a>
              <button
                onClick={() => setCleanupTarget(null)}
                style={{ border: '1px solid #c4cee4', background: '#fff', borderRadius: 8, padding: '8px 10px', color: '#34466d', fontSize: 12, cursor: 'pointer' }}
              >
                Clear
              </button>
            </div>
          </div>
        )}

        {profileOpen && currentUser && (
          <div style={{ position: 'absolute', top: 12, right: 12, width: 280, background: 'rgba(255,255,255,0.96)', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.2)', zIndex: 560, padding: 12 }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Profile</div>
            <div style={{ fontSize: 13, color: '#444', marginBottom: 10 }}>
              {currentUser.display_name || 'No display name'}
              <div style={{ fontSize: 12, color: '#666' }}>{currentUser.email}</div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div style={{ background: '#f4f7ff', borderRadius: 8, padding: 8 }}>
                <div style={{ fontSize: 11, color: '#4a5a8c' }}>My reports</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{myReports.length}</div>
              </div>
              <div style={{ background: '#eefbf3', borderRadius: 8, padding: 8 }}>
                <div style={{ fontSize: 11, color: '#2e7d32' }}>My cleanups</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{myCleanups.length}</div>
              </div>
              <div style={{ background: '#fff6ea', borderRadius: 8, padding: 8, gridColumn: '1 / span 2' }}>
                <div style={{ fontSize: 11, color: '#9f6000' }}>My active reports</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{myActiveReports.length}</div>
              </div>
            </div>

            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Recent reports</div>
              {myRecentReports.length === 0 ? (
                <div style={{ fontSize: 12, color: '#777' }}>No reports yet.</div>
              ) : (
                myRecentReports.map(r => (
                  <div key={`rep-${r.id}`} style={{ fontSize: 12, padding: '4px 0', borderBottom: '1px solid #eee' }}>
                    <span style={{ textTransform: 'capitalize', fontWeight: 600 }}>{r.severity}</span>
                    <span style={{ color: '#666' }}> · {new Date(r.created_at).toLocaleDateString()}</span>
                    <span style={{ color: r.picked_up ? '#2e7d32' : '#b26a00' }}> · {r.picked_up ? 'cleaned' : 'active'}</span>
                  </div>
                ))
              )}
            </div>

            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Recent cleanups</div>
              {myRecentCleanups.length === 0 ? (
                <div style={{ fontSize: 12, color: '#777' }}>No cleanups yet.</div>
              ) : (
                myRecentCleanups.map(r => (
                  <div key={`cln-${r.id}`} style={{ fontSize: 12, padding: '4px 0', borderBottom: '1px solid #eee' }}>
                    <span style={{ textTransform: 'capitalize', fontWeight: 600 }}>{r.severity}</span>
                    <span style={{ color: '#666' }}> · {new Date(r.created_at).toLocaleDateString()}</span>
                    <span style={{ color: '#2e7d32' }}> · cleaned</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {incidentOpen && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'grid', placeItems: 'center', zIndex: 820 }}>
            <div style={{ width: 'min(760px, 94vw)', maxHeight: '88vh', overflowY: 'auto', background: '#fff', borderRadius: 14, padding: 18, boxShadow: '0 14px 36px rgba(0,0,0,0.3)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 19 }}>Environmental Incident Workflow</h3>
                  <div style={{ fontSize: 12, color: '#5b6787', marginTop: 2 }}>
                    Document illegal dumping or contamination and escalate with evidence.
                  </div>
                </div>
                <button onClick={() => { setIncidentOpen(false); resetIncidentForm() }} className="modal-close-btn" aria-label="Close incident workflow"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="1" y1="1" x2="13" y2="13"/><line x1="13" y1="1" x2="1" y2="13"/></svg></button>
              </div>

              <form onSubmit={submitIncident}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
                  <div style={{ background: '#f8faff', border: '1px solid #dbe4f9', borderRadius: 10, padding: 12 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>1. Capture evidence</div>

                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Incident type</label>
                    <select
                      value={incidentForm.kind}
                      onChange={(e) => setIncidentForm((f) => ({ ...f, kind: e.target.value }))}
                      style={{ width: '100%', borderRadius: 8, border: '1px solid #c8d3ef', padding: '8px 10px', marginBottom: 10 }}
                    >
                      <option value="illegal_dumping">Illegal dumping</option>
                      <option value="ground_contamination">Ground contamination</option>
                    </select>

                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Suspected source (optional)</label>
                    <input
                      value={incidentForm.suspectedParty}
                      onChange={(e) => setIncidentForm((f) => ({ ...f, suspectedParty: e.target.value }))}
                      placeholder="Company, vehicle, site owner, etc."
                      style={{ width: '100%', borderRadius: 8, border: '1px solid #c8d3ef', padding: '8px 10px', marginBottom: 10 }}
                    />

                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>What did you observe?</label>
                    <textarea
                      value={incidentForm.description}
                      onChange={(e) => setIncidentForm((f) => ({ ...f, description: e.target.value }))}
                      rows={4}
                      placeholder="Describe odors, liquids, barrels, smoke, runoff, dead vegetation, timestamps, witnesses..."
                      style={{ width: '100%', boxSizing: 'border-box', borderRadius: 8, border: '1px solid #c8d3ef', padding: '8px 10px', marginBottom: 10 }}
                    />

                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 10 }}>
                      <input
                        type="checkbox"
                        checked={incidentForm.immediateHazard}
                        onChange={(e) => setIncidentForm((f) => ({ ...f, immediateHazard: e.target.checked }))}
                      />
                      Immediate hazard to people, animals, or waterways
                    </label>

                    <button
                      type="button"
                      onClick={() => incidentFileRef.current?.click()}
                      style={{ width: '100%', borderRadius: 8, border: '1px dashed #90a3d5', background: '#f2f6ff', padding: '8px 10px', fontSize: 12, cursor: 'pointer' }}
                    >
                      {incidentPhoto ? `Attached: ${incidentPhoto.name}` : 'Attach evidence photo'}
                    </button>
                    <input
                      ref={incidentFileRef}
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={(e) => setIncidentPhoto(e.target.files?.[0] ?? null)}
                    />

                    {nearbyIncidentDuplicate && (
                      <div style={{ marginTop: 10, padding: 8, borderRadius: 8, background: '#fff3f3', border: '1px solid #f1c9c9', fontSize: 12, color: '#7f1d1d' }}>
                        Similar incident already reported nearby. Please avoid duplicate reports.
                        <button
                          type="button"
                          onClick={() => {
                            setIncidentFocusTarget({ lat: nearbyIncidentDuplicate.lat, lng: nearbyIncidentDuplicate.lng })
                            setIncidentOpen(false)
                            setIncidentErr('')
                          }}
                          style={{ marginTop: 8, width: '100%', borderRadius: 8, border: '1px solid #d5a8a8', background: '#fff', color: '#7f1d1d', padding: '6px 8px', fontSize: 12, cursor: 'pointer', fontWeight: 700 }}
                        >
                          View existing report
                        </button>
                      </div>
                    )}
                  </div>

                  <div style={{ background: '#fff8f8', border: '1px solid #f0d6d6', borderRadius: 10, padding: 12 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>2. Escalate to agencies</div>
                    <div style={{ fontSize: 12, color: '#4f5670', lineHeight: 1.6, marginBottom: 10 }}>
                      Keep facts objective. Include time, location, photos, and observed impacts.
                    </div>
                    <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 7, fontSize: 12, color: '#2f3550' }}>
                      <li>
                        State agency reporting guidance based on report location (coming soon).
                      </li>
                      <li>
                        EPA environmental violations portal:{' '}
                        <a href="https://echo.epa.gov/report-environmental-violations" target="_blank" rel="noreferrer">echo.epa.gov report violations</a>
                      </li>
                      <li>
                        Hazardous spill emergency reporting:{' '}
                        <a href="https://www.nrc.uscg.mil/" target="_blank" rel="noreferrer">National Response Center</a>{' '}
                        (1-800-424-8802)
                      </li>
                      <li>
                        If there is immediate danger, call 911 first, then file agency reports.
                      </li>
                    </ol>

                    <div style={{ marginTop: 12, padding: 10, background: '#fff', border: '1px solid #e2e6f3', borderRadius: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Evidence summary preview</div>
                      <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 11, color: '#36405f', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                        {buildIncidentEvidenceText()}
                      </pre>
                    </div>

                    <button
                      type="button"
                      onClick={copyIncidentSummary}
                      style={{ marginTop: 10, width: '100%', borderRadius: 8, border: '1px solid #c8d3ef', background: '#fff', padding: '8px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
                    >
                      Copy summary for agency forms
                    </button>
                  </div>
                </div>

                {incidentErr && (
                  <div style={{ marginTop: 10, fontSize: 12, color: '#b00020' }}>{incidentErr}</div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
                  <button
                    type="button"
                    onClick={() => { setIncidentOpen(false); resetIncidentForm() }}
                    style={{ border: '1px solid #cad3ea', background: '#fff', color: '#34466d', borderRadius: 8, padding: '8px 12px', cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={incidentSubmitting || Boolean(nearbyIncidentDuplicate)}
                    style={{ border: 'none', background: (incidentSubmitting || nearbyIncidentDuplicate) ? '#8a97b3' : '#b71c1c', color: '#fff', borderRadius: 8, padding: '8px 14px', cursor: (incidentSubmitting || nearbyIncidentDuplicate) ? 'default' : 'pointer', fontWeight: 700 }}
                  >
                    {incidentSubmitting ? 'Saving evidence...' : (nearbyIncidentDuplicate ? 'Nearby incident already reported' : 'Save incident evidence')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {pending && (
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: '#fff', borderRadius: '16px 16px 0 0', boxShadow: '0 -4px 24px rgba(0,0,0,0.22)', padding: '20px 20px 32px', zIndex: 500 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ margin: 0, fontSize: 16 }}>New Trash Report</h3>
              <button onClick={cancelForm} className="modal-close-btn" aria-label="Close report form"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="1" y1="1" x2="13" y2="13"/><line x1="13" y1="1" x2="1" y2="13"/></svg></button>
            </div>

            <form onSubmit={submitReport}>
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 8 }}>Severity</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {SEVERITIES.map(s => (
                    <button key={s} type="button" onClick={() => setForm(f => ({ ...f, severity: s }))}
                      style={{ flex: 1, padding: '7px 0', borderRadius: 8, border: '2px solid', borderColor: form.severity === s ? SEV_COLOR[s] : '#ddd', background: form.severity === s ? SEV_COLOR[s] : '#f9f9f9', color: form.severity === s ? '#fff' : '#555', fontWeight: 600, fontSize: 11, cursor: 'pointer', textTransform: 'capitalize' }}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 6 }}>Notes</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional description..." rows={2}
                  style={{ width: '100%', boxSizing: 'border-box', borderRadius: 8, border: '1px solid #ddd', padding: '8px 10px', fontSize: 13, resize: 'none', outline: 'none' }} />
              </div>

              <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" id="picked_up" checked={form.picked_up} onChange={e => setForm(f => ({ ...f, picked_up: e.target.checked }))} style={{ width: 16, height: 16, cursor: 'pointer' }} />
                <label htmlFor="picked_up" style={{ fontSize: 13, cursor: 'pointer' }}>I already cleaned it up</label>
              </div>

              <div style={{ marginBottom: 16 }}>
                <button type="button" onClick={() => fileRef.current.click()}
                  style={{ padding: '7px 14px', borderRadius: 8, border: '1px dashed #bbb', background: '#f9f9f9', cursor: 'pointer', fontSize: 13, color: '#555' }}>
                  {photo ? `📷 ${photo.name}` : '📷 Add photo (optional)'}
                </button>
                <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => setPhoto(e.target.files[0] ?? null)} />
              </div>

              <button type="submit" disabled={submitting}
                style={{ width: '100%', padding: '13px 0', borderRadius: 10, border: 'none', background: submitting ? '#aaa' : '#1976d2', color: '#fff', fontWeight: 700, fontSize: 15, cursor: submitting ? 'default' : 'pointer' }}>
                {submitting ? 'Submitting…' : 'Submit Report'}
              </button>
            </form>
          </div>
        )}

        {authOpen && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'grid', placeItems: 'center', zIndex: 800 }}>
            <div style={{ width: 'min(420px, 92vw)', background: '#fff', borderRadius: 12, padding: 18, boxShadow: '0 8px 28px rgba(0,0,0,0.28)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <h3 style={{ margin: 0, fontSize: 18 }}>{authMode === 'login' ? 'Login' : 'Create account'}</h3>
                <button onClick={() => setAuthOpen(false)} className="modal-close-btn" aria-label="Close authentication dialog"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="1" y1="1" x2="13" y2="13"/><line x1="13" y1="1" x2="1" y2="13"/></svg></button>
              </div>

              <form onSubmit={submitAuth}>
                <div style={{ marginBottom: 12, display: 'grid', gap: 8 }}>
                  <div id="google-signin-button" style={{ display: 'flex', justifyContent: 'center' }} />
                  <button
                    type="button"
                    onClick={handleAppleSignIn}
                    style={{ width: '100%', border: '1px solid #d4daee', borderRadius: 999, padding: '10px 12px', background: '#fff', color: '#1f2743', fontWeight: 700, cursor: 'pointer' }}
                  >
                    Continue with Apple
                  </button>
                  <div style={{ textAlign: 'center', fontSize: 11, color: '#65718f' }}>or continue with email</div>
                </div>

                {authMode === 'register' && (
                  <div style={{ marginBottom: 10 }}>
                    <label style={{ fontSize: 12, fontWeight: 600 }}>Display Name</label>
                    <input
                      value={authForm.display_name}
                      onChange={(e) => setAuthForm(f => ({ ...f, display_name: e.target.value }))}
                      style={{ width: '100%', marginTop: 4, padding: '8px 10px', borderRadius: 8, border: '1px solid #ddd' }}
                    />
                  </div>
                )}

                <div style={{ marginBottom: 10 }}>
                  <label style={{ fontSize: 12, fontWeight: 600 }}>Email</label>
                  <input
                    required
                    type="email"
                    value={authForm.email}
                    onChange={(e) => setAuthForm(f => ({ ...f, email: e.target.value }))}
                    style={{ width: '100%', marginTop: 4, padding: '8px 10px', borderRadius: 8, border: '1px solid #ddd' }}
                  />
                </div>

                <div style={{ marginBottom: 10 }}>
                  <label style={{ fontSize: 12, fontWeight: 600 }}>Password</label>
                  <input
                    required
                    type="password"
                    value={authForm.password}
                    onChange={(e) => setAuthForm(f => ({ ...f, password: e.target.value }))}
                    style={{ width: '100%', marginTop: 4, padding: '8px 10px', borderRadius: 8, border: '1px solid #ddd' }}
                  />
                </div>

                {authErr && <div style={{ color: '#b00020', fontSize: 12, marginBottom: 10 }}>{authErr}</div>}

                <button type="submit" style={{ width: '100%', border: 'none', borderRadius: 8, padding: '10px 12px', background: '#1976d2', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
                  {authMode === 'login' ? 'Login' : 'Create account'}
                </button>
              </form>

              <div style={{ marginTop: 10, fontSize: 12, textAlign: 'center' }}>
                {authMode === 'login' ? "Need an account?" : 'Already have an account?'}{' '}
                <button
                  onClick={() => { setAuthErr(''); setAuthMode(authMode === 'login' ? 'register' : 'login') }}
                  style={{ border: 'none', background: 'none', color: '#1976d2', cursor: 'pointer', padding: 0 }}
                >
                  {authMode === 'login' ? 'Register' : 'Login'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

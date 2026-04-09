import React, { useEffect, useState, useRef } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Circle, CircleMarker, useMapEvents, useMap } from 'react-leaflet'
import L from 'leaflet'
import axios from 'axios'

const API = 'http://localhost:8000'

// ── Severity config ────────────────────────────────────────────────────────────
const SEVERITIES = ['light', 'moderate', 'trashy', 'urgent']
const SEV_COLOR = { light: '#4caf50', moderate: '#ff9800', trashy: '#f44336', urgent: '#9c27b0' }

// ── SVG pin icon factory ───────────────────────────────────────────────────────
function makePinIcon(color, opacity = 1) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="40" viewBox="0 0 28 40"><path d="M14 0C6.27 0 0 6.27 0 14c0 9.63 14 26 14 26S28 23.63 28 14C28 6.27 21.73 0 14 0z" fill="${color}" fill-opacity="${opacity}" stroke="#fff" stroke-width="1.5"/><circle cx="14" cy="14" r="5" fill="#fff" fill-opacity="0.85"/></svg>`
  return L.divIcon({ html: svg, className: '', iconSize: [28, 40], iconAnchor: [14, 40], popupAnchor: [0, -40] })
}

const ICONS = Object.fromEntries(SEVERITIES.map(s => [s, makePinIcon(SEV_COLOR[s])]))
const PENDING_ICON = makePinIcon('#1976d2', 0.6)

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
  const [token, setToken]               = useState(localStorage.getItem('tg_token') || '')
  const [currentUser, setCurrentUser]   = useState(null)
  const [authMode, setAuthMode]         = useState('login')
  const [authOpen, setAuthOpen]         = useState(false)
  const [authErr, setAuthErr]           = useState('')
  const [authForm, setAuthForm]         = useState({ email: '', password: '', display_name: '' })
  const [profileOpen, setProfileOpen]   = useState(false)
  const [uploadingReportId, setUploadingReportId] = useState(null)
  const watchIdRef = useRef(null)
  const fileRef = useRef()

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
      return
    }

    if (!navigator.geolocation) {
      setLocateError('Geolocation is not available in this browser.')
      setLiveTracking(false)
      return
    }

    setLocateError('')
    watchIdRef.current = navigator.geolocation.watchPosition(
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
        timeout: 12000,
        maximumAge: 3000,
      },
    )

    return () => {
      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
    }
  }, [liveTracking])

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
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000,
      },
    )
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

  function logout() {
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

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', fontFamily: 'system-ui, sans-serif' }}>

      {/* Stats bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', background: '#1a1a2e', color: '#fff', flexShrink: 0, flexWrap: 'wrap', zIndex: 1000 }}>
        <span style={{ fontWeight: 700, fontSize: 15, marginRight: 4 }}>♻️ RefuseRefuse</span>
        <span style={{ fontSize: 12, color: '#aaa', marginRight: 8 }}>{total} report{total !== 1 ? 's' : ''} · {pickedUp} cleaned</span>
        {SEVERITIES.map(s => (
          <span key={s} style={{ fontSize: 12, padding: '2px 8px', borderRadius: 12, background: SEV_COLOR[s] + '33', color: SEV_COLOR[s], fontWeight: 600 }}>
            {counts[s]} {s}
          </span>
        ))}
        <button onClick={handleLocateMe} style={{ marginLeft: 'auto', background: 'none', border: '1px solid #555', color: '#fff', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontSize: 13 }}>
          📍 My location
        </button>
        <button
          onClick={() => setLiveTracking(v => !v)}
          style={{ background: liveTracking ? '#2e7d32' : 'none', border: '1px solid #555', color: '#fff', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontSize: 13 }}
        >
          {liveTracking ? 'Live tracking on' : 'Live tracking off'}
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
      <div style={{ flex: 1, position: 'relative' }}>
        <MapContainer center={[39.95, -75.15]} zoom={13} style={{ height: '100%', width: '100%' }}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' />
          <MapClickHandler onMapClick={setPending} />
          <FlyToUser target={userLocation} />

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

          {reports.map(r => (
            <Marker key={r.id} position={[r.lat, r.lng]} icon={ICONS[r.severity] ?? ICONS.light} opacity={r.picked_up ? 0.4 : 1}>
              <Popup>
                <div style={{ minWidth: 180 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 700, background: SEV_COLOR[r.severity] ?? '#888', color: '#fff' }}>{r.severity}</span>
                    {r.picked_up && <span style={{ fontSize: 12, color: '#4caf50' }}>✓ Cleaned</span>}
                  </div>
                  <div style={{ fontSize: 11, color: '#666', marginBottom: 6 }}>
                    Reported by: {r.reporter_display_name || (r.user_id ? `User ${r.user_id}` : 'Unknown')}
                    {r.picked_up ? ` | Cleaned by ${r.picked_up_by_display_name || (r.picked_up_by_user_id ? `User ${r.picked_up_by_user_id}` : 'Unknown')}` : ''}
                  </div>
                  {r.notes && <div style={{ fontSize: 13, marginBottom: 6 }}>{r.notes}</div>}
                  {r.photo_path && <img src={`${API}${r.photo_path}`} alt="report" style={{ width: '100%', borderRadius: 6, marginBottom: 6 }} />}
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

        {!pending && (
          <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.65)', color: '#fff', padding: '6px 16px', borderRadius: 20, fontSize: 13, pointerEvents: 'none', zIndex: 500, whiteSpace: 'nowrap' }}>
            Tap the map to report trash
          </div>
        )}

        {locateError && (
          <div style={{ position: 'absolute', top: 50, left: '50%', transform: 'translateX(-50%)', background: 'rgba(176, 0, 32, 0.92)', color: '#fff', padding: '6px 12px', borderRadius: 8, fontSize: 12, zIndex: 550, maxWidth: '90%', textAlign: 'center' }}>
            {locateError}
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

        {pending && (
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: '#fff', borderRadius: '16px 16px 0 0', boxShadow: '0 -4px 24px rgba(0,0,0,0.22)', padding: '20px 20px 32px', zIndex: 500 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ margin: 0, fontSize: 16 }}>New Trash Report</h3>
              <button onClick={cancelForm} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#666', lineHeight: 1 }}>×</button>
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
                <button onClick={() => setAuthOpen(false)} style={{ background: 'none', border: 'none', fontSize: 22, lineHeight: 1, cursor: 'pointer' }}>×</button>
              </div>

              <form onSubmit={submitAuth}>
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

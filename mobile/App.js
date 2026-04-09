import React, { useEffect, useRef, useState } from 'react'
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import MapView, { Circle, Marker, UrlTile } from 'react-native-maps'
import { LinearGradient } from 'expo-linear-gradient'
import { StatusBar } from 'expo-status-bar'
import * as AppleAuthentication from 'expo-apple-authentication'
import * as Google from 'expo-auth-session/providers/google'
import * as Location from 'expo-location'
import * as WebBrowser from 'expo-web-browser'
import { Ionicons } from '@expo/vector-icons'
import { useFonts, SpaceGrotesk_400Regular, SpaceGrotesk_500Medium, SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk'

import {
  COLORS,
  INITIAL_REGION,
  MAP_THEMES,
  SEVERITIES,
  SEV_COLOR,
  WALK_RADIUS_METERS,
  distanceMeters,
  isIncidentReport,
  shouldShowMarker,
} from './src/theme'
import { loadReports, resolveApiBaseUrl } from './src/api'

WebBrowser.maybeCompleteAuthSession()

const GOOGLE_EXPO_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_EXPO_CLIENT_ID || ''
const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || ''
const GOOGLE_ANDROID_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || ''

function AppContent() {
  const mapRef = useRef(null)
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [dataSource, setDataSource] = useState('live')
  const [loadError, setLoadError] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState('appearance')
  const [authOpen, setAuthOpen] = useState(false)
  const [authErr, setAuthErr] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [token, setToken] = useState('')
  const [currentUser, setCurrentUser] = useState(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [incidentOpen, setIncidentOpen] = useState(false)
  const [selectedReport, setSelectedReport] = useState(null)
  const [mapTheme, setMapTheme] = useState('voyager')
  const [uiPreset, setUiPreset] = useState('modern')
  const [showTapHint, setShowTapHint] = useState(true)
  const [userLocation, setUserLocation] = useState(null)
  const [locateError, setLocateError] = useState('')
  const [cleanupTarget, setCleanupTarget] = useState(null)
  const [cleanupMessage, setCleanupMessage] = useState('')
  const [pendingCoordinate, setPendingCoordinate] = useState(null)
  const [reportDraft, setReportDraft] = useState({ severity: 'light', notes: '', picked_up: false })
  const [apiBaseUrl] = useState(resolveApiBaseUrl())
  const [googleRequest, googleResponse, promptGoogleSignIn] = Google.useIdTokenAuthRequest({
    expoClientId: GOOGLE_EXPO_CLIENT_ID || undefined,
    iosClientId: GOOGLE_IOS_CLIENT_ID || undefined,
    androidClientId: GOOGLE_ANDROID_CLIENT_ID || undefined,
  })
  const activeTheme = MAP_THEMES.find((theme) => theme.id === mapTheme) || MAP_THEMES[0]
  const visibleReports = reports.filter(shouldShowMarker)
  const counts = SEVERITIES.reduce((accumulator, severity) => {
    accumulator[severity] = reports.filter((report) => report.severity === severity && !report.picked_up).length
    return accumulator
  }, {})
  const total = reports.length
  const pickedUp = reports.filter((report) => report.picked_up).length
  const myReports = reports.slice(0, 4)

  useEffect(() => {
    let mounted = true

    async function refreshReports() {
      setLoading(true)
      const result = await loadReports()
      if (!mounted) return
      setReports(result.reports)
      setDataSource(result.source)
      setLoadError(result.error)
      setLoading(false)
    }

    refreshReports()

    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    if (!googleResponse) return
    if (googleResponse.type !== 'success') return

    const idToken = googleResponse.authentication?.idToken || googleResponse.params?.id_token
    if (!idToken) {
      setAuthErr('Google sign-in did not return an ID token.')
      return
    }

    submitOAuthToken('google', idToken)
  }, [googleResponse])

  useEffect(() => {
    if (!token) {
      setCurrentUser(null)
      return
    }

    fetchCurrentUser(token)
  }, [token])

  async function fetchCurrentUser(activeToken) {
    try {
      const res = await fetch(`${apiBaseUrl}/auth/me`, {
        headers: { Authorization: `Bearer ${activeToken}` },
      })
      if (!res.ok) throw new Error('Auth session expired')
      const data = await res.json()
      setCurrentUser(data)
    } catch {
      setToken('')
      setCurrentUser(null)
    }
  }

  async function submitOAuthToken(provider, idToken, displayName = null) {
    setAuthErr('')
    setAuthBusy(true)
    try {
      const res = await fetch(`${apiBaseUrl}/auth/oauth/${provider}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_token: idToken, display_name: displayName }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({ detail: `${provider} authentication failed` }))
        throw new Error(body?.detail || `${provider} authentication failed`)
      }

      const body = await res.json()
      setToken(body.access_token)
      setAuthOpen(false)
    } catch (err) {
      setAuthErr(err?.message || `${provider} authentication failed`)
    } finally {
      setAuthBusy(false)
    }
  }

  async function handleGoogleSignIn() {
    if (!googleRequest) {
      setAuthErr('Google sign-in is not configured. Set EXPO_PUBLIC_GOOGLE_* client IDs.')
      return
    }
    await promptGoogleSignIn()
  }

  async function handleAppleSignIn() {
    if (Platform.OS !== 'ios') {
      setAuthErr('Apple Sign-In is only available on iOS devices.')
      return
    }

    const available = await AppleAuthentication.isAvailableAsync()
    if (!available) {
      setAuthErr('Apple Sign-In is not available on this device.')
      return
    }

    setAuthErr('')
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      })

      if (!credential.identityToken) {
        throw new Error('Apple Sign-In did not return an ID token.')
      }

      const fullName = `${credential.fullName?.givenName || ''} ${credential.fullName?.familyName || ''}`.trim() || null
      await submitOAuthToken('apple', credential.identityToken, fullName)
    } catch (err) {
      const code = err?.code || ''
      if (code !== 'ERR_REQUEST_CANCELED') {
        setAuthErr(err?.message || 'Apple sign-in failed')
      }
    }
  }

  function logout() {
    setToken('')
    setCurrentUser(null)
    setProfileOpen(false)
  }

  async function handleLocateMe() {
    setLocateError('')
    const permission = await Location.requestForegroundPermissionsAsync()
    if (permission.status !== 'granted') {
      setLocateError('Location permission denied. Grant access to center the map and find nearby cleanup targets.')
      return
    }

    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
    const nextLocation = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy || 0,
    }

    setUserLocation(nextLocation)
    mapRef.current?.animateToRegion({
      latitude: nextLocation.latitude,
      longitude: nextLocation.longitude,
      latitudeDelta: 0.02,
      longitudeDelta: 0.02,
    })
  }

  function handleFindCleanup() {
    if (!userLocation) {
      setCleanupTarget(null)
      setCleanupMessage('Get your location first, then the app can rank nearby cleanup targets.')
      return
    }

    const openReports = visibleReports.filter((report) => !report.picked_up && !isIncidentReport(report))
    if (openReports.length === 0) {
      setCleanupTarget(null)
      setCleanupMessage('No open cleanup spots right now.')
      return
    }

    const ranked = openReports
      .map((report) => ({
        report,
        meters: distanceMeters(userLocation, { latitude: report.lat, longitude: report.lng }),
      }))
      .sort((left, right) => left.meters - right.meters)

    const withinWalk = ranked.find((entry) => entry.meters <= WALK_RADIUS_METERS)
    if (!withinWalk) {
      const nearest = ranked[0]
      setCleanupTarget(null)
      setCleanupMessage(`No targets within 1 mile. Nearest is ${(nearest.meters / 1609.34).toFixed(2)} miles away.`)
      return
    }

    setCleanupTarget({ ...withinWalk.report, distanceMeters: withinWalk.meters })
    setCleanupMessage('')
    mapRef.current?.animateToRegion({
      latitude: withinWalk.report.lat,
      longitude: withinWalk.report.lng,
      latitudeDelta: 0.02,
      longitudeDelta: 0.02,
    })
  }

  function openReportComposer(coordinate) {
    setPendingCoordinate(coordinate)
    setReportOpen(true)
  }

  async function refreshReports() {
    setLoading(true)
    const result = await loadReports()
    setReports(result.reports)
    setDataSource(result.source)
    setLoadError(result.error)
    setLoading(false)
  }

  return (
    <LinearGradient colors={[COLORS.ink900, COLORS.ink800, COLORS.ink700]} start={{ x: 0.05, y: 0.05 }} end={{ x: 1, y: 1 }} style={styles.screen}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safeArea}>
        <View style={[styles.topbar, uiPreset === 'soft' ? styles.topbarSoft : null]}>
          <View style={styles.brandBlock}>
            <Text style={styles.brand}>RefuseRefuse</Text>
            <Text style={styles.subtitle}>
              {total} reports · {pickedUp} cleaned · {dataSource === 'live' ? 'live backend' : 'demo fallback'}
              {currentUser ? ` · ${currentUser.display_name || currentUser.email}` : ''}
            </Text>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
            {SEVERITIES.map((severity) => (
              <View key={severity} style={[styles.severityChip, { backgroundColor: `${SEV_COLOR[severity]}22`, borderColor: `${SEV_COLOR[severity]}88` }]}>
                <Text style={styles.severityChipText}>{counts[severity]} {severity}</Text>
              </View>
            ))}
          </ScrollView>

          <View style={styles.actionsRow}>
            <HeaderButton icon="settings-outline" label="Settings" onPress={() => { setSettingsTab('appearance'); setSettingsOpen(true) }} />
            <HeaderButton icon="locate-outline" label="Locate" onPress={handleLocateMe} />
            <HeaderButton icon="walk-outline" label="Cleanup" onPress={handleFindCleanup} />
            <HeaderButton icon="warning-outline" label="Incident" onPress={() => setIncidentOpen(true)} accent="#4c1d1d" border="#925050" />
            {currentUser ? (
              <HeaderButton icon="person-outline" label="Profile" onPress={() => setProfileOpen(true)} />
            ) : (
              <HeaderButton icon="log-in-outline" label="Login" onPress={() => setAuthOpen(true)} />
            )}
          </View>
        </View>

        <View style={[styles.mapShell, uiPreset === 'soft' ? styles.mapShellSoft : null]}>
          <MapView
            ref={mapRef}
            style={StyleSheet.absoluteFill}
            initialRegion={INITIAL_REGION}
            onPress={(event) => openReportComposer(event.nativeEvent.coordinate)}
            onPanDrag={() => setSelectedReport(null)}
          >
            <UrlTile urlTemplate={activeTheme.tileUrl} maximumZ={20} zIndex={-1} />

            {userLocation ? (
              <Circle
                center={{ latitude: userLocation.latitude, longitude: userLocation.longitude }}
                radius={Math.max(20, userLocation.accuracy)}
                strokeColor="#1976d2"
                fillColor="rgba(25, 118, 210, 0.12)"
              />
            ) : null}

            {cleanupTarget ? (
              <Circle
                center={{ latitude: cleanupTarget.lat, longitude: cleanupTarget.lng }}
                radius={55}
                strokeColor="#00c853"
                fillColor="rgba(0, 200, 83, 0.18)"
              />
            ) : null}

            {visibleReports.map((report) => (
              <Marker
                key={String(report.id)}
                coordinate={{ latitude: report.lat, longitude: report.lng }}
                pinColor={isIncidentReport(report) ? '#b71c1c' : SEV_COLOR[report.severity] || SEV_COLOR.light}
                opacity={report.picked_up ? 0.45 : 1}
                onPress={() => setSelectedReport(report)}
              />
            ))}

            {pendingCoordinate ? (
              <Marker
                coordinate={{ latitude: pendingCoordinate.latitude, longitude: pendingCoordinate.longitude }}
                pinColor="#1976d2"
              />
            ) : null}
          </MapView>

          {!reportOpen && showTapHint ? (
            <View style={styles.tapHint}>
              <Text style={styles.tapHintText}>Tap the map to report trash</Text>
            </View>
          ) : null}

          {loadError ? (
            <View style={styles.bannerWarning}>
              <Text style={styles.bannerText}>Using demo data. Point mobile at {apiBaseUrl} or set EXPO_PUBLIC_API_BASE_URL.</Text>
            </View>
          ) : null}

          {locateError ? (
            <View style={styles.toastError}>
              <Text style={styles.toastText}>{locateError}</Text>
            </View>
          ) : null}

          {cleanupMessage ? (
            <View style={styles.toastInfo}>
              <Text style={styles.toastText}>{cleanupMessage}</Text>
            </View>
          ) : null}

          {cleanupTarget ? (
            <View style={styles.cleanupCard}>
              <Text style={styles.cleanupLabel}>Nearby cleanup target</Text>
              <View style={styles.cleanupMetaRow}>
                <View style={[styles.cleanupBadge, { backgroundColor: SEV_COLOR[cleanupTarget.severity] || '#888' }]}>
                  <Text style={styles.cleanupBadgeText}>{cleanupTarget.severity}</Text>
                </View>
                <Text style={styles.cleanupDistance}>{(cleanupTarget.distanceMeters / 1609.34).toFixed(2)} miles away</Text>
              </View>
              <Text style={styles.cleanupNotes}>{cleanupTarget.notes || 'No extra notes on this cleanup target.'}</Text>
              <TouchableOpacity style={styles.secondaryButton} onPress={() => setCleanupTarget(null)}>
                <Text style={styles.secondaryButtonText}>Clear target</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {selectedReport ? <ReportCard report={selectedReport} onClose={() => setSelectedReport(null)} /> : null}

          <View style={styles.fabStack}>
            <TouchableOpacity style={styles.refreshFab} onPress={refreshReports}>
              <Ionicons name="refresh" size={18} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.reportFab} onPress={() => openReportComposer(userLocation || { latitude: INITIAL_REGION.latitude, longitude: INITIAL_REGION.longitude })}>
              <Ionicons name="add" size={20} color="#fff" />
              <Text style={styles.reportFabText}>Report</Text>
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.loadingOverlay}>
              <Text style={styles.loadingText}>Loading map data…</Text>
            </View>
          ) : null}
        </View>

        <SettingsModal
          visible={settingsOpen}
          settingsTab={settingsTab}
          onTabChange={setSettingsTab}
          mapTheme={mapTheme}
          uiPreset={uiPreset}
          showTapHint={showTapHint}
          onClose={() => setSettingsOpen(false)}
          onMapThemeChange={setMapTheme}
          onUiPresetChange={setUiPreset}
          onShowTapHintChange={setShowTapHint}
        />

        <AuthModal
          visible={authOpen}
          authBusy={authBusy}
          authErr={authErr}
          onClose={() => setAuthOpen(false)}
          onGoogleSignIn={handleGoogleSignIn}
          onAppleSignIn={handleAppleSignIn}
        />

        <ProfileModal
          visible={profileOpen}
          onClose={() => setProfileOpen(false)}
          reports={reports}
          myReports={myReports}
          currentUser={currentUser}
          onLogout={logout}
        />

        <ReportComposer
          visible={reportOpen}
          draft={reportDraft}
          coordinate={pendingCoordinate}
          onClose={() => setReportOpen(false)}
          onDraftChange={setReportDraft}
        />

        <IncidentModal visible={incidentOpen} onClose={() => setIncidentOpen(false)} userLocation={userLocation} />
      </SafeAreaView>
    </LinearGradient>
  )
}

function HeaderButton({ accent = '#2b365a', border = '#5f6c93', icon, label, onPress }) {
  return (
    <TouchableOpacity style={[styles.headerButton, { backgroundColor: accent, borderColor: border }]} onPress={onPress}>
      <Ionicons name={icon} size={16} color="#fff" />
      <Text style={styles.headerButtonText}>{label}</Text>
    </TouchableOpacity>
  )
}

function SettingsModal({
  visible,
  settingsTab,
  onTabChange,
  mapTheme,
  uiPreset,
  showTapHint,
  onClose,
  onMapThemeChange,
  onUiPresetChange,
  onShowTapHintChange,
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <Pressable style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Settings</Text>
            <TouchableOpacity style={styles.modalCloseButton} onPress={onClose}>
              <Ionicons name="close" size={18} color="#44537a" />
            </TouchableOpacity>
          </View>

          <View style={styles.tabsRow}>
            {['appearance', 'map', 'account'].map((tab) => (
              <TouchableOpacity key={tab} style={[styles.tabButton, settingsTab === tab ? styles.tabButtonActive : null]} onPress={() => onTabChange(tab)}>
                <Text style={[styles.tabButtonText, settingsTab === tab ? styles.tabButtonTextActive : null]}>{tab}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {settingsTab === 'appearance' ? (
            <View style={styles.sectionBlock}>
              <Text style={styles.sectionTitle}>Interface style</Text>
              <View style={styles.choiceGrid}>
                {[
                  { value: 'modern', label: 'Modern glass', emoji: '✨' },
                  { value: 'soft', label: 'Soft clean', emoji: '🌿' },
                ].map((choice) => (
                  <TouchableOpacity key={choice.value} style={[styles.choiceCard, uiPreset === choice.value ? styles.choiceCardActive : null]} onPress={() => onUiPresetChange(choice.value)}>
                    <Text style={styles.choiceEmoji}>{choice.emoji}</Text>
                    <Text style={styles.choiceText}>{choice.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>Show tap-to-report hint</Text>
                <Switch value={showTapHint} onValueChange={onShowTapHintChange} />
              </View>
            </View>
          ) : null}

          {settingsTab === 'map' ? (
            <View style={styles.sectionBlock}>
              <Text style={styles.sectionTitle}>Map style</Text>
              <View style={styles.choiceGrid}>
                {MAP_THEMES.map((theme) => (
                  <TouchableOpacity key={theme.id} style={[styles.choiceCard, mapTheme === theme.id ? styles.choiceCardActive : null]} onPress={() => onMapThemeChange(theme.id)}>
                    <Text style={styles.choiceEmoji}>{theme.emoji}</Text>
                    <Text style={styles.choiceText}>{theme.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ) : null}

          {settingsTab === 'account' ? (
            <View style={styles.sectionBlock}>
              <Text style={styles.sectionTitle}>Account & sync</Text>
              <Text style={styles.paragraphText}>Google and Apple sign-in now exchange tokens with the backend. Next up is wiring report submission and synced preferences to authenticated sessions.</Text>
            </View>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  )
}

function AuthModal({ visible, authBusy, authErr, onClose, onGoogleSignIn, onAppleSignIn }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <Pressable style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Sign in</Text>
            <TouchableOpacity style={styles.modalCloseButton} onPress={onClose}>
              <Ionicons name="close" size={18} color="#44537a" />
            </TouchableOpacity>
          </View>

          <View style={styles.sectionBlock}>
            <TouchableOpacity style={styles.oauthButton} onPress={onGoogleSignIn} disabled={authBusy}>
              <Ionicons name="logo-google" size={16} color="#1f2743" />
              <Text style={styles.oauthButtonText}>{authBusy ? 'Working...' : 'Continue with Google'}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.oauthButton} onPress={onAppleSignIn} disabled={authBusy}>
              <Ionicons name="logo-apple" size={16} color="#1f2743" />
              <Text style={styles.oauthButtonText}>{authBusy ? 'Working...' : 'Continue with Apple'}</Text>
            </TouchableOpacity>

            {authErr ? <Text style={styles.authError}>{authErr}</Text> : null}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

function ProfileModal({ visible, onClose, reports, myReports, currentUser, onLogout }) {
  const myCleanups = reports.filter((report) => report.picked_up).slice(0, 4)

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <Pressable style={styles.profileCard}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Profile</Text>
            <TouchableOpacity style={styles.modalCloseButton} onPress={onClose}>
              <Ionicons name="close" size={18} color="#44537a" />
            </TouchableOpacity>
          </View>

          <Text style={styles.profileName}>{currentUser?.display_name || 'RefuseRefuse User'}</Text>
          <Text style={styles.profileEmail}>{currentUser?.email || 'No email available'}</Text>

          <View style={styles.profileStatsGrid}>
            <StatPanel label="My reports" value={String(myReports.length)} tint="#f4f7ff" accent="#4a5a8c" />
            <StatPanel label="My cleanups" value={String(myCleanups.length)} tint="#eefbf3" accent="#2e7d32" />
          </View>

          <Text style={styles.sectionTitle}>Recent reports</Text>
          {myReports.map((report) => (
            <Text key={String(report.id)} style={styles.listRow}>{report.severity} · {new Date(report.created_at).toLocaleDateString()}</Text>
          ))}

          <TouchableOpacity style={styles.logoutButton} onPress={onLogout}>
            <Text style={styles.logoutButtonText}>Log out</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

function StatPanel({ accent, label, tint, value }) {
  return (
    <View style={[styles.statPanel, { backgroundColor: tint }]}>
      <Text style={[styles.statPanelLabel, { color: accent }]}>{label}</Text>
      <Text style={styles.statPanelValue}>{value}</Text>
    </View>
  )
}

function ReportComposer({ visible, draft, coordinate, onClose, onDraftChange }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <View style={styles.reportSheet}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>New Trash Report</Text>
            <TouchableOpacity style={styles.modalCloseButton} onPress={onClose}>
              <Ionicons name="close" size={18} color="#44537a" />
            </TouchableOpacity>
          </View>

          <Text style={styles.coordinateText}>
            {coordinate ? `${coordinate.latitude.toFixed(5)}, ${coordinate.longitude.toFixed(5)}` : 'Tap the map to set a location'}
          </Text>

          <Text style={styles.inputLabel}>Severity</Text>
          <View style={styles.severityRow}>
            {SEVERITIES.map((severity) => (
              <TouchableOpacity
                key={severity}
                style={[
                  styles.sheetSeverityButton,
                  draft.severity === severity ? { backgroundColor: SEV_COLOR[severity], borderColor: SEV_COLOR[severity] } : null,
                ]}
                onPress={() => onDraftChange({ ...draft, severity })}
              >
                <Text style={[styles.sheetSeverityText, draft.severity === severity ? styles.sheetSeverityTextActive : null]}>{severity}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.inputLabel}>Notes</Text>
          <TextInput
            multiline
            numberOfLines={3}
            placeholder="Optional description..."
            placeholderTextColor="#8190b2"
            style={styles.textArea}
            value={draft.notes}
            onChangeText={(notes) => onDraftChange({ ...draft, notes })}
          />

          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>I already cleaned it up</Text>
            <Switch value={draft.picked_up} onValueChange={(picked_up) => onDraftChange({ ...draft, picked_up })} />
          </View>

          <TouchableOpacity style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Submission wiring next</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )
}

function IncidentModal({ visible, onClose, userLocation }) {
  const locationLabel = userLocation
    ? `${userLocation.latitude.toFixed(5)}, ${userLocation.longitude.toFixed(5)}`
    : 'Location not captured yet'

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <Pressable style={styles.modalCardLarge}>
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.modalTitle}>Environmental Incident Workflow</Text>
              <Text style={styles.paragraphText}>Document illegal dumping or contamination and escalate with evidence.</Text>
            </View>
            <TouchableOpacity style={styles.modalCloseButton} onPress={onClose}>
              <Ionicons name="close" size={18} color="#44537a" />
            </TouchableOpacity>
          </View>

          <Text style={styles.sectionTitle}>Evidence summary preview</Text>
          <View style={styles.preBlock}>
            <Text style={styles.preText}>[ENVIRONMENTAL INCIDENT]</Text>
            <Text style={styles.preText}>Type: Illegal dumping</Text>
            <Text style={styles.preText}>Location: {locationLabel}</Text>
            <Text style={styles.preText}>Immediate hazard: Unknown</Text>
            <Text style={styles.preText}>Details: Add observed facts, timestamps, odors, runoff, and photos.</Text>
          </View>

          <Text style={styles.sectionTitle}>Escalation path</Text>
          <Text style={styles.listRow}>1. Pennsylvania DEP complaint resources</Text>
          <Text style={styles.listRow}>2. EPA environmental violations portal</Text>
          <Text style={styles.listRow}>3. National Response Center for emergency spills</Text>
          <TouchableOpacity style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Save incident workflow next</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

function ReportCard({ onClose, report }) {
  return (
    <View style={styles.reportCard}>
      <View style={styles.reportCardHeader}>
        <View style={[styles.cleanupBadge, { backgroundColor: isIncidentReport(report) ? '#b71c1c' : SEV_COLOR[report.severity] || '#888' }]}>
          <Text style={styles.cleanupBadgeText}>{isIncidentReport(report) ? 'incident' : report.severity}</Text>
        </View>
        <TouchableOpacity onPress={onClose}>
          <Ionicons name="close" size={18} color="#44537a" />
        </TouchableOpacity>
      </View>
      <Text style={styles.reportCardNotes}>{report.notes || 'No extra notes on this report.'}</Text>
      <Text style={styles.reportCardMeta}>Reported by {report.reporter_display_name || 'Unknown'} · {new Date(report.created_at).toLocaleString()}</Text>
    </View>
  )
}

export default function App() {
  const [fontsLoaded] = useFonts({
    SpaceGrotesk_400Regular,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_700Bold,
  })

  if (!fontsLoaded) return null

  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  topbar: {
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 20,
    backgroundColor: 'rgba(12, 19, 38, 0.86)',
    borderWidth: 1,
    borderColor: 'rgba(138, 180, 255, 0.25)',
  },
  topbarSoft: {
    backgroundColor: 'rgba(20, 40, 45, 0.78)',
    borderColor: 'rgba(145, 233, 208, 0.3)',
  },
  brandBlock: {
    gap: 4,
  },
  brand: {
    color: '#fff',
    fontSize: 22,
    fontFamily: 'SpaceGrotesk_700Bold',
  },
  subtitle: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontFamily: 'SpaceGrotesk_400Regular',
  },
  chipsRow: {
    gap: 8,
    paddingTop: 14,
    paddingBottom: 4,
  },
  severityChip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  severityChipText: {
    color: '#fff',
    fontSize: 12,
    fontFamily: 'SpaceGrotesk_700Bold',
    textTransform: 'capitalize',
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingTop: 8,
  },
  headerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  headerButtonText: {
    color: '#fff',
    fontSize: 12,
    fontFamily: 'SpaceGrotesk_500Medium',
  },
  oauthButton: {
    borderWidth: 1,
    borderColor: '#d3dcf4',
    borderRadius: 999,
    backgroundColor: '#fff',
    paddingVertical: 11,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  oauthButtonText: {
    color: '#1f2743',
    fontSize: 13,
    fontFamily: 'SpaceGrotesk_700Bold',
  },
  authError: {
    color: '#b00020',
    fontSize: 12,
    fontFamily: 'SpaceGrotesk_500Medium',
    textAlign: 'center',
  },
  mapShell: {
    flex: 1,
    marginTop: 12,
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: 'rgba(8, 12, 24, 0.25)',
  },
  mapShellSoft: {
    borderColor: COLORS.softBorder,
  },
  tapHint: {
    position: 'absolute',
    top: 14,
    alignSelf: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.64)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  tapHintText: {
    color: '#fff',
    fontSize: 12,
    fontFamily: 'SpaceGrotesk_500Medium',
  },
  bannerWarning: {
    position: 'absolute',
    top: 56,
    left: 12,
    right: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(17, 34, 58, 0.94)',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  bannerText: {
    color: '#fff',
    fontSize: 12,
    fontFamily: 'SpaceGrotesk_400Regular',
  },
  toastError: {
    position: 'absolute',
    top: 110,
    left: 12,
    right: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(176, 0, 32, 0.92)',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  toastInfo: {
    position: 'absolute',
    top: 110,
    left: 12,
    right: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(17, 34, 58, 0.92)',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  toastText: {
    color: '#fff',
    fontSize: 12,
    fontFamily: 'SpaceGrotesk_400Regular',
    textAlign: 'center',
  },
  cleanupCard: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 18,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.97)',
    padding: 14,
    gap: 8,
  },
  cleanupLabel: {
    color: '#3f4f73',
    fontSize: 12,
    fontFamily: 'SpaceGrotesk_700Bold',
  },
  cleanupMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cleanupBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  cleanupBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontFamily: 'SpaceGrotesk_700Bold',
    textTransform: 'capitalize',
  },
  cleanupDistance: {
    color: '#34466d',
    fontSize: 12,
    fontFamily: 'SpaceGrotesk_500Medium',
  },
  cleanupNotes: {
    color: '#2b3552',
    fontSize: 13,
    fontFamily: 'SpaceGrotesk_400Regular',
  },
  secondaryButton: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#c4cee4',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  secondaryButtonText: {
    color: '#34466d',
    fontSize: 12,
    fontFamily: 'SpaceGrotesk_700Bold',
  },
  fabStack: {
    position: 'absolute',
    right: 14,
    bottom: 22,
    gap: 10,
    alignItems: 'flex-end',
  },
  refreshFab: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#2b365a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reportFab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    backgroundColor: '#1976d2',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  reportFabText: {
    color: '#fff',
    fontSize: 13,
    fontFamily: 'SpaceGrotesk_700Bold',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(8, 12, 24, 0.28)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: '#fff',
    fontSize: 14,
    fontFamily: 'SpaceGrotesk_500Medium',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(8, 12, 24, 0.52)',
    padding: 16,
    justifyContent: 'center',
  },
  modalCard: {
    borderRadius: 18,
    backgroundColor: '#f7f9ff',
    padding: 18,
  },
  modalCardLarge: {
    borderRadius: 18,
    backgroundColor: '#f7f9ff',
    padding: 18,
    gap: 12,
  },
  profileCard: {
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.97)',
    padding: 18,
    gap: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  modalTitle: {
    color: '#1f2743',
    fontSize: 19,
    fontFamily: 'SpaceGrotesk_700Bold',
  },
  modalCloseButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: '#d3dcf4',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingTop: 14,
  },
  tabButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#c8d6ff',
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  tabButtonActive: {
    borderColor: '#3f7cff',
    backgroundColor: '#eef4ff',
  },
  tabButtonText: {
    color: '#3f4b71',
    fontSize: 12,
    fontFamily: 'SpaceGrotesk_700Bold',
    textTransform: 'capitalize',
  },
  tabButtonTextActive: {
    color: '#1f3f8f',
  },
  sectionBlock: {
    paddingTop: 16,
    gap: 12,
  },
  sectionTitle: {
    color: '#3f4b71',
    fontSize: 13,
    fontFamily: 'SpaceGrotesk_700Bold',
  },
  choiceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  choiceCard: {
    minWidth: '47%',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#c8d6ff',
    backgroundColor: '#fff',
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: 'center',
    gap: 4,
  },
  choiceCardActive: {
    borderColor: '#3f7cff',
    backgroundColor: '#eef4ff',
  },
  choiceEmoji: {
    fontSize: 18,
  },
  choiceText: {
    color: '#2f3a5f',
    fontSize: 12,
    fontFamily: 'SpaceGrotesk_700Bold',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  switchLabel: {
    color: '#334166',
    fontSize: 13,
    fontFamily: 'SpaceGrotesk_500Medium',
    flex: 1,
    paddingRight: 16,
  },
  paragraphText: {
    color: '#44537a',
    fontSize: 13,
    lineHeight: 19,
    fontFamily: 'SpaceGrotesk_400Regular',
  },
  profileName: {
    color: '#1f2743',
    fontSize: 18,
    fontFamily: 'SpaceGrotesk_700Bold',
  },
  profileEmail: {
    color: '#5b6787',
    fontSize: 12,
    fontFamily: 'SpaceGrotesk_400Regular',
  },
  profileStatsGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  logoutButton: {
    marginTop: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#d4daee',
    backgroundColor: '#fff',
    paddingVertical: 10,
    alignItems: 'center',
  },
  logoutButtonText: {
    color: '#1f2743',
    fontSize: 13,
    fontFamily: 'SpaceGrotesk_700Bold',
  },
  statPanel: {
    flex: 1,
    borderRadius: 12,
    padding: 10,
  },
  statPanelLabel: {
    fontSize: 11,
    fontFamily: 'SpaceGrotesk_500Medium',
  },
  statPanelValue: {
    marginTop: 4,
    color: '#1f2743',
    fontSize: 18,
    fontFamily: 'SpaceGrotesk_700Bold',
  },
  listRow: {
    color: '#2f3550',
    fontSize: 12,
    fontFamily: 'SpaceGrotesk_400Regular',
    paddingVertical: 2,
  },
  sheetBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.38)',
  },
  reportSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    backgroundColor: '#fff',
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 32,
    gap: 12,
  },
  coordinateText: {
    color: '#65718f',
    fontSize: 12,
    fontFamily: 'SpaceGrotesk_400Regular',
  },
  inputLabel: {
    color: '#2f3550',
    fontSize: 13,
    fontFamily: 'SpaceGrotesk_700Bold',
  },
  severityRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  sheetSeverityButton: {
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#d8dce8',
    backgroundColor: '#f9f9f9',
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  sheetSeverityText: {
    color: '#555',
    fontSize: 11,
    fontFamily: 'SpaceGrotesk_700Bold',
    textTransform: 'capitalize',
  },
  sheetSeverityTextActive: {
    color: '#fff',
  },
  textArea: {
    minHeight: 84,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#1f2743',
    fontFamily: 'SpaceGrotesk_400Regular',
    textAlignVertical: 'top',
  },
  primaryButton: {
    borderRadius: 10,
    backgroundColor: '#1976d2',
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 14,
    fontFamily: 'SpaceGrotesk_700Bold',
  },
  preBlock: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e6f3',
    backgroundColor: '#fff',
    padding: 12,
    gap: 2,
  },
  preText: {
    color: '#36405f',
    fontSize: 11,
    fontFamily: 'SpaceGrotesk_400Regular',
  },
  reportCard: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 110,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.97)',
    padding: 14,
    gap: 8,
  },
  reportCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  reportCardNotes: {
    color: '#2b3552',
    fontSize: 13,
    fontFamily: 'SpaceGrotesk_400Regular',
  },
  reportCardMeta: {
    color: '#6c7898',
    fontSize: 11,
    fontFamily: 'SpaceGrotesk_400Regular',
  },
})
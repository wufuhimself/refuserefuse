import React, { useEffect, useRef, useState } from 'react'
import {
  Animated,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native'
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import MapView, { Circle, Marker, UrlTile } from 'react-native-maps'
import { LinearGradient } from 'expo-linear-gradient'
import { StatusBar } from 'expo-status-bar'
import * as AppleAuthentication from 'expo-apple-authentication'
import * as Google from 'expo-auth-session/providers/google'
import * as Haptics from 'expo-haptics'
import * as Location from 'expo-location'
import * as WebBrowser from 'expo-web-browser'
import { Ionicons } from '@expo/vector-icons'
import { useFonts, SpaceGrotesk_400Regular, SpaceGrotesk_500Medium, SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk'
import AsyncStorage from '@react-native-async-storage/async-storage'

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
import {
  appendLocationPoints,
  deleteStoredLocationHistory,
  loadReports,
  resolveApiBaseUrl,
  startLocationSession,
  stopLocationSession,
} from './src/api'

WebBrowser.maybeCompleteAuthSession()

const GOOGLE_EXPO_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_EXPO_CLIENT_ID || ''
const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || ''
const GOOGLE_ANDROID_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || ''
const LOCATION_CONSENT_STORAGE_KEY = 'rr_location_history_consent'
const LOCATION_CONSENT_VERSION = '2026-04-location-history-v1'
const LOCATION_SAMPLE_MIN_MS = 30000
const LOCATION_SAMPLE_MIN_DISTANCE_METERS = 50
const LOCATION_MAX_ACCEPTED_ACCURACY_M = 120
const LOCATION_BATCH_SIZE = 6
const LOCATION_BATCH_FLUSH_MS = 15000
const LOCATION_PRIVACY_SUMMARY = 'When Live Tracking is ON, RefuseRefuse stores sampled GPS points in your private account history on our server.'
const LOCATION_PRIVACY_USE = 'We use saved location history only to improve cleanup tools, understand trash trends, and produce anonymous or aggregate insights.'
const LOCATION_PRIVACY_PUBLIC = 'Your identity is not attached to any public-facing location analysis, and you can delete your saved history at any time.'
const LOCATION_PRIVACY_RETENTION = 'Saved location history is retained until you delete it through the app settings or the account data is otherwise removed. There is no automatic expiration window configured today.'
const LOCATION_PRIVACY_CONTACT = 'If you have a privacy question, need help with deletion, or believe your location data was handled incorrectly, contact the RefuseRefuse support or privacy contact for the organization operating this deployment.'

function roundCoord(value) {
  return Math.round(value * 100000) / 100000
}

function formatCount(value, singular, plural = `${singular}s`) {
  return `${value} ${value === 1 ? singular : plural}`
}

const DEFAULT_REPORT_DRAFT = {
  reportType: 'trash',
  severity: 'light',
  notes: '',
  picked_up: false,
  incidentKind: 'illegal_dumping',
  immediateHazard: false,
  suspectedSource: '',
}

function buildIncidentNotesFromDraft(draft) {
  const typeLabel = draft.incidentKind === 'ground_contamination' ? 'Ground contamination' : 'Illegal dumping'
  return [
    '[ENVIRONMENTAL INCIDENT]',
    `Type: ${typeLabel}`,
    `Immediate hazard: ${draft.immediateHazard ? 'Yes' : 'No'}`,
    `Suspected source: ${draft.suspectedSource || 'Not provided'}`,
    `Details: ${draft.notes || 'Not provided'}`,
  ].join('\n')
}

function AppContent() {
  const insets = useSafeAreaInsets()
  const { height: windowHeight } = useWindowDimensions()
  const mapRef = useRef(null)
  const locationWatcherRef = useRef(null)
  const trackingSessionIdRef = useRef(null)
  const pendingLocationPointsRef = useRef([])
  const locationFlushTimerRef = useRef(null)
  const lastSentLocationRef = useRef(null)
  const cleanupCelebrateOpacity = useRef(new Animated.Value(0)).current
  const cleanupCelebrateTranslate = useRef(new Animated.Value(18)).current
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [dataSource, setDataSource] = useState('live')
  const [loadError, setLoadError] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState('appearance')
  const [activeTab, setActiveTab] = useState('map')
  const [authOpen, setAuthOpen] = useState(false)
  const [authErr, setAuthErr] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [token, setToken] = useState('')
  const [currentUser, setCurrentUser] = useState(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [selectedReport, setSelectedReport] = useState(null)
  const [mapTheme, setMapTheme] = useState('voyager')
  const [uiPreset, setUiPreset] = useState('modern')
  const [showTapHint, setShowTapHint] = useState(true)
  const [userLocation, setUserLocation] = useState(null)
  const [locateError, setLocateError] = useState('')
  const [liveTracking, setLiveTracking] = useState(false)
  const [locationConsentAccepted, setLocationConsentAccepted] = useState(false)
  const [locationConsentLoaded, setLocationConsentLoaded] = useState(false)
  const [locationConsentPromptOpen, setLocationConsentPromptOpen] = useState(false)
  const [locationPrivacyStatus, setLocationPrivacyStatus] = useState('')
  const [locationPrivacyStatusTone, setLocationPrivacyStatusTone] = useState('neutral')
  const [locationDeletePending, setLocationDeletePending] = useState(false)
  const [privacyPolicyOpen, setPrivacyPolicyOpen] = useState(false)
  const [cleanupTarget, setCleanupTarget] = useState(null)
  const [cleanupMessage, setCleanupMessage] = useState('')
  const [cleanupCelebrateVisible, setCleanupCelebrateVisible] = useState(false)
  const [pendingCoordinate, setPendingCoordinate] = useState(null)
  const [reportDraft, setReportDraft] = useState(DEFAULT_REPORT_DRAFT)
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
  const recentReports = [...reports]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 12)
  const incidentReports = recentReports.filter((report) => isIncidentReport(report))
  const tabBarBottomInset = Math.max(8, insets.bottom)
  const tabBarHeight = 62 + tabBarBottomInset
  const isCompactScreen = windowHeight < 760

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

  useEffect(() => {
    let active = true

    AsyncStorage.getItem(LOCATION_CONSENT_STORAGE_KEY)
      .then((value) => {
        if (!active) return
        setLocationConsentAccepted(value === 'true')
        setLocationConsentLoaded(true)
      })
      .catch(() => {
        if (!active) return
        setLocationConsentLoaded(true)
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!locationConsentLoaded) return
    AsyncStorage.setItem(LOCATION_CONSENT_STORAGE_KEY, String(locationConsentAccepted)).catch(() => null)
  }, [locationConsentAccepted, locationConsentLoaded])

  useEffect(() => {
    let cancelled = false

    async function startLiveTracking() {
      if (!liveTracking) return
      if (!token) {
        setLiveTracking(false)
        return
      }

      const permission = await Location.requestForegroundPermissionsAsync()
      if (cancelled) return
      if (permission.status !== 'granted') {
        setLocateError('Location permission denied. Grant access to record private location history while tracking is on.')
        setLiveTracking(false)
        return
      }

      try {
        const session = await startLocationSession(token, LOCATION_CONSENT_VERSION)
        if (cancelled) return

        trackingSessionIdRef.current = session.id
        pendingLocationPointsRef.current = []
        lastSentLocationRef.current = null
        setLocationPrivacyStatusTone('success')
        setLocationPrivacyStatus('Private location history is recording while tracking is ON.')

        const initialPosition = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
        if (cancelled) return
        handleTrackedPosition(initialPosition.coords)

        const watcher = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            timeInterval: 5000,
            distanceInterval: 20,
          },
          ({ coords }) => {
            handleTrackedPosition(coords)
          },
        )

        if (cancelled) {
          watcher.remove()
          return
        }
        locationWatcherRef.current = watcher
      } catch (error) {
        if (cancelled) return
        setLocateError(error?.message || 'Could not start location history right now. Live map tracking still works.')
        setLiveTracking(false)
      }
    }

    startLiveTracking()

    return () => {
      cancelled = true
      if (locationWatcherRef.current) {
        locationWatcherRef.current.remove()
        locationWatcherRef.current = null
      }
      stopTrackingSessionAndFlush(token)
    }
  }, [liveTracking, token])

  useEffect(() => {
    return () => {
      if (locationWatcherRef.current) {
        locationWatcherRef.current.remove()
        locationWatcherRef.current = null
      }
      stopTrackingSessionAndFlush(token)
    }
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

  async function triggerSelectionHaptic() {
    try {
      await Haptics.selectionAsync()
    } catch {
      return
    }
  }

  async function triggerSuccessHaptic() {
    try {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    } catch {
      return
    }
  }

  async function triggerImpactHaptic() {
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    } catch {
      return
    }
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
    setLiveTracking(false)
    setToken('')
    setCurrentUser(null)
    setProfileOpen(false)
  }

  function handleTrackedPosition(coords) {
    const nextLocation = {
      latitude: coords.latitude,
      longitude: coords.longitude,
      accuracy: coords.accuracy || 0,
    }

    setUserLocation(nextLocation)
    queueLocationPoint(coords)
    mapRef.current?.animateToRegion({
      latitude: nextLocation.latitude,
      longitude: nextLocation.longitude,
      latitudeDelta: 0.02,
      longitudeDelta: 0.02,
    })
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

  function openLocationPrivacySettings() {
    setSettingsTab('privacy')
    setSettingsOpen(true)
  }

  function handleTrackingControl() {
    triggerSelectionHaptic()
    if (liveTracking) {
      setLiveTracking(false)
      return
    }

    if (!token) {
      setAuthOpen(true)
      setLocateError('Login required to save private location history while live tracking is active.')
      return
    }

    if (!locationConsentAccepted) {
      setLocationPrivacyStatusTone('neutral')
      setLocationPrivacyStatus('Review the location privacy details and confirm storage before turning live tracking on.')
      setLocationConsentPromptOpen(true)
      return
    }

    handleLocateMe()
    setLiveTracking(true)
  }

  async function flushQueuedLocationPoints(activeToken = token) {
    const sessionId = trackingSessionIdRef.current
    const queued = pendingLocationPointsRef.current
    if (!sessionId || !activeToken || queued.length === 0) return

    pendingLocationPointsRef.current = []
    try {
      await appendLocationPoints(activeToken, sessionId, queued)
    } catch {
      pendingLocationPointsRef.current = queued.concat(pendingLocationPointsRef.current).slice(-30)
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
      const movedMeters = distanceMeters(
        { latitude: last.lat, longitude: last.lng },
        { latitude: point.lat, longitude: point.lng },
      )
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

  async function stopTrackingSessionAndFlush(activeToken = token) {
    if (locationFlushTimerRef.current) {
      clearTimeout(locationFlushTimerRef.current)
      locationFlushTimerRef.current = null
    }

    await flushQueuedLocationPoints(activeToken)

    const sessionId = trackingSessionIdRef.current
    trackingSessionIdRef.current = null
    lastSentLocationRef.current = null
    if (!sessionId || !activeToken) return

    try {
      await stopLocationSession(activeToken, sessionId)
    } catch {
      return
    }
  }

  async function handleDeleteLocationHistory() {
    if (!token) {
      setAuthOpen(true)
      setLocateError('Login required to manage saved location history.')
      return
    }

    setLocationDeletePending(true)
    try {
      if (locationWatcherRef.current) {
        locationWatcherRef.current.remove()
        locationWatcherRef.current = null
      }
      setLiveTracking(false)
      await stopTrackingSessionAndFlush(token)
      pendingLocationPointsRef.current = []

      const result = await deleteStoredLocationHistory(token)
      triggerSuccessHaptic()
      setLocationPrivacyStatusTone('success')
      setLocationPrivacyStatus(
        `Deleted ${formatCount(Number(result.deleted_points || 0), 'saved location point')} across ${formatCount(Number(result.deleted_sessions || 0), 'tracking session')}.`
      )
      setLocateError('')
    } catch (error) {
      setLocationPrivacyStatusTone('error')
      setLocationPrivacyStatus(error?.message || 'Could not delete saved location history right now.')
    } finally {
      setLocationDeletePending(false)
    }
  }

  function showCleanupCelebration() {
    setCleanupCelebrateVisible(true)
    cleanupCelebrateOpacity.setValue(0)
    cleanupCelebrateTranslate.setValue(18)

    Animated.sequence([
      Animated.parallel([
        Animated.timing(cleanupCelebrateOpacity, {
          toValue: 1,
          duration: 220,
          useNativeDriver: true,
        }),
        Animated.spring(cleanupCelebrateTranslate, {
          toValue: 0,
          damping: 14,
          stiffness: 150,
          mass: 0.7,
          useNativeDriver: true,
        }),
      ]),
      Animated.delay(1800),
      Animated.timing(cleanupCelebrateOpacity, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setCleanupCelebrateVisible(false)
      cleanupCelebrateTranslate.setValue(18)
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
    setReportDraft(DEFAULT_REPORT_DRAFT)
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

  async function submitReport() {
    if (!token) {
      setAuthOpen(true)
      return
    }

    if (!pendingCoordinate || !pendingCoordinate.latitude || !pendingCoordinate.longitude) {
      alert('Invalid coordinates. Please try again.')
      return
    }

    try {
      const fd = new FormData()
      fd.append('lat', pendingCoordinate.latitude)
      fd.append('lng', pendingCoordinate.longitude)
      if (reportDraft.reportType === 'incident') {
        if (!reportDraft.notes?.trim()) {
          alert('Please add incident details.')
          return
        }
        fd.append('severity', reportDraft.incidentKind === 'ground_contamination' ? 'urgent' : 'trashy')
        fd.append('notes', buildIncidentNotesFromDraft(reportDraft))
        fd.append('picked_up', false)
      } else {
        fd.append('severity', reportDraft.severity)
        fd.append('notes', reportDraft.notes || '')
        fd.append('picked_up', reportDraft.picked_up)
      }

      const res = await fetch(`${apiBaseUrl}/reports`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({ detail: 'Report submission failed' }))
        throw new Error(body?.detail || 'Report submission failed')
      }

      await refreshReports()
      if (reportDraft.reportType === 'trash' && reportDraft.picked_up) {
        triggerSuccessHaptic()
        showCleanupCelebration()
      } else {
        triggerImpactHaptic()
      }
      setReportOpen(false)
      setReportDraft(DEFAULT_REPORT_DRAFT)
      setPendingCoordinate(null)
    } catch (err) {
      alert(err?.message || 'Failed to submit report')
    }
  }

  function focusReportOnMap(report) {
    setActiveTab('map')
    setSelectedReport(report)
    mapRef.current?.animateToRegion({
      latitude: report.lat,
      longitude: report.lng,
      latitudeDelta: 0.02,
      longitudeDelta: 0.02,
    })
  }

  return (
    <LinearGradient colors={[COLORS.ink900, COLORS.ink800, COLORS.ink700]} start={{ x: 0.05, y: 0.05 }} end={{ x: 1, y: 1 }} style={styles.screen}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safeArea}>
        <View style={[styles.topbar, uiPreset === 'soft' ? styles.topbarSoft : null, isCompactScreen ? styles.topbarCompact : null]}>
          <View style={styles.brandBlock}>
            <Text style={styles.brand}>RefuseRefuse</Text>
            <Text style={styles.subtitle}>
              {activeTab === 'map' ? 'Map' : activeTab === 'activity' ? 'Activity' : 'Profile'} · {dataSource === 'live' ? 'live backend' : 'demo fallback'}
            </Text>
          </View>

          <View style={[styles.topbarMetaRow, isCompactScreen ? styles.topbarMetaRowCompact : null]}>
            <Text style={[styles.subtitle, isCompactScreen ? styles.subtitleCompact : null]}>{total} reports</Text>
            <Text style={[styles.subtitle, isCompactScreen ? styles.subtitleCompact : null]}>{pickedUp} cleaned</Text>
            {currentUser ? <Text style={[styles.subtitle, isCompactScreen ? styles.subtitleCompact : null]}>{currentUser.display_name || currentUser.email}</Text> : null}
          </View>
        </View>

        {activeTab === 'map' ? (
          <View style={[styles.mapShell, uiPreset === 'soft' ? styles.mapShellSoft : null, isCompactScreen ? styles.mapShellCompact : null]}>
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
              <Text style={styles.tapHintText}>Tap the map to report refuse</Text>
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

          {locationPrivacyStatus ? (
            <View style={[styles.toastInfo, locationPrivacyStatusTone === 'success' ? styles.toastSuccess : null, locationPrivacyStatusTone === 'error' ? styles.toastSoftError : null]}>
              <Text style={styles.toastText}>{locationPrivacyStatus}</Text>
            </View>
          ) : null}

          {cleanupMessage ? (
              <View style={[styles.toastInfo, (locateError || locationPrivacyStatus) ? styles.toastInfoLower : null]}>
              <Text style={styles.toastText}>{cleanupMessage}</Text>
            </View>
          ) : null}

          {cleanupTarget ? (
            <View style={[styles.cleanupCard, { bottom: tabBarHeight + 12 }]}>
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

          <View style={[styles.mapActionRail, { bottom: tabBarHeight + (isCompactScreen ? 10 : 12) }]}>
            <View style={[styles.mapActionRailRow, isCompactScreen ? styles.mapActionRailRowCompact : null]}>
              <MapActionButton compact={isCompactScreen} iconOnly icon={liveTracking ? 'pause-circle-outline' : 'locate-outline'} label={liveTracking ? 'Stop tracking' : 'Locate + track'} onPress={handleTrackingControl} accent={liveTracking ? '#2e7d32' : '#2b365a'} border={liveTracking ? '#5dc56b' : '#5f6c93'} />
              <MapActionButton compact={isCompactScreen} stretch icon="walk-outline" label="Cleanup" onPress={handleFindCleanup} />
              <MapActionButton compact={isCompactScreen} stretch icon="add-circle-outline" label="Report refuse" onPress={() => openReportComposer(userLocation || { latitude: INITIAL_REGION.latitude, longitude: INITIAL_REGION.longitude })} accent="#2f5d3a" border="#5f9b73" />
            </View>
          </View>

          <View style={[styles.fabStack, { bottom: tabBarHeight + (isCompactScreen ? 62 : 70) }]}> 
            <TouchableOpacity style={styles.refreshFab} onPress={refreshReports}>
              <Ionicons name="refresh" size={18} color="#fff" />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.loadingOverlay}>
              <Text style={styles.loadingText}>Loading map data…</Text>
            </View>
          ) : null}

          {cleanupCelebrateVisible ? (
            <Animated.View
              style={[
                styles.cleanupCelebrate,
                {
                  bottom: tabBarHeight + (isCompactScreen ? 128 : 144),
                  opacity: cleanupCelebrateOpacity,
                  transform: [{ translateY: cleanupCelebrateTranslate }],
                },
              ]}
            >
              <Text style={styles.cleanupCelebrateTitle}>Cleanup logged</Text>
              <Text style={styles.cleanupCelebrateText}>Nice work. You marked trash as picked up and helped clear the map.</Text>
            </Animated.View>
          ) : null}
          </View>
        ) : null}

        {activeTab === 'activity' ? (
          <ScrollView style={styles.tabScroll} contentContainerStyle={[styles.tabScrollContent, { paddingBottom: tabBarHeight + 20 }]}>
            <View style={styles.activityCard}>
              <Text style={styles.sectionTitle}>Severity snapshot</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
                {SEVERITIES.map((severity) => (
                  <View key={severity} style={[styles.severityChip, { backgroundColor: `${SEV_COLOR[severity]}22`, borderColor: `${SEV_COLOR[severity]}88` }]}>
                    <Text style={styles.severityChipText}>{counts[severity]} {severity}</Text>
                  </View>
                ))}
              </ScrollView>
              <View style={styles.activityActionRow}>
                <TouchableOpacity style={styles.secondaryButtonFull} onPress={refreshReports}>
                  <Text style={styles.secondaryButtonText}>Refresh feed</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.secondaryButtonFull} onPress={() => { setActiveTab('map'); openReportComposer(userLocation || { latitude: INITIAL_REGION.latitude, longitude: INITIAL_REGION.longitude }) }}>
                  <Text style={styles.secondaryButtonText}>Report refuse</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.activityCard}>
              <Text style={styles.sectionTitle}>Recent reports</Text>
              {recentReports.length === 0 ? (
                <Text style={styles.paragraphText}>No reports yet.</Text>
              ) : recentReports.slice(0, 8).map((report) => (
                <TouchableOpacity key={`recent-${report.id}`} style={styles.activityListItem} onPress={() => focusReportOnMap(report)}>
                  <View style={[styles.activitySeverityDot, { backgroundColor: isIncidentReport(report) ? '#b71c1c' : (SEV_COLOR[report.severity] || '#666') }]} />
                  <View style={styles.activityListTextWrap}>
                    <Text style={styles.activityListTitle}>{isIncidentReport(report) ? 'Environmental incident' : `${report.severity} cleanup report`}</Text>
                    <Text style={styles.activityListMeta}>{new Date(report.created_at).toLocaleString()}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color="#7d88a8" />
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.activityCard}>
              <Text style={styles.sectionTitle}>Open incidents</Text>
              {incidentReports.length === 0 ? (
                <Text style={styles.paragraphText}>No incident reports in the latest feed.</Text>
              ) : incidentReports.slice(0, 6).map((report) => (
                <TouchableOpacity key={`incident-${report.id}`} style={styles.activityListItem} onPress={() => focusReportOnMap(report)}>
                  <View style={[styles.activitySeverityDot, { backgroundColor: '#b71c1c' }]} />
                  <View style={styles.activityListTextWrap}>
                    <Text style={styles.activityListTitle}>Incident report</Text>
                    <Text style={styles.activityListMeta}>{report.notes?.split('\n')[1] || 'Needs review'}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color="#7d88a8" />
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        ) : null}

        {activeTab === 'profile' ? (
          <ScrollView style={styles.tabScroll} contentContainerStyle={[styles.tabScrollContent, { paddingBottom: tabBarHeight + 20 }]}>
            <View style={styles.profilePanelCard}>
              <Text style={styles.sectionTitle}>Account</Text>
              <Text style={styles.paragraphText}>
                {currentUser ? `Signed in as ${currentUser.display_name || currentUser.email}` : 'Sign in to sync reports and save private location history.'}
              </Text>
              <View style={styles.settingsActionStack}>
                {currentUser ? (
                  <TouchableOpacity style={styles.secondaryButtonFull} onPress={() => setProfileOpen(true)}>
                    <Text style={styles.secondaryButtonText}>View profile details</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity style={styles.primaryButton} onPress={() => setAuthOpen(true)}>
                    <Text style={styles.primaryButtonText}>Login / Sign up</Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity style={styles.secondaryButtonFull} onPress={() => { setSettingsTab('appearance'); setSettingsOpen(true) }}>
                  <Text style={styles.secondaryButtonText}>Open settings</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.secondaryButtonFull} onPress={() => { setSettingsTab('privacy'); setSettingsOpen(true) }}>
                  <Text style={styles.secondaryButtonText}>Privacy controls</Text>
                </TouchableOpacity>

                {currentUser ? (
                  <TouchableOpacity style={styles.dangerButton} onPress={logout}>
                    <Text style={styles.dangerButtonText}>Log out</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>

            <View style={styles.profilePanelCard}>
              <Text style={styles.sectionTitle}>Your impact</Text>
              <View style={styles.profileStatsGrid}>
                <StatPanel label="My reports" value={String(myReports.length)} tint="#f4f7ff" accent="#4a5a8c" />
                <StatPanel label="Open incidents" value={String(incidentReports.length)} tint="#fff2f2" accent="#9b1c1c" />
              </View>
            </View>
          </ScrollView>
        ) : null}

        <View style={[styles.bottomTabBar, { paddingBottom: tabBarBottomInset, bottom: 0 }, isCompactScreen ? styles.bottomTabBarCompact : null]}> 
          <TabButton icon="map-outline" label="Map" active={activeTab === 'map'} onPress={() => { triggerSelectionHaptic(); setActiveTab('map') }} />
          <TabButton icon="trash-outline" label="Activity" active={activeTab === 'activity'} onPress={() => { triggerSelectionHaptic(); setActiveTab('activity') }} />
          <TabButton icon="person-circle-outline" label="Profile" active={activeTab === 'profile'} onPress={() => { triggerSelectionHaptic(); setActiveTab('profile') }} />
        </View>

        <SettingsModal
          visible={settingsOpen}
          compact={isCompactScreen}
          settingsTab={settingsTab}
          onTabChange={setSettingsTab}
          mapTheme={mapTheme}
          uiPreset={uiPreset}
          showTapHint={showTapHint}
          onClose={() => setSettingsOpen(false)}
          onMapThemeChange={setMapTheme}
          onUiPresetChange={setUiPreset}
          onShowTapHintChange={setShowTapHint}
          currentUser={currentUser}
          liveTracking={liveTracking}
          locationConsentAccepted={locationConsentAccepted}
          locationPrivacyStatus={locationPrivacyStatus}
          locationPrivacyStatusTone={locationPrivacyStatusTone}
          locationDeletePending={locationDeletePending}
          onOpenPrivacyPolicy={() => setPrivacyPolicyOpen(true)}
          onAcceptLocationConsent={() => {
            setLocationConsentAccepted(true)
            setLocationPrivacyStatusTone('success')
            setLocationPrivacyStatus('Private location history enabled. Live tracking will save only while tracking is ON.')
          }}
          onStopTracking={() => setLiveTracking(false)}
          onDeleteLocationHistory={handleDeleteLocationHistory}
        />

        <LocationConsentModal
          visible={locationConsentPromptOpen}
          compact={isCompactScreen}
          onClose={() => setLocationConsentPromptOpen(false)}
          onOpenSettings={() => {
            setLocationConsentPromptOpen(false)
            openLocationPrivacySettings()
          }}
          onOpenPrivacyPolicy={() => setPrivacyPolicyOpen(true)}
          onAccept={() => {
            setLocationConsentAccepted(true)
            setLocationConsentPromptOpen(false)
            setLocationPrivacyStatusTone('success')
            setLocationPrivacyStatus('Private location history enabled. Live tracking will save only while tracking is ON.')
            setLiveTracking(true)
          }}
        />

        <PrivacyPolicyModal visible={privacyPolicyOpen} compact={isCompactScreen} onClose={() => setPrivacyPolicyOpen(false)} />

        <AuthModal
          visible={authOpen}
          compact={isCompactScreen}
          authBusy={authBusy}
          authErr={authErr}
          onClose={() => setAuthOpen(false)}
          onGoogleSignIn={handleGoogleSignIn}
          onAppleSignIn={handleAppleSignIn}
        />

        <ProfileModal
          visible={profileOpen}
          compact={isCompactScreen}
          onClose={() => setProfileOpen(false)}
          reports={reports}
          myReports={myReports}
          currentUser={currentUser}
          onLogout={logout}
        />

        <ReportComposer
          visible={reportOpen}
          compact={isCompactScreen}
          draft={reportDraft}
          coordinate={pendingCoordinate}
          onClose={() => setReportOpen(false)}
          onDraftChange={setReportDraft}
          onSubmit={submitReport}
        />
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

function MapActionButton({ accent = '#2b365a', border = '#5f6c93', compact = false, iconOnly = false, stretch = false, icon, label, onPress }) {
  return (
    <TouchableOpacity
      style={[
        styles.mapActionButton,
        compact ? styles.mapActionButtonCompact : null,
        iconOnly ? styles.mapActionButtonIconOnly : null,
        stretch ? styles.mapActionButtonStretch : null,
        { backgroundColor: accent, borderColor: border },
      ]}
      onPress={onPress}
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={16} color="#fff" />
      {!iconOnly ? <Text style={[styles.mapActionButtonText, compact ? styles.mapActionButtonTextCompact : null]}>{label}</Text> : null}
    </TouchableOpacity>
  )
}

function TabButton({ icon, label, active, onPress }) {
  return (
    <TouchableOpacity style={[styles.tabNavButton, active ? styles.tabNavButtonActive : null]} onPress={onPress}>
      <Ionicons name={icon} size={20} color={active ? '#8cd0ff' : '#9aa8cf'} />
      <Text style={[styles.tabNavButtonText, active ? styles.tabNavButtonTextActive : null]}>{label}</Text>
    </TouchableOpacity>
  )
}

function SettingsModal({
  visible,
  compact,
  settingsTab,
  onTabChange,
  mapTheme,
  uiPreset,
  showTapHint,
  onClose,
  onMapThemeChange,
  onUiPresetChange,
  onShowTapHintChange,
  currentUser,
  liveTracking,
  locationConsentAccepted,
  locationPrivacyStatus,
  locationPrivacyStatusTone,
  locationDeletePending,
  onOpenPrivacyPolicy,
  onAcceptLocationConsent,
  onStopTracking,
  onDeleteLocationHistory,
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <Pressable style={[styles.modalCard, compact ? styles.modalCardCompact : null]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Settings</Text>
            <TouchableOpacity style={styles.modalCloseButton} onPress={onClose}>
              <Ionicons name="close" size={18} color="#44537a" />
            </TouchableOpacity>
          </View>

          <View style={[styles.tabsRow, compact ? styles.tabsRowCompact : null]}>
            {['appearance', 'map', 'privacy'].map((tab) => (
              <TouchableOpacity key={tab} style={[styles.tabButton, settingsTab === tab ? styles.tabButtonActive : null]} onPress={() => onTabChange(tab)}>
                <Text style={[styles.tabButtonText, settingsTab === tab ? styles.tabButtonTextActive : null]}>{tab}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {settingsTab === 'appearance' ? (
            <View style={[styles.sectionBlock, compact ? styles.sectionBlockCompact : null]}>
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
            <View style={[styles.sectionBlock, compact ? styles.sectionBlockCompact : null]}>
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

          {settingsTab === 'privacy' ? (
            <View style={[styles.sectionBlock, compact ? styles.sectionBlockCompact : null]}>
              <Text style={styles.sectionTitle}>Location privacy & deletion</Text>
              <Text style={styles.paragraphText}>{LOCATION_PRIVACY_SUMMARY}</Text>
              <Text style={styles.paragraphText}>{LOCATION_PRIVACY_USE}</Text>
              <Text style={styles.paragraphText}>{LOCATION_PRIVACY_PUBLIC}</Text>
              <Text style={styles.paragraphText}>Saved history is private to your authenticated account and is only recorded while Live Tracking is ON.</Text>

              <View style={styles.privacyStateRow}>
                <View style={[styles.privacyStatePill, liveTracking ? styles.privacyStatePillActive : null]}>
                  <Text style={[styles.privacyStateText, liveTracking ? styles.privacyStateTextActive : null]}>{liveTracking ? 'Tracking ON' : 'Tracking OFF'}</Text>
                </View>
                <View style={[styles.privacyStatePill, locationConsentAccepted ? styles.privacyStatePillActive : null]}>
                  <Text style={[styles.privacyStateText, locationConsentAccepted ? styles.privacyStateTextActive : null]}>{locationConsentAccepted ? 'Consent recorded' : 'Consent required'}</Text>
                </View>
                <View style={[styles.privacyStatePill, currentUser ? styles.privacyStatePillActive : null]}>
                  <Text style={[styles.privacyStateText, currentUser ? styles.privacyStateTextActive : null]}>{currentUser ? 'Authenticated storage enabled' : 'Login required for saved history'}</Text>
                </View>
              </View>

              {locationPrivacyStatus ? (
                <View style={[styles.inlineStatus, locationPrivacyStatusTone === 'success' ? styles.inlineStatusSuccess : null, locationPrivacyStatusTone === 'error' ? styles.inlineStatusError : null]}>
                  <Text style={[styles.inlineStatusText, locationPrivacyStatusTone === 'success' ? styles.inlineStatusTextSuccess : null, locationPrivacyStatusTone === 'error' ? styles.inlineStatusTextError : null]}>{locationPrivacyStatus}</Text>
                </View>
              ) : null}

              <View style={styles.settingsActionStack}>
                {!locationConsentAccepted && currentUser ? (
                  <TouchableOpacity style={styles.primaryButton} onPress={onAcceptLocationConsent}>
                    <Text style={styles.primaryButtonText}>Allow private location history</Text>
                  </TouchableOpacity>
                ) : null}

                <TouchableOpacity style={styles.secondaryButtonFull} onPress={onOpenPrivacyPolicy}>
                  <Text style={styles.secondaryButtonText}>View full privacy policy</Text>
                </TouchableOpacity>

                {liveTracking ? (
                  <TouchableOpacity style={styles.secondaryButtonFull} onPress={onStopTracking}>
                    <Text style={styles.secondaryButtonText}>Stop live tracking</Text>
                  </TouchableOpacity>
                ) : null}

                {currentUser ? (
                  <TouchableOpacity style={[styles.dangerButton, locationDeletePending ? styles.buttonDisabled : null]} onPress={onDeleteLocationHistory} disabled={locationDeletePending}>
                    <Text style={styles.dangerButtonText}>{locationDeletePending ? 'Deleting history...' : 'Delete all saved location history'}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  )
}

function LocationConsentModal({ visible, compact, onClose, onOpenSettings, onOpenPrivacyPolicy, onAccept }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <Pressable style={[styles.modalCardLarge, compact ? styles.modalCardLargeCompact : null]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Allow private location history?</Text>
            <TouchableOpacity style={styles.modalCloseButton} onPress={onClose}>
              <Ionicons name="close" size={18} color="#44537a" />
            </TouchableOpacity>
          </View>

          <Text style={styles.paragraphText}>{LOCATION_PRIVACY_SUMMARY}</Text>
          <Text style={styles.paragraphText}>{LOCATION_PRIVACY_USE}</Text>
          <Text style={styles.paragraphText}>{LOCATION_PRIVACY_PUBLIC}</Text>
          <Text style={styles.paragraphText}>Tracking can be stopped at any time, and deletion controls remain available in Settings.</Text>

          <View style={styles.settingsActionStack}>
            <TouchableOpacity style={styles.secondaryButtonFull} onPress={onOpenPrivacyPolicy}>
              <Text style={styles.secondaryButtonText}>View full privacy policy</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryButtonFull} onPress={onOpenSettings}>
              <Text style={styles.secondaryButtonText}>Review in settings</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryButton} onPress={onAccept}>
              <Text style={styles.primaryButtonText}>Accept and turn tracking on</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

function PrivacyPolicyModal({ visible, compact, onClose }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <Pressable style={[styles.modalCardLarge, compact ? styles.modalCardLargeCompact : null]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Privacy Policy</Text>
            <TouchableOpacity style={styles.modalCloseButton} onPress={onClose}>
              <Ionicons name="close" size={18} color="#44537a" />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.policyScrollContent}>
            <Text style={styles.sectionTitle}>What We Store</Text>
            <Text style={styles.paragraphText}>{LOCATION_PRIVACY_SUMMARY}</Text>

            <Text style={styles.sectionTitle}>How We Use It</Text>
            <Text style={styles.paragraphText}>{LOCATION_PRIVACY_USE}</Text>

            <Text style={styles.sectionTitle}>Anonymous Analysis</Text>
            <Text style={styles.paragraphText}>{LOCATION_PRIVACY_PUBLIC}</Text>

            <Text style={styles.sectionTitle}>Deletion Rights</Text>
            <Text style={styles.paragraphText}>You can request deletion of your saved location history directly in the app settings. Deleting it permanently removes saved sessions and stored points from your account.</Text>

            <Text style={styles.sectionTitle}>Retention Period</Text>
            <Text style={styles.paragraphText}>{LOCATION_PRIVACY_RETENTION}</Text>

            <Text style={styles.sectionTitle}>Storage And Security</Text>
            <Text style={styles.paragraphText}>Location history is stored behind authenticated access and is intended to be handled securely and safely as private account data.</Text>

            <Text style={styles.sectionTitle}>Privacy Contact</Text>
            <Text style={styles.paragraphText}>{LOCATION_PRIVACY_CONTACT}</Text>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

function AuthModal({ visible, compact, authBusy, authErr, onClose, onGoogleSignIn, onAppleSignIn }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <Pressable style={[styles.modalCard, compact ? styles.modalCardCompact : null]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Sign in</Text>
            <TouchableOpacity style={styles.modalCloseButton} onPress={onClose}>
              <Ionicons name="close" size={18} color="#44537a" />
            </TouchableOpacity>
          </View>

          <View style={[styles.sectionBlock, compact ? styles.sectionBlockCompact : null]}>
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

function ProfileModal({ visible, compact, onClose, reports, myReports, currentUser, onLogout }) {
  const myCleanups = reports.filter((report) => report.picked_up).slice(0, 4)

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <Pressable style={[styles.profileCard, compact ? styles.profileCardCompact : null]}>
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

function ReportComposer({ visible, compact, draft, coordinate, onClose, onDraftChange, onSubmit }) {
  const isIncident = draft.reportType === 'incident'

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <View style={[styles.reportSheet, compact ? styles.reportSheetCompact : null]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Report refuse</Text>
            <TouchableOpacity style={styles.modalCloseButton} onPress={onClose}>
              <Ionicons name="close" size={18} color="#44537a" />
            </TouchableOpacity>
          </View>

          <Text style={styles.coordinateText}>
            {coordinate ? `${coordinate.latitude.toFixed(5)}, ${coordinate.longitude.toFixed(5)}` : 'Tap the map to set a location'}
          </Text>

          <Text style={styles.inputLabel}>Report type</Text>
          <View style={styles.severityRow}>
            <TouchableOpacity
              style={[
                styles.sheetSeverityButton,
                !isIncident ? { backgroundColor: '#2f5d3a', borderColor: '#2f5d3a' } : null,
              ]}
              onPress={() => onDraftChange({ ...draft, reportType: 'trash', picked_up: draft.picked_up })}
            >
              <Text style={[styles.sheetSeverityText, !isIncident ? styles.sheetSeverityTextActive : null]}>Trash cleanup</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.sheetSeverityButton,
                isIncident ? { backgroundColor: '#7f1d1d', borderColor: '#7f1d1d' } : null,
              ]}
              onPress={() => onDraftChange({ ...draft, reportType: 'incident', picked_up: false })}
            >
              <Text style={[styles.sheetSeverityText, isIncident ? styles.sheetSeverityTextActive : null]}>Environmental incident</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.helperText}>{isIncident ? 'Use this when there is dumping, contamination, or urgent environmental harm.' : 'Use this for standard trash or debris reports.'}</Text>

          {!isIncident ? (
            <>
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
            </>
          ) : (
            <>
              <Text style={styles.inputLabel}>Incident type</Text>
              <View style={styles.severityRow}>
                <TouchableOpacity
                  style={[
                    styles.sheetSeverityButton,
                    draft.incidentKind === 'illegal_dumping' ? { backgroundColor: '#b71c1c', borderColor: '#b71c1c' } : null,
                  ]}
                  onPress={() => onDraftChange({ ...draft, incidentKind: 'illegal_dumping' })}
                >
                  <Text style={[styles.sheetSeverityText, draft.incidentKind === 'illegal_dumping' ? styles.sheetSeverityTextActive : null]}>Illegal dumping</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.sheetSeverityButton,
                    draft.incidentKind === 'ground_contamination' ? { backgroundColor: '#8b0000', borderColor: '#8b0000' } : null,
                  ]}
                  onPress={() => onDraftChange({ ...draft, incidentKind: 'ground_contamination' })}
                >
                  <Text style={[styles.sheetSeverityText, draft.incidentKind === 'ground_contamination' ? styles.sheetSeverityTextActive : null]}>Ground contamination</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.inputLabel}>Suspected source (optional)</Text>
              <TextInput
                placeholder="Company, vehicle, site owner..."
                placeholderTextColor="#8190b2"
                style={styles.inputField}
                value={draft.suspectedSource}
                onChangeText={(suspectedSource) => onDraftChange({ ...draft, suspectedSource })}
              />

              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>Immediate hazard</Text>
                <Switch value={draft.immediateHazard} onValueChange={(immediateHazard) => onDraftChange({ ...draft, immediateHazard })} />
              </View>
            </>
          )}

          <Text style={styles.inputLabel}>Notes</Text>
          <TextInput
            multiline
            numberOfLines={3}
            placeholder={isIncident ? 'Describe what you observed and any danger...' : 'Optional description...'}
            placeholderTextColor="#8190b2"
            style={[styles.textArea, compact ? styles.textAreaCompact : null]}
            value={draft.notes}
            onChangeText={(notes) => onDraftChange({ ...draft, notes })}
          />

          {!isIncident ? (
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>I already cleaned it up</Text>
              <Switch value={draft.picked_up} onValueChange={(picked_up) => onDraftChange({ ...draft, picked_up })} />
            </View>
          ) : null}

          <TouchableOpacity style={styles.primaryButton} onPress={onSubmit}>
            <Text style={styles.primaryButtonText}>{isIncident ? 'Save incident report' : 'Save report'}</Text>
          </TouchableOpacity>
        </View>
      </View>
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
  topbarCompact: {
    paddingHorizontal: 12,
    paddingVertical: 12,
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
  subtitleCompact: {
    fontSize: 11,
  },
  topbarMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingTop: 10,
  },
  topbarMetaRowCompact: {
    gap: 8,
    paddingTop: 8,
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
  mapShellCompact: {
    marginTop: 10,
    borderRadius: 20,
  },
  mapActionRail: {
    position: 'absolute',
    left: 10,
    right: 10,
    zIndex: 20,
  },
  mapActionRailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  mapActionRailRowCompact: {
    gap: 6,
  },
  mapActionRailContent: {
    gap: 8,
    paddingRight: 6,
  },
  mapActionRailContentCompact: {
    gap: 6,
  },
  mapActionButton: {
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  mapActionButtonCompact: {
    minHeight: 40,
    borderRadius: 12,
    paddingHorizontal: 11,
    paddingVertical: 8,
    gap: 6,
  },
  mapActionButtonIconOnly: {
    width: 44,
    justifyContent: 'center',
    paddingHorizontal: 0,
    gap: 0,
  },
  mapActionButtonStretch: {
    flex: 1,
    justifyContent: 'center',
  },
  mapActionButtonText: {
    color: '#fff',
    fontSize: 12,
    fontFamily: 'SpaceGrotesk_700Bold',
  },
  mapActionButtonTextCompact: {
    fontSize: 11,
  },
  tabScroll: {
    flex: 1,
    marginTop: 12,
  },
  tabScrollContent: {
    paddingBottom: 120,
    gap: 12,
  },
  activityCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(141, 173, 255, 0.25)',
    backgroundColor: 'rgba(248, 251, 255, 0.96)',
    padding: 14,
    gap: 10,
  },
  activityActionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  activityListItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d7def2',
    backgroundColor: '#ffffff',
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  activitySeverityDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  activityListTextWrap: {
    flex: 1,
  },
  activityListTitle: {
    color: '#26365f',
    fontSize: 12,
    fontFamily: 'SpaceGrotesk_700Bold',
  },
  activityListMeta: {
    color: '#5b6787',
    fontSize: 11,
    fontFamily: 'SpaceGrotesk_400Regular',
    marginTop: 2,
  },
  profilePanelCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(141, 173, 255, 0.25)',
    backgroundColor: 'rgba(248, 251, 255, 0.96)',
    padding: 14,
    gap: 12,
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
  toastInfoLower: {
    top: 164,
  },
  toastSuccess: {
    backgroundColor: 'rgba(25, 102, 52, 0.92)',
  },
  toastSoftError: {
    backgroundColor: 'rgba(128, 32, 32, 0.92)',
  },
  toastText: {
    color: '#fff',
    fontSize: 12,
    fontFamily: 'SpaceGrotesk_400Regular',
    textAlign: 'center',
  },
  trackingPill: {
    marginTop: 10,
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    backgroundColor: 'rgba(22, 83, 38, 0.72)',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  trackingPillText: {
    color: '#fff',
    fontSize: 11,
    fontFamily: 'SpaceGrotesk_700Bold',
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
  cleanupCelebrate: {
    position: 'absolute',
    left: 16,
    right: 16,
    borderRadius: 18,
    backgroundColor: 'rgba(18, 55, 34, 0.94)',
    borderWidth: 1,
    borderColor: 'rgba(118, 210, 149, 0.48)',
    paddingHorizontal: 16,
    paddingVertical: 14,
    zIndex: 40,
  },
  cleanupCelebrateTitle: {
    color: '#ecfff1',
    fontSize: 14,
    fontFamily: 'SpaceGrotesk_700Bold',
    marginBottom: 4,
  },
  cleanupCelebrateText: {
    color: '#dff7e5',
    fontSize: 12,
    lineHeight: 18,
    fontFamily: 'SpaceGrotesk_400Regular',
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
  fabStack: {
    position: 'absolute',
    right: 14,
    bottom: 24,
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
  modalCardCompact: {
    padding: 14,
    borderRadius: 16,
  },
  modalCardLarge: {
    borderRadius: 18,
    backgroundColor: '#f7f9ff',
    padding: 18,
    gap: 12,
  },
  modalCardLargeCompact: {
    padding: 14,
    gap: 10,
    borderRadius: 16,
  },
  profileCard: {
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.97)',
    padding: 18,
    gap: 10,
  },
  profileCardCompact: {
    padding: 14,
    gap: 8,
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
  tabsRowCompact: {
    gap: 6,
    paddingTop: 10,
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
  sectionBlockCompact: {
    paddingTop: 12,
    gap: 10,
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
  privacyStateRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  privacyStatePill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#c8d6ff',
    backgroundColor: '#f4f7ff',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  privacyStatePillActive: {
    borderColor: '#93c5fd',
    backgroundColor: '#eaf4ff',
  },
  privacyStateText: {
    color: '#526386',
    fontSize: 12,
    fontFamily: 'SpaceGrotesk_700Bold',
  },
  privacyStateTextActive: {
    color: '#1f4f8f',
  },
  inlineStatus: {
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.85)',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  inlineStatusSuccess: {
    backgroundColor: '#edf9f0',
  },
  inlineStatusError: {
    backgroundColor: '#fff0f0',
  },
  inlineStatusText: {
    color: '#44537a',
    fontSize: 12,
    lineHeight: 18,
    fontFamily: 'SpaceGrotesk_500Medium',
  },
  inlineStatusTextSuccess: {
    color: '#25643a',
  },
  inlineStatusTextError: {
    color: '#942b2b',
  },
  settingsActionStack: {
    gap: 10,
  },
  secondaryButtonFull: {
    borderWidth: 1,
    borderColor: '#8fa4d6',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eef3ff',
  },
  secondaryButtonText: {
    color: '#1f2f58',
    fontSize: 12,
    fontFamily: 'SpaceGrotesk_700Bold',
  },
  dangerButton: {
    borderRadius: 10,
    backgroundColor: '#a92626',
    paddingHorizontal: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  dangerButtonText: {
    color: '#fff',
    fontSize: 13,
    fontFamily: 'SpaceGrotesk_700Bold',
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  policyScrollContent: {
    gap: 10,
    paddingBottom: 4,
  },
  bottomTabBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(138, 180, 255, 0.28)',
    backgroundColor: 'rgba(12, 19, 38, 0.94)',
    paddingTop: 8,
    paddingHorizontal: 6,
    gap: 6,
  },
  bottomTabBarCompact: {
    paddingTop: 6,
    paddingHorizontal: 4,
    gap: 4,
  },
  tabNavButton: {
    flex: 1,
    borderRadius: 12,
    minHeight: 48,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  tabNavButtonActive: {
    backgroundColor: 'rgba(71, 121, 255, 0.25)',
  },
  tabNavButtonText: {
    color: '#9aa8cf',
    fontSize: 12,
    fontFamily: 'SpaceGrotesk_700Bold',
  },
  tabNavButtonTextActive: {
    color: '#dff1ff',
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
  reportSheetCompact: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 22,
    gap: 10,
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
  helperText: {
    color: '#65718f',
    fontSize: 12,
    fontFamily: 'SpaceGrotesk_400Regular',
    marginTop: -4,
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
  textAreaCompact: {
    minHeight: 72,
    paddingVertical: 9,
  },
  inputField: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#1f2743',
    fontFamily: 'SpaceGrotesk_400Regular',
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
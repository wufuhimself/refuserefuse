import { Platform } from 'react-native'

import { sampleReports } from './sampleReports'

function fallbackBaseUrl() {
  if (Platform.OS === 'android') return 'http://10.0.2.2:8000'
  if (Platform.OS === 'ios') return 'http://127.0.0.1:8000'
  return 'http://localhost:8000'
}

export function resolveApiBaseUrl() {
  return process.env.EXPO_PUBLIC_API_BASE_URL || fallbackBaseUrl()
}

export async function loadReports() {
  const baseUrl = resolveApiBaseUrl()

  try {
    const response = await fetch(`${baseUrl}/reports`)
    if (!response.ok) {
      throw new Error(`Backend returned ${response.status}`)
    }

    const reports = await response.json()
    return {
      reports,
      source: 'live',
      baseUrl,
      error: '',
    }
  } catch (error) {
    return {
      reports: sampleReports,
      source: 'demo',
      baseUrl,
      error: error instanceof Error ? error.message : 'Unable to reach backend',
    }
  }
}

async function authorizedJson(path, token, options = {}) {
  const baseUrl = resolveApiBaseUrl()
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  })

  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: 'Request failed' }))
    throw new Error(body?.detail || 'Request failed')
  }

  return response.json()
}

export function startLocationSession(token, consentVersion) {
  return authorizedJson('/location/sessions/start', token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ consent_version: consentVersion }),
  })
}

export function appendLocationPoints(token, sessionId, points) {
  return authorizedJson(`/location/sessions/${sessionId}/points`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ points }),
  })
}

export function stopLocationSession(token, sessionId) {
  return authorizedJson(`/location/sessions/${sessionId}/stop`, token, {
    method: 'POST',
  })
}

export function deleteStoredLocationHistory(token) {
  return authorizedJson('/location/history', token, {
    method: 'DELETE',
  })
}
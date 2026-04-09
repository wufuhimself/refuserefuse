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
import React, { useEffect, useState } from 'react'
import MapPage from './MapPage'
import PrivacyPolicyPage from './PrivacyPolicyPage'

export default function App(){
  const [hash, setHash] = useState(window.location.hash)

  useEffect(() => {
    function handleHashChange() {
      setHash(window.location.hash)
    }

    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  if (hash === '#/privacy-policy') {
    return <PrivacyPolicyPage />
  }

  return <MapPage />
}

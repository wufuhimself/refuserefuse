import { useEffect, useState } from 'react';
import * as Location from 'expo-location';

export default function useLocation() {
  const [loc, setLoc] = useState<{ latitude: number; longitude: number } | null>(null);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const position = await Location.getCurrentPositionAsync({});
      setLoc({ latitude: position.coords.latitude, longitude: position.coords.longitude });
    })();
  }, []);

  return loc;
}

import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';

// true while the device has a usable connection (unknown counts as online)
export function useIsOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => NetInfo.addEventListener((s) => {
    setOnline(s.isConnected !== false && s.isInternetReachable !== false);
  }), []);
  return online;
}

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// Session storage: the device's secure store (Keychain / Keystore) on Android / iOS; the browser's
// localStorage when the app runs on the web (expo-secure-store has no web implementation).
const web = Platform.OS === 'web';

export const storage = {
  async get(key: string): Promise<string | null> {
    if (web) {
      try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; }
    }
    return SecureStore.getItemAsync(key);
  },
  async set(key: string, value: string): Promise<void> {
    if (web) {
      try { globalThis.localStorage?.setItem(key, value); } catch { /* storage blocked */ }
      return;
    }
    await SecureStore.setItemAsync(key, value);
  },
  async remove(key: string): Promise<void> {
    if (web) {
      try { globalThis.localStorage?.removeItem(key); } catch { /* storage blocked */ }
      return;
    }
    await SecureStore.deleteItemAsync(key);
  },
};

import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { ActivityIndicator, Alert, Platform, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RootNavigator } from './src/navigation/RootNavigator';
import { useAuth } from './src/store/auth';
import { colors } from './src/theme';

// Web build: react-native-web's Alert.alert does nothing, so messages / confirmations go through
// the browser's alert / confirm instead (Android / iOS keep the native dialogs)
if (Platform.OS === 'web' && typeof window !== 'undefined') {
  Alert.alert = (title, message, buttons) => {
    const text = [title, message].filter(Boolean).join('\n\n');
    const list = buttons || [];
    if (list.length <= 1) {
      window.alert(text);
      list[0]?.onPress?.();
      return;
    }
    const cancel = list.find((b) => b.style === 'cancel');
    const ok = list.filter((b) => b !== cancel).pop();
    if (window.confirm(text)) ok?.onPress?.();
    else cancel?.onPress?.();
  };
}

// PB Exchange mobile (Expo): restore the saved session, then the app
export default function App() {
  const ready = useAuth((s) => s.ready);
  const hydrate = useAuth((s) => s.hydrate);

  useEffect(() => { void hydrate(); }, [hydrate]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="light" backgroundColor={colors.navyDark} />
        {ready ? <RootNavigator /> : (
          <View style={styles.splash}>
            <ActivityIndicator size="large" color={colors.white} />
          </View>
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
});

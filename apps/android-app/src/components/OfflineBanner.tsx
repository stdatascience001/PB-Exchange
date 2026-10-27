import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useIsOnline } from '../hooks/useNetwork';
import { colors } from '../theme';

// Thin bar shown while the device is offline
export function OfflineBanner() {
  const online = useIsOnline();
  if (online) return null;
  return (
    <View style={styles.bar}>
      <MaterialIcons name="wifi-off" size={16} color={colors.white} />
      <Text style={styles.text}>No internet connection — showing the last loaded data</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { backgroundColor: colors.crimson, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 6 },
  text: { color: colors.white, fontSize: 12, fontWeight: '600' },
});

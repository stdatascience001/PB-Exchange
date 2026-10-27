import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { tap } from '../utils/haptics';

// Inner screens (live app): ← TITLE on the navy bar
export function BackHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingTop: insets.top + 10 }]}>
      <Pressable
        accessibilityLabel="Back"
        hitSlop={12}
        onPress={() => { tap(); if (navigation.canGoBack()) navigation.goBack(); }}
        style={styles.back}
      >
        <MaterialIcons name="arrow-back" size={28} color={colors.white} />
      </Pressable>
      <Text style={styles.title} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{title}</Text>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.navy,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 18,
  },
  back: { padding: 4, marginRight: 28 },
  title: { flex: 1, color: colors.white, fontSize: 26, fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.2 },
});

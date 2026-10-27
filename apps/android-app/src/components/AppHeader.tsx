import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { DrawerActions, useNavigation } from '@react-navigation/native';
import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { canOpenRoute } from '../config/roleAccess';
import { useAuth } from '../store/auth';
import { colors, radius, shadow } from '../theme';
import { tap } from '../utils/haptics';

// Main bar of the tab screens (live app): ≡ menu · "PB EXCHANGE" with a superscript LIVE ·
// staff-working icon · ⋮ overflow (Profile, Staff Working, Logout)
export function AppHeader() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const logout = useAuth((s) => s.logout);
  const role = useAuth((s) => s.user?.roleName);
  const staffWorking = canOpenRoute(role, 'StaffWorking');
  const [menuOpen, setMenuOpen] = useState(false);

  const go = (route: string) => {
    setMenuOpen(false);
    navigation.navigate(route);
  };

  return (
    <View style={[styles.bar, { paddingTop: insets.top + 6 }]}>
      <Pressable
        accessibilityLabel="Open menu"
        hitSlop={10}
        onPress={() => { tap(); navigation.dispatch(DrawerActions.toggleDrawer()); }}
        style={styles.icon}
      >
        <MaterialIcons name="menu" size={30} color={colors.white} />
      </Pressable>
      <View style={styles.brandWrap}>
        <Text style={styles.brand} numberOfLines={1}>PB EXCHANGE</Text>
        <Text style={styles.live}>LIVE</Text>
      </View>
      {staffWorking && (
        <Pressable accessibilityLabel="Staff working" hitSlop={10} onPress={() => { tap(); navigation.navigate('StaffWorking'); }} style={styles.icon}>
          <MaterialCommunityIcons name="briefcase-off" size={26} color={colors.white} />
        </Pressable>
      )}
      <Pressable accessibilityLabel="More options" hitSlop={10} onPress={() => { tap(); setMenuOpen(true); }} style={styles.icon}>
        <MaterialIcons name="more-vert" size={28} color={colors.white} />
      </Pressable>

      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setMenuOpen(false)}>
          <View style={[styles.menu, { top: insets.top + 52 }]}>
            <MenuItem icon="person" label="Profile" onPress={() => go('Profile')} />
            {staffWorking && <MenuItem icon="groups" label="Staff Working" onPress={() => go('StaffWorking')} />}
            <MenuItem icon="logout" label="Logout" danger onPress={() => { setMenuOpen(false); void logout(); }} />
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function MenuItem({ icon, label, onPress, danger }: { icon: keyof typeof MaterialIcons.glyphMap; label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable onPress={() => { tap(); onPress(); }} style={({ pressed }) => [styles.menuItem, pressed && { backgroundColor: colors.canvas }]}>
      <MaterialIcons name={icon} size={20} color={danger ? colors.crimson : colors.navy} />
      <Text style={[styles.menuText, danger && { color: colors.crimson }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.navy,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingBottom: 14,
  },
  icon: { padding: 6 },
  brandWrap: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', marginLeft: 12 },
  brand: { color: colors.white, fontSize: 30, fontWeight: '500', letterSpacing: -0.5 },
  live: { color: colors.white, fontSize: 11, fontWeight: '600', marginLeft: 3, marginTop: -2 },
  backdrop: { flex: 1 },
  menu: {
    position: 'absolute',
    right: 12,
    minWidth: 190,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingVertical: 6,
    ...shadow,
    elevation: 8,
  },
  menuItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  menuText: { fontSize: 15, color: colors.text, fontWeight: '500' },
});

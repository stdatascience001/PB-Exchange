import { MaterialIcons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiRequest, errorMessage } from '../api/client';
import type { Staff } from '../api/types';
import { BackHeader } from '../components/BackHeader';
import { FormField, PrimaryButton } from '../components/Controls';
import { useAuth } from '../store/auth';
import { colors, radius, shadow } from '../theme';
import { failure, success, tap } from '../utils/haptics';

// PROFILE (live app): HI, NAME. + role pill, the mobile number, and Menus: Change Password, Logout
export function ProfileScreen() {
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const [mobile, setMobile] = useState<string>('-');
  const [pwdOpen, setPwdOpen] = useState(false);

  // The signed-in user's mobile comes from their staff record (none for a developer login)
  useEffect(() => {
    let alive = true;
    apiRequest<Staff[]>('/staff')
      .then((res) => {
        const me = (res.data || []).find((s) => s.userId === user?.userId);
        if (alive && me?.mobile) setMobile(me.mobile);
      })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [user?.userId]);

  const confirmLogout = () => {
    tap();
    Alert.alert('Logout', 'Do you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Logout', style: 'destructive', onPress: () => { void logout(); } },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <BackHeader title="Profile" />
      <View style={styles.head}>
        <View style={styles.headRow}>
          <Text style={styles.hi} numberOfLines={1}>HI, {(user?.username || '').toUpperCase()}.</Text>
          <View style={styles.rolePill}><Text style={styles.roleText}>{(user?.roleName || '').toUpperCase()}</Text></View>
        </View>
        <View style={styles.mobileBox}>
          <MaterialIcons name="phone" size={30} color="#555" />
          <Text style={styles.mobileLabel}>MOBILE</Text>
          <Text style={styles.mobileValue}>{mobile}</Text>
        </View>
      </View>

      <Text style={styles.menus}>Menus</Text>
      <MenuCard label="Change Password" onPress={() => { tap(); setPwdOpen(true); }} />
      <MenuCard label="Logout" onPress={confirmLogout} />

      <ChangePasswordModal visible={pwdOpen} onClose={() => setPwdOpen(false)} />
    </View>
  );
}

function MenuCard({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.menuCard, pressed && { opacity: 0.7 }]}>
      <MaterialIcons name="lock" size={34} color="#555" />
      <Text style={styles.menuText}>{label}</Text>
    </Pressable>
  );
}

// POST /auth/change-password { currentPassword, newPassword } — same as the web profile menu
function ChangePasswordModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => { setCurrent(''); setNext(''); setConfirm(''); setError(null); };
  const close = () => { reset(); onClose(); };

  const save = async () => {
    setError(null);
    if (!current || !next) { setError('Please enter all valid fields!'); failure(); return; }
    if (next.length < 6) { setError('New password must be at least 6 characters'); failure(); return; }
    if (next !== confirm) { setError('New password and confirm password do not match'); failure(); return; }
    setSaving(true);
    try {
      await apiRequest('/auth/change-password', { method: 'POST', body: { currentPassword: current, newPassword: next } });
      success();
      Alert.alert('Message', 'Password changed successfully!');
      close();
    } catch (err) {
      failure();
      setError(errorMessage(err, 'Failed to change password'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>Change Password</Text>
            <Pressable hitSlop={12} onPress={close}><MaterialIcons name="close" size={24} color={colors.text} /></Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled">
            {!!error && <Text style={styles.error}>{error}</Text>}
            <FormField label="Current Password" value={current} onChangeText={setCurrent} secureTextEntry autoCapitalize="none" />
            <FormField label="New Password" value={next} onChangeText={setNext} secureTextEntry autoCapitalize="none" />
            <FormField label="Confirm Password" value={confirm} onChangeText={setConfirm} secureTextEntry autoCapitalize="none" />
            <PrimaryButton label="UPDATE PASSWORD" onPress={save} loading={saving} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  head: { backgroundColor: colors.navy, paddingHorizontal: 22, paddingBottom: 26, paddingTop: 4 },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  hi: { flex: 1, color: colors.white, fontSize: 26, fontWeight: '700' },
  rolePill: { backgroundColor: colors.white, borderRadius: radius.pill, paddingHorizontal: 18, paddingVertical: 5, borderWidth: 2, borderColor: '#D1D5DB' },
  roleText: { color: '#374151', fontSize: 16, fontWeight: '700' },
  mobileBox: { backgroundColor: colors.white, borderRadius: radius.sm, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 18, gap: 18 },
  mobileLabel: { flex: 1, fontSize: 22, fontWeight: '600', color: '#555' },
  mobileValue: { fontSize: 22, fontWeight: '600', color: '#555' },
  menus: { fontSize: 22, fontWeight: '700', color: colors.text, marginHorizontal: 22, marginTop: 26, marginBottom: 14 },
  menuCard: {
    backgroundColor: colors.white,
    borderRadius: radius.sm,
    marginHorizontal: 22,
    marginBottom: 22,
    paddingVertical: 22,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 40,
    ...shadow,
  },
  menuText: { fontSize: 20, color: '#555', fontWeight: '500' },
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 20, maxHeight: '85%' },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  sheetTitle: { fontSize: 20, fontWeight: '700', color: colors.navy },
  error: { color: colors.crimson, fontWeight: '600', marginBottom: 12 },
});

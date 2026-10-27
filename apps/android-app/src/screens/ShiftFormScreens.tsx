import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiRequest, errorMessage } from '../api/client';
import type { ShiftRoleTime } from '../api/types';
import { BackHeader } from '../components/BackHeader';
import { CalendarModal } from '../components/CalendarModal';
import { TimePickerModal } from '../components/TimePickerModal';
import type { RootStackParamList } from '../navigation/types';
import { colors, radius, shadow } from '../theme';
import { dmy, isoDate } from '../utils/format';
import { failure, success, tap } from '../utils/haptics';
import { Button, formStyles, PickBox } from './StaffFormScreens';

// Shift add / update (live app: All Shifts → tap a shift, or ADD SHIFT). Same calls and rules as
// the web Shift Management page:
//   Update time  title "<SHIFT> | <open date>", the 12 roles with their cut-off time; tap a time
//                → clock picker; UPDATE TIME  PATCH /shifts/:id { roleConfigs }
//   Shift info   (long-press a shift) PATCH /shifts/:id { name, openDate, isNextDay, shiftFor }
//   Add          POST /shifts { name, openDate, isNextDay, shiftFor, roleConfigs }
//                Shift Name required ("Invalid / Please enter all valid fields!")

export const SHIFT_ROLES = [
  { id: 1, name: 'DEVELOPER' },
  { id: 2, name: 'SUPER ADMIN' },
  { id: 3, name: 'DISTRIBUTOR' },
  { id: 4, name: 'RETAILER' },
  { id: 5, name: 'FANTER' },
  { id: 6, name: 'CASH AGENT' },
  { id: 7, name: 'ADMIN' },
  { id: 8, name: 'MANAGER' },
  { id: 9, name: 'MARKETER' },
  { id: 10, name: 'AUDITOR' },
  { id: 11, name: 'DATA ENTRY OPERATOR' },
  { id: 12, name: 'TALLY OPERATOR' },
];
const SHIFT_FOR = ['BOTH', 'MANUAL', 'AUTO'];
const DEFAULT_TIME = '20:44';

type Times = Record<number, string>;
const hhmm = (t?: string | null) => (t ? t.slice(0, 5) : DEFAULT_TIME);
const fromConfigs = (rows: ShiftRoleTime[] | undefined, base: Times): Times => {
  const next = { ...base };
  (rows || []).forEach((rc) => { if (rc.closeTime) next[rc.roleId] = hhmm(rc.closeTime); });
  return next;
};
const defaults = (): Times => Object.fromEntries(SHIFT_ROLES.map((r) => [r.id, DEFAULT_TIME]));

// ---- Update time ----------------------------------------------------------------------------------
export function UpdateShiftScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { params } = useRoute<RouteProp<RootStackParamList, 'UpdateShift'>>();
  const s = params.shift;
  // times from the shift list show at once; the shift's own timing list replaces them when it lands
  const [times, setTimes] = useState<Times>(() => fromConfigs(s.roleConfigs, defaults()));
  const [openTimes, setOpenTimes] = useState<Record<number, string>>(() =>
    Object.fromEntries((s.roleConfigs || []).filter((rc) => rc.openTime).map((rc) => [rc.roleId, rc.openTime as string])));
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    apiRequest<ShiftRoleTime[]>(`/shifts/${s.id}/timings`)
      .then((res) => {
        if (!live || !Array.isArray(res.data)) return;
        setTimes((prev) => fromConfigs(res.data, prev));
        setOpenTimes((prev) => ({ ...prev, ...Object.fromEntries(res.data!.filter((rc) => rc.openTime).map((rc) => [rc.roleId, rc.openTime as string])) }));
      })
      .catch(() => { /* keep the shift list's times */ })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [s.id]);

  const save = async () => {
    setSaving(true);
    try {
      await apiRequest(`/shifts/${s.id}`, {
        method: 'PATCH',
        body: {
          roleConfigs: SHIFT_ROLES.map((r) => ({
            roleId: r.id,
            closeTime: `${times[r.id] || DEFAULT_TIME}:00`,
            ...(openTimes[r.id] ? { openTime: openTimes[r.id] } : {}),
          })),
        },
      });
      success();
      Alert.alert('Success', `${s.name} Shift (Time) has been updated successfully!`);
      navigation.goBack();
    } catch (err) {
      failure();
      Alert.alert('Message', errorMessage(err, 'Failed to save'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <BackHeader title={`${s.name} | ${dmy(s.openDate)}`} />
      <FlatList
        data={SHIFT_ROLES}
        keyExtractor={(r) => String(r.id)}
        contentContainerStyle={{ padding: 14, gap: 12 }}
        ListHeaderComponent={loading ? <ActivityIndicator color={colors.navy} style={{ marginBottom: 4 }} /> : null}
        renderItem={({ item, index }) => (
          <Pressable
            accessibilityLabel={`${item.name} time`}
            onPress={() => { tap(); setEditing(item.id); }}
            style={({ pressed }) => [styles.roleCard, pressed && { backgroundColor: colors.canvas }]}
          >
            <Text style={styles.roleIndex}>{index + 1}.</Text>
            <Text style={styles.roleName} numberOfLines={1}>{item.name}</Text>
            <Text style={styles.roleTime}>{times[item.id] || DEFAULT_TIME}</Text>
          </Pressable>
        )}
      />
      <Pressable
        disabled={saving}
        onPress={() => { tap(); void save(); }}
        style={({ pressed }) => [styles.bottomBar, { paddingBottom: 18 + insets.bottom }, pressed && { backgroundColor: colors.navyDark }]}
      >
        {saving ? <ActivityIndicator color={colors.white} /> : <Text style={styles.bottomText}>UPDATE TIME</Text>}
      </Pressable>
      <TimePickerModal
        visible={editing !== null}
        value={editing !== null ? times[editing] : null}
        onCancel={() => setEditing(null)}
        onConfirm={(t) => { if (editing !== null) setTimes((p) => ({ ...p, [editing]: t })); setEditing(null); }}
      />
    </View>
  );
}

// ---- Add / shift info --------------------------------------------------------------------------
export function AddShiftScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { params } = useRoute<RouteProp<RootStackParamList, 'AddShift'>>();
  const edit = params?.shift; // long-press on a shift: edit its info instead of adding one
  const [name, setName] = useState(edit?.name || '');
  const [openDate, setOpenDate] = useState(edit?.openDate?.slice(0, 10) || isoDate(new Date()));
  const [nextDay, setNextDay] = useState(edit ? (edit.isNextDay ? 'YES' : 'NO') : 'NO');
  const [shiftFor, setShiftFor] = useState((edit?.shiftFor || 'BOTH').toUpperCase());
  const [times, setTimes] = useState<Times>(defaults);
  const [pick, setPick] = useState<'NEXT' | 'FOR' | null>(null);
  const [calendar, setCalendar] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) {
      failure();
      Alert.alert('Invalid', 'Please enter all valid fields!');
      return;
    }
    setSaving(true);
    const info = { name: name.trim().toUpperCase(), openDate, isNextDay: nextDay === 'YES', shiftFor };
    try {
      if (edit) {
        await apiRequest(`/shifts/${edit.id}`, { method: 'PATCH', body: info });
        success();
        Alert.alert('Success', `${info.name} Shift (Info) has been updated successfully!`);
      } else {
        await apiRequest('/shifts', {
          method: 'POST',
          body: {
            ...info,
            roleConfigs: SHIFT_ROLES.map((r) => ({ roleId: r.id, openTime: '09:00:00', closeTime: `${times[r.id] || DEFAULT_TIME}:00`, isActive: true })),
          },
        });
        success();
        Alert.alert('Success', 'Shift has been saved successfully!');
      }
      navigation.goBack();
    } catch (err) {
      failure();
      Alert.alert('Message', errorMessage(err, edit ? 'Failed to update shift' : 'Failed to create shift'));
    } finally {
      setSaving(false);
    }
  };

  const options = pick === 'NEXT' ? ['NO', 'YES'] : pick === 'FOR' ? SHIFT_FOR : [];

  return (
    <View style={{ flex: 1, backgroundColor: '#E5E7EB' }}>
      <BackHeader title={edit ? edit.name : 'Add Shift'} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24 }} keyboardShouldPersistTaps="handled">
          <View style={formStyles.card}>
            <Text style={formStyles.label}>Shift Name</Text>
            <TextInput value={name} onChangeText={setName} autoCapitalize="characters" autoCorrect={false} style={formStyles.input} />
            <View style={formStyles.two}>
              <View style={{ flex: 1 }}><Text style={formStyles.label}>Open Date</Text><PickBox value={dmy(openDate)} onPress={() => setCalendar(true)} /></View>
              <View style={{ flex: 1 }}><Text style={formStyles.label}>Next Day</Text><PickBox value={nextDay} onPress={() => setPick('NEXT')} /></View>
            </View>
            <Text style={formStyles.label}>Shift Working For</Text>
            <PickBox value={shiftFor} onPress={() => setPick('FOR')} />

            {!edit && (
              <View style={styles.grid}>
                {SHIFT_ROLES.map((r) => (
                  <View key={r.id} style={styles.gridCell}>
                    <Text style={[formStyles.label, { fontSize: 13 }]} numberOfLines={1}>{r.name}</Text>
                    <PickBox value={times[r.id]} onPress={() => setEditing(r.id)} />
                  </View>
                ))}
              </View>
            )}
            <Button label={edit ? 'UPDATE SHIFT' : 'ADD SHIFT'} busy={saving} onPress={() => { void save(); }} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <CalendarModal visible={calendar} value={openDate} onCancel={() => setCalendar(false)} onConfirm={(iso) => { setOpenDate(iso); setCalendar(false); }} />
      <TimePickerModal
        visible={editing !== null}
        value={editing !== null ? times[editing] : null}
        onCancel={() => setEditing(null)}
        onConfirm={(t) => { if (editing !== null) setTimes((p) => ({ ...p, [editing]: t })); setEditing(null); }}
      />
      <Modal visible={pick !== null} transparent animationType="fade" onRequestClose={() => setPick(null)}>
        <Pressable style={styles.backdrop} onPress={() => setPick(null)}>
          <View style={styles.menu}>
            {options.map((o) => (
              <Pressable
                key={o}
                onPress={() => { tap(); if (pick === 'NEXT') setNextDay(o); else setShiftFor(o); setPick(null); }}
                style={({ pressed }) => [styles.menuItem, pressed && { backgroundColor: colors.canvas }]}
              >
                <Text style={styles.menuText}>{o}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  roleCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1.5, borderColor: colors.border, paddingHorizontal: 20, paddingVertical: 16,
  },
  roleIndex: { width: 36, fontSize: 20, fontWeight: '700', color: colors.text },
  roleName: { flex: 1, fontSize: 20, fontWeight: '700', color: colors.text, textTransform: 'uppercase' },
  roleTime: { fontSize: 22, fontWeight: '700', color: colors.amber, marginLeft: 10, marginRight: 20 },
  bottomBar: { backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center', paddingTop: 18 },
  bottomText: { color: colors.white, fontSize: 20, fontWeight: '600', letterSpacing: 0.3 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: 4 },
  gridCell: { width: '48.5%' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  menu: { width: '78%', backgroundColor: colors.surface, borderRadius: 4, ...shadow, elevation: 10 },
  menuItem: { paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.divider },
  menuText: { fontSize: 16, color: colors.text },
});

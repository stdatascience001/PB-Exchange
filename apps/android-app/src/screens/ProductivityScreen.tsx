import { MaterialIcons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Alert, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiRequest, errorMessage } from '../api/client';
import type { Shift } from '../api/types';
import { BackHeader } from '../components/BackHeader';
import { CalendarModal } from '../components/CalendarModal';
import { CenterMessage, SearchBox } from '../components/Controls';
import { WaitDialog } from '../components/WaitDialog';
import { useApiList } from '../hooks/useApiList';
import { colors, radius, shadow } from '../theme';
import { dmy, num } from '../utils/format';
import { failure, tap } from '../utils/haptics';

// PRODUCTIVITY TRANSACTION (live app, Report → Productivity Report): From – To dates (calendars),
// MINUTE DIFF (D-Min), shift (ALL SHIFT or one) · FIND, "SEARCH PARTY, USERNAME...", then per operator:
// username, name, mobile (amber), address (green); FR-COUNT · FR-TIME · TIME-TK · T-TIME · T-COUNT ·
// T-AMT. Opens on the From calendar, then To, then loads. Same API as the web Productivity Report
// (GET /transactions/productivity-report?fromDate&toDate&shiftId&dMin); times printed H.MM as live.
interface Row {
  staffId: number; name: string; mobile: string; address: string; role: string; username: string;
  freeCount: number; freeTime: number; timeTaken: number; tTime: number; tCount: number; tAmount: number;
}

// seconds -> "H.MM" (0 when none), as the web / live report
const hm = (sec: number) => {
  const s = Math.max(0, Math.round(sec || 0));
  if (s === 0) return '0';
  return `${Math.floor(s / 3600)}.${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
};

const ALL = '';

export function ProductivityScreen() {
  const insets = useSafeAreaInsets();
  const shifts = useApiList<Shift>('/shifts');
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [picking, setPicking] = useState<'FROM' | 'TO' | null>('FROM');
  const [chain, setChain] = useState(true);
  const [dMin, setDMin] = useState('');
  const [shiftId, setShiftId] = useState(ALL);
  const [shiftMenu, setShiftMenu] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  const activeShifts = useMemo(() => shifts.data.filter((s) => s.isActive !== false), [shifts.data]);
  const shiftName = shiftId === ALL ? 'ALL SHIFT' : activeShifts.find((s) => String(s.id) === shiftId)?.name || 'ALL SHIFT';

  const load = async (f: string | null = from, t: string | null = to) => {
    if (!f || !t) { failure(); Alert.alert('Message', 'Please select both Dates!'); return; }
    if (f > t) { failure(); Alert.alert('Message', 'From Date cannot be after To Date!'); return; }
    setLoading(true);
    try {
      const d = parseFloat(dMin);
      const q = `/transactions/productivity-report?fromDate=${f}&toDate=${t}${shiftId ? `&shiftId=${shiftId}` : ''}${d > 0 ? `&dMin=${d}` : ''}`;
      const res = await apiRequest<Row[]>(q);
      setRows(res.data || []);
      if (!res.data?.length) Alert.alert('Error', 'Record not avaliable!');
    } catch (err) {
      failure();
      Alert.alert('Message', errorMessage(err, 'Failed to load report'));
    } finally {
      setLoading(false);
    }
  };

  const onPicked = (d: string) => {
    if (picking === 'FROM') {
      setFrom(d);
      if (chain) { setTo((prev) => (prev && prev >= d ? prev : d)); setPicking('TO'); return; }
      setPicking(null);
      return;
    }
    setTo(d);
    setPicking(null);
    if (chain) { setChain(false); void load(from, d); }
  };

  const list = useMemo(() => {
    const t = search.trim().toUpperCase();
    return (rows || []).filter((r) => !t || [r.username, r.name, r.mobile, r.address].some((v) => String(v || '').toUpperCase().includes(t)));
  }, [rows, search]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <BackHeader title="Productivity Transaction" right={<MaterialIcons name="more-vert" size={28} color={colors.white} />} />
      <View style={styles.filters}>
        <DateBox value={from} onPress={() => { setChain(false); setPicking('FROM'); }} />
        <DateBox value={to} onPress={() => { setChain(false); setPicking('TO'); }} />
        <TextInput
          value={dMin}
          onChangeText={setDMin}
          keyboardType="number-pad"
          placeholder="MINUTE DIFF..."
          placeholderTextColor={colors.textMuted}
          style={[styles.box, styles.minInput]}
        />
      </View>
      <View style={[styles.filters, { paddingTop: 0 }]}>
        <Pressable onPress={() => { tap(); setShiftMenu(true); }} style={({ pressed }) => [styles.box, { flex: 1.15 }, pressed && { backgroundColor: colors.canvas }]}>
          <Text style={styles.shiftText} numberOfLines={1}>{shiftName}</Text>
        </Pressable>
        <Pressable onPress={() => { tap(); void load(); }} style={({ pressed }) => [styles.find, pressed && { backgroundColor: colors.navyDark }]}>
          <Text style={styles.findText}>FIND</Text>
        </Pressable>
      </View>
      <SearchBox value={search} onChangeText={setSearch} placeholder="SEARCH PARTY, USERNAME..." />
      <View style={styles.sep} />

      <FlatList
        data={list}
        keyExtractor={(r, i) => `${r.staffId}-${i}`}
        initialNumToRender={12}
        ListEmptyComponent={rows && !loading ? <CenterMessage text="Record not avaliable!" /> : null}
        contentContainerStyle={{ flexGrow: 1, paddingBottom: insets.bottom + 8 }}
        renderItem={({ item, index }) => (
          <View style={styles.row}>
            <Text style={styles.index}>{index + 1}.</Text>
            <View style={{ flex: 1 }}>
              <View style={styles.top}>
                <Text style={styles.user} numberOfLines={1}>{item.username}</Text>
                <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.mobile} numberOfLines={1}>{item.mobile && item.mobile !== '-' ? item.mobile : ''}</Text>
                <Text style={styles.address} numberOfLines={1}>{item.address && item.address !== '-' ? item.address : ''}</Text>
              </View>
              <View style={styles.line} />
              <View style={styles.figs}>
                <Fig label="FR-COUNT" value={String(item.freeCount)} color="#E8961E" align="flex-start" />
                <Fig label="FR-TIME" value={hm(item.freeTime)} color="#43A047" />
                <Fig label="TIME-TK" value={hm(item.timeTaken)} color="#E8961E" />
                <Fig label="T-TIME" value={hm(item.tTime)} color="#29A3D8" />
                <Fig label="T-COUNT" value={String(item.tCount)} color="#E8961E" />
                <Fig label="T-AMT" value={String(Math.round(num(item.tAmount)))} color="#29A3D8" align="flex-end" />
              </View>
            </View>
          </View>
        )}
      />

      <Modal visible={shiftMenu} transparent animationType="fade" onRequestClose={() => setShiftMenu(false)}>
        <Pressable style={{ flex: 1 }} onPress={() => setShiftMenu(false)}>
          <View style={[styles.menu, { top: insets.top + 130 }]}>
            <FlatList
              data={[{ id: ALL, name: 'ALL SHIFT' }, ...activeShifts.map((s) => ({ id: String(s.id), name: s.name }))]}
              keyExtractor={(s) => s.id || 'all'}
              renderItem={({ item }) => (
                <Pressable onPress={() => { tap(); setShiftId(item.id); setShiftMenu(false); }} style={({ pressed }) => [styles.menuItem, pressed && { backgroundColor: colors.canvas }]}>
                  <Text style={[styles.menuText, item.id === shiftId && { fontWeight: '700', color: colors.navy }]} numberOfLines={1}>{item.name}</Text>
                </Pressable>
              )}
            />
          </View>
        </Pressable>
      </Modal>
      <CalendarModal
        visible={picking !== null}
        value={picking === 'TO' ? (to || from) : from}
        onCancel={() => { setPicking(null); setChain(false); }}
        onConfirm={onPicked}
      />
      <WaitDialog visible={loading} />
    </View>
  );
}

function DateBox({ value, onPress }: { value: string | null; onPress: () => void }) {
  return (
    <Pressable onPress={() => { tap(); onPress(); }} style={({ pressed }) => [styles.box, pressed && { backgroundColor: colors.canvas }]}>
      <Text style={styles.dateText}>{value ? dmy(value) : '00-00-0000'}</Text>
    </Pressable>
  );
}

function Fig({ label, value, color, align = 'center' }: { label: string; value: string; color: string; align?: 'flex-start' | 'center' | 'flex-end' }) {
  return (
    <View style={{ flex: 1, alignItems: align }}>
      <Text style={[styles.figLabel, { color, opacity: 0.75 }]} numberOfLines={1} adjustsFontSizeToFit>{label}</Text>
      <Text style={[styles.figValue, { color }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', gap: 8, paddingHorizontal: 8, paddingVertical: 10 },
  box: { flex: 1, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, justifyContent: 'center', paddingVertical: 14, paddingHorizontal: 8, minWidth: 0 },
  dateText: { fontSize: 16, color: colors.textMuted, textAlign: 'center' },
  minInput: { fontSize: 16, color: colors.text, textAlign: 'center' },
  shiftText: { fontSize: 18, color: colors.text, textTransform: 'uppercase', paddingLeft: 8 },
  find: { flex: 1, backgroundColor: colors.navy, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', ...shadow },
  findText: { color: colors.white, fontSize: 18, fontWeight: '600' },
  sep: { height: 1, backgroundColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceMuted, borderBottomWidth: 1.5, borderBottomColor: '#E2E8F0', paddingVertical: 12, paddingHorizontal: 10 },
  index: { width: 34, fontSize: 18, color: colors.text },
  top: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  user: { fontSize: 16, fontWeight: '600', color: colors.text },
  name: { fontSize: 16, color: '#555', flexShrink: 1 },
  mobile: { fontSize: 16, fontWeight: '600', color: '#E8961E' },
  address: { fontSize: 16, fontWeight: '600', color: '#43A047', flexShrink: 1 },
  line: { height: 1, backgroundColor: colors.divider, marginVertical: 5 },
  figs: { flexDirection: 'row' },
  figLabel: { fontSize: 11.5, fontWeight: '600' },
  figValue: { fontSize: 14, fontWeight: '600', marginTop: 3 },
  menu: { position: 'absolute', left: 10, width: '58%', maxHeight: '75%', backgroundColor: colors.surface, borderRadius: 3, ...shadow, elevation: 10 },
  menuItem: { paddingHorizontal: 16, paddingVertical: 14 },
  menuText: { fontSize: 16, color: colors.text, textTransform: 'uppercase' },
});

import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, ToastAndroid, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiRequest, errorMessage } from '../api/client';
import { BackHeader } from '../components/BackHeader';
import { CalendarModal, CORAL } from '../components/CalendarModal';
import { CenterMessage, SearchBox } from '../components/Controls';
import { WaitDialog } from '../components/WaitDialog';
import type { RootStackParamList } from '../navigation/types';
import { colors, radius, shadow } from '../theme';
import { dmy, dmyTime, num } from '../utils/format';
import { failure, tap } from '../utils/haptics';

// A shift's slips (live app: Dashboard → tap a shift). LIVE TRANSACTION = the shift's running
// cycle; DECLARED TRANSACTION = a picked date (calendar) · FIND. Each slip: party, who entered it
// (cyan), its amount " /-" and time, newest first; a slip edited after entry gets a blue bar on the
// right and "DIFF: hh:mm:ss" (entry → last edit, purple); a slip audited as Mistake a red bar on the left.
// TOTAL AMOUNT on the navy bar. Coral buttons: Jantri (MAIN JANTRI / JANTRI) and the party-wise sale.
// Same API as the web transaction lists (GET /transactions?shiftId&date).
// A shift whose number is already declared has no live slips: LIVE TRANSACTION stays empty and
// the screen opens on DECLARED TRANSACTION, already on the shift's date and loaded. Switching to
// LIVE there shows the "Record not avaliable!" toast, and its Jantri buttons go to DECLARED instead.
// Tapping a slip (either tab) opens that slip's own "<SHIFT> JANTRI": its entries on the 1 … 100,
// 000 … 999, 0000 … 9999 grid with the slip's TOTAL AMOUNT.
interface SlipEntry { numberValue: string; amount: number; entryType: string }
interface Slip {
  id: number; partyName: string; totalAmount: number; addedBy?: string; updatedBy?: string;
  createdAt: string; updatedAt?: string; isEdited?: boolean; status?: string; auditStatus?: string;
  entries?: SlipEntry[];
}
type Tab = 'LIVE' | 'DECLARED';

const hms = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
};

export function ShiftTransactionsScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const { params } = useRoute<RouteProp<RootStackParamList, 'ShiftTransactions'>>();
  const declared = !!params.declared;
  const [tab, setTab] = useState<Tab>(declared ? 'DECLARED' : 'LIVE');
  const [date, setDate] = useState<string | null>(declared ? params.date : null);
  const [calendar, setCalendar] = useState(false);
  const [slips, setSlips] = useState<Slip[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [jantriOpen, setJantriOpen] = useState(false);
  const [partiesOpen, setPartiesOpen] = useState(false);
  const [openSlip, setOpenSlip] = useState<Slip | null>(null);
  // short bottom message (live app: Android toast); the web / iOS build draws its own pill
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((msg: string) => {
    if (Platform.OS === 'android') { ToastAndroid.show(msg, ToastAndroid.SHORT); return; }
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);
  // Jantri from LIVE of a declared shift: no live data, so open DECLARED TRANSACTION instead
  const openJantri = (net: boolean) => {
    setJantriOpen(false);
    if (declared && tab === 'LIVE') { setTab('DECLARED'); return; }
    navigation.navigate('Jantri', { shiftId: params.shiftId, shiftName: params.shiftName, date: viewDate, net });
  };

  // a reply for an earlier tab / date never overwrites the list now on screen
  const seq = useRef(0);
  const load = useCallback(async (d: string) => {
    const my = ++seq.current;
    setLoading(true);
    try {
      const res = await apiRequest<Slip[]>(`/transactions?shiftId=${params.shiftId}&date=${d}`);
      if (my !== seq.current) return;
      const list = (res.data || []).filter((s) => s.status !== 'VOIDED')
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '') || b.id - a.id);
      setSlips(list);
    } catch (err) {
      if (my !== seq.current) return;
      failure();
      Alert.alert('Message', errorMessage(err, 'Failed to load transactions'));
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [params.shiftId]);

  // Live tab: the shift's running cycle, loaded on open / on switching back — none once the
  // shift is declared. Declared tab of a declared shift: its date, loaded straight away.
  useEffect(() => {
    if (tab === 'LIVE') {
      if (declared) { seq.current++; setLoading(false); setSlips([]); showToast('Record not avaliable!'); } else void load(params.date);
    } else if (declared && date) void load(date);
    else { setSlips(date ? slips : null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const list = useMemo(() => {
    const t = search.trim().toUpperCase();
    return (slips || []).filter((s) => !t || s.partyName.toUpperCase().includes(t));
  }, [slips, search]);
  const total = useMemo(() => list.reduce((a, s) => a + Math.abs(num(s.totalAmount)), 0), [list]);
  const viewDate = tab === 'LIVE' ? params.date : (date || params.date);

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <BackHeader title={params.shiftName} />
      <View style={styles.tabs}>
        {([['LIVE', 'LIVE TRANSACTION'], ['DECLARED', 'DECLARED TRANSACTION']] as Array<[Tab, string]>).map(([k, label]) => (
          <Pressable key={k} onPress={() => { tap(); setTab(k); }} style={styles.tab}>
            <Text style={styles.tabText} numberOfLines={1} adjustsFontSizeToFit>{label}</Text>
            <View style={[styles.tabLine, tab === k && { backgroundColor: CORAL }]} />
          </Pressable>
        ))}
      </View>

      {tab === 'DECLARED' && (
        <View style={styles.filters}>
          <Pressable onPress={() => { tap(); setCalendar(true); }} style={({ pressed }) => [styles.dateBox, pressed && { backgroundColor: colors.canvas }]}>
            <Text style={styles.dateText}>{date ? dmy(date) : '00-00-0000'}</Text>
          </Pressable>
          <Pressable
            onPress={() => { tap(); if (!date) { failure(); Alert.alert('Message', 'Please select Date!'); return; } void load(date); }}
            style={({ pressed }) => [styles.find, pressed && { backgroundColor: colors.navyDark }]}
          >
            <Text style={styles.findText}>FIND</Text>
          </Pressable>
        </View>
      )}
      <SearchBox value={search} onChangeText={setSearch} placeholder="SEARCH PARTY..." />
      <View style={styles.sep} />

      <FlatList
        data={list}
        keyExtractor={(s) => String(s.id)}
        initialNumToRender={15}
        windowSize={11}
        removeClippedSubviews
        onRefresh={tab === 'LIVE' && !declared ? () => load(params.date) : undefined}
        refreshing={false}
        ListEmptyComponent={slips && !loading && !(declared && tab === 'LIVE') ? <CenterMessage text="Record not avaliable!" /> : null}
        contentContainerStyle={{ paddingBottom: 110, flexGrow: 1 }}
        renderItem={({ item, index }) => {
          const mistake = String(item.auditStatus || '').toUpperCase() === 'MISTAKE';
          const diffMs = item.updatedAt ? new Date(item.updatedAt).getTime() - new Date(item.createdAt).getTime() : 0;
          const showDiff = !!item.isEdited && diffMs > 0;
          return (
            <Pressable
              onPress={() => { tap(); setOpenSlip(item); }}
              style={({ pressed }) => [styles.row, mistake && styles.rowEdited, showDiff && styles.rowDiff, pressed && { backgroundColor: '#E2E8F0' }]}
            >
              <Text style={styles.index}>{index + 1}.</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.party} numberOfLines={1}>{item.partyName}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={styles.user} numberOfLines={1}>{item.addedBy || '-'}</Text>
                  {showDiff && <Text style={styles.diff}>DIFF: {hms(diffMs)}</Text>}
                </View>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.amount}>{Math.round(Math.abs(num(item.totalAmount)))} /-</Text>
                <Text style={styles.time}>{dmyTime(item.createdAt)}</Text>
              </View>
            </Pressable>
          );
        }}
      />

      <View style={[styles.footer, { paddingBottom: 14 + insets.bottom }]}>
        <Text style={styles.footLabel}>TOTAL AMOUNT</Text>
        <Text style={styles.footValue}>{Math.round(total)}</Text>
      </View>
      <View style={[styles.fabs, { bottom: 36 + insets.bottom }]} pointerEvents="box-none">
        <Pressable accessibilityLabel="Jantri" onPress={() => { tap(); setJantriOpen(true); }} style={({ pressed }) => [styles.fab, pressed && { opacity: 0.85 }]}>
          <MaterialCommunityIcons name="receipt" size={34} color="#5B2A1A" />
        </Pressable>
        <Pressable accessibilityLabel="Party sale" onPress={() => { tap(); setPartiesOpen(true); }} style={({ pressed }) => [styles.fab, pressed && { opacity: 0.85 }]}>
          <MaterialIcons name="assignment-ind" size={34} color="#5B2A1A" />
        </Pressable>
      </View>

      {/* JANTRI TYPE */}
      <Modal visible={jantriOpen} transparent animationType="fade" onRequestClose={() => setJantriOpen(false)}>
        <Pressable style={styles.popBackdrop} onPress={() => setJantriOpen(false)}>
          <Pressable style={styles.pop} onPress={() => undefined}>
            <View style={styles.popHead}><Text style={styles.popTitle}>JANTRI TYPE</Text></View>
            <View style={{ padding: 22, gap: 26 }}>
              <PopButton label="MAIN JANTRI" color="#F2B01E" onPress={() => openJantri(false)} />
              <PopButton label="JANTRI" color={colors.navy} onPress={() => openJantri(true)} />
              <PopButton label="CLOSE" color={colors.navy} onPress={() => setJantriOpen(false)} />
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <SlipJantriModal slip={openSlip} shiftName={params.shiftName} onClose={() => setOpenSlip(null)} />
      <PartySaleModal visible={partiesOpen} slips={slips || []} onClose={() => setPartiesOpen(false)} />
      <CalendarModal
        visible={calendar}
        value={date}
        onCancel={() => setCalendar(false)}
        onConfirm={(d) => { setDate(d); setCalendar(false); void load(d); }}
      />
      <WaitDialog visible={loading} />
      {toast && (
        <View pointerEvents="none" style={[styles.toastWrap, { bottom: 110 + insets.bottom }]}>
          <Text style={styles.toast}>{toast}</Text>
        </View>
      )}
    </View>
  );
}

function PopButton({ label, color, onPress }: { label: string; color: string; onPress: () => void }) {
  return (
    <Pressable onPress={() => { tap(); onPress(); }} style={({ pressed }) => [styles.popBtn, { backgroundColor: color }, pressed && { opacity: 0.85 }]}>
      <Text style={styles.popBtnText}>{label}</Text>
    </Pressable>
  );
}

// One slip's Jantri (live app: tap a slip) — full screen, ← closes it. Its DARA entries on 1 … 100
// (100 = "00"), Bahar haruf on 000 … 999, Andar haruf on 0000 … 9999, five to a row ("-" when
// nothing); the slip's amount on the navy TOTAL AMOUNT bar.
function SlipJantriModal({ slip, shiftName, onClose }: { slip: Slip | null; shiftName: string; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const rows = useMemo(() => {
    const dara = new Map<string, number>();
    const andar = new Map<string, number>();
    const bahar = new Map<string, number>();
    for (const e of slip?.entries || []) {
      const m = e.entryType === 'HARUF_ANDAR' ? andar : e.entryType === 'HARUF_BAHAR' ? bahar : dara;
      const k = e.entryType === 'DARA' ? String(e.numberValue).padStart(2, '0') : String(e.numberValue).slice(-1);
      m.set(k, (m.get(k) || 0) + Math.abs(num(e.amount)));
    }
    const cells: Array<{ label: string; value: number }> = [];
    for (let i = 1; i <= 100; i++) cells.push({ label: String(i), value: dara.get(i === 100 ? '00' : String(i).padStart(2, '0')) || 0 });
    for (let d = 0; d <= 9; d++) cells.push({ label: String(d).repeat(3), value: bahar.get(String(d)) || 0 });
    for (let d = 0; d <= 9; d++) cells.push({ label: String(d).repeat(4), value: andar.get(String(d)) || 0 });
    const out: Array<typeof cells> = [];
    for (let i = 0; i < cells.length; i += 5) out.push(cells.slice(i, i + 5));
    return out;
  }, [slip]);
  return (
    <Modal visible={!!slip} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.canvas }}>
        <BackHeader title={`${shiftName} JANTRI`} onBack={onClose} />
        <ScrollView contentContainerStyle={{ paddingBottom: 8 }}>
          {rows.map((r, i) => (
            <View key={i} style={styles.jRow}>
              {r.map((c) => (
                <View key={c.label} style={styles.jCell}>
                  <Text style={styles.jNum}>{c.label}</Text>
                  <Text style={[styles.jVal, c.value !== 0 && styles.jValOn]} numberOfLines={1} adjustsFontSizeToFit>{c.value ? Math.round(c.value) : '-'}</Text>
                </View>
              ))}
            </View>
          ))}
        </ScrollView>
        <View style={[styles.footer, { paddingBottom: 14 + insets.bottom }]}>
          <Text style={styles.footLabel}>TOTAL AMOUNT</Text>
          <Text style={styles.footValue}>{Math.round(Math.abs(num(slip?.totalAmount)))}</Text>
        </View>
      </View>
    </Modal>
  );
}

// Party-wise sale of the slips on screen (slips, amount)
function PartySaleModal({ visible, slips, onClose }: { visible: boolean; slips: Slip[]; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const rows = useMemo(() => {
    const m = new Map<string, { name: string; count: number; amount: number }>();
    for (const s of slips) {
      const r = m.get(s.partyName) || { name: s.partyName, count: 0, amount: 0 };
      r.count += 1; r.amount += Math.abs(num(s.totalAmount));
      m.set(s.partyName, r);
    }
    return [...m.values()].sort((a, b) => b.amount - a.amount);
  }, [slips]);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 8 }]}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>PARTY SALE</Text>
            <Pressable hitSlop={12} onPress={onClose}><MaterialIcons name="close" size={24} color={colors.text} /></Pressable>
          </View>
          <FlatList
            data={rows}
            keyExtractor={(r) => r.name}
            ListEmptyComponent={<Text style={{ textAlign: 'center', color: colors.textMuted, padding: 20 }}>No slips</Text>}
            renderItem={({ item, index }) => (
              <View style={styles.saleRow}>
                <Text style={styles.saleIndex}>{index + 1}.</Text>
                <Text style={styles.saleName} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.saleCount}>{item.count}</Text>
                <Text style={styles.saleAmt}>{Math.round(item.amount)}</Text>
              </View>
            )}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', backgroundColor: colors.navy },
  tab: { flex: 1, alignItems: 'center', paddingTop: 14 },
  tabText: { color: colors.white, fontSize: 16, fontWeight: '500', paddingBottom: 14, paddingHorizontal: 4 },
  tabLine: { height: 4, alignSelf: 'stretch', backgroundColor: 'transparent' },
  filters: { flexDirection: 'row', gap: 10, paddingHorizontal: 10, paddingTop: 12 },
  dateBox: { flex: 1, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, paddingVertical: 15, alignItems: 'center' },
  dateText: { fontSize: 17, color: colors.textMuted },
  find: { flex: 1, backgroundColor: colors.navy, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', ...shadow },
  findText: { color: colors.white, fontSize: 19, fontWeight: '600' },
  sep: { height: 1, backgroundColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceMuted, borderBottomWidth: 1.5, borderBottomColor: '#E2E8F0', paddingVertical: 14, paddingHorizontal: 12 },
  rowEdited: { borderLeftWidth: 6, borderLeftColor: '#F04438' },
  rowDiff: { borderRightWidth: 6, borderRightColor: '#29A3D8' },
  index: { width: 48, fontSize: 19, color: colors.text },
  party: { fontSize: 17, fontWeight: '600', color: colors.text, textTransform: 'uppercase' },
  user: { fontSize: 15, fontWeight: '600', color: '#29A3D8', marginTop: 6 },
  diff: { fontSize: 13, fontWeight: '700', color: '#9C27B0', marginTop: 6, marginLeft: 'auto', paddingRight: 8 },
  amount: { fontSize: 20, fontWeight: '700', color: colors.text },
  time: { fontSize: 12, color: colors.textMuted, marginTop: 6 },
  footer: { backgroundColor: colors.navy, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18, paddingTop: 14 },
  footLabel: { color: colors.white, fontSize: 17, fontWeight: '500' },
  footValue: { color: colors.white, fontSize: 24, fontWeight: '700' },
  fabs: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 40 },
  fab: { width: 64, height: 64, borderRadius: 32, backgroundColor: CORAL, alignItems: 'center', justifyContent: 'center', ...shadow, elevation: 8 },
  popBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 36 },
  pop: { width: '100%', maxWidth: 360, backgroundColor: colors.surface, borderRadius: 2, overflow: 'hidden' },
  popHead: { backgroundColor: colors.navyDark, paddingVertical: 18, alignItems: 'center' },
  popTitle: { color: colors.white, fontSize: 16, fontWeight: '600' },
  popBtn: { borderRadius: 4, paddingVertical: 13, alignItems: 'center' },
  popBtnText: { color: colors.white, fontSize: 15, fontWeight: '600' },
  sheetBackdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18, maxHeight: '80%' },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: colors.navy },
  saleRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.divider },
  saleIndex: { width: 34, color: colors.textMuted },
  saleName: { flex: 1, fontWeight: '600', color: colors.text, textTransform: 'uppercase' },
  saleCount: { width: 40, textAlign: 'right', color: colors.textMuted },
  toastWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  toast: { backgroundColor: 'rgba(60,60,60,0.92)', color: colors.white, fontSize: 15, paddingHorizontal: 18, paddingVertical: 10, borderRadius: radius.pill, overflow: 'hidden' },
  jRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#E2E8F0' },
  jCell: { flex: 1, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', paddingHorizontal: 6, paddingVertical: 8, borderRightWidth: 1, borderRightColor: '#E2E8F0', backgroundColor: colors.surface, minHeight: 46 },
  jNum: { fontSize: 14, color: '#666', alignSelf: 'flex-start' },
  jVal: { fontSize: 13, color: '#666', marginLeft: 2, flexShrink: 1 },
  jValOn: { fontSize: 17, color: '#E8642C', fontWeight: '500' },
  saleAmt: { width: 90, textAlign: 'right', fontWeight: '700', color: colors.navy },
});

import { MaterialIcons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Alert, FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiRequest, errorMessage } from '../api/client';
import { BackHeader } from '../components/BackHeader';
import { CalendarModal, CORAL } from '../components/CalendarModal';
import { CenterMessage, SearchBox } from '../components/Controls';
import { WaitDialog } from '../components/WaitDialog';
import { colors, radius, shadow } from '../theme';
import { dmy, num } from '../utils/format';
import { failure, tap } from '../utils/haptics';

// ALL SHIFT REPORT (live app): From – To dates (calendars) · FIND, "Search Party..", then every
// party — name, "T-SALE : <sale>" (amber) and its T-Profit " /-" (navy above 0, red at 0 or below)
// over every shift of the range. TOTAL SALE / TOTAL PROFIT on the navy bar; the coral + button
// sorts (name, top looser, top winner). Opens on the From calendar, then To, then loads.
// Tap a party for its other columns. Same API as the web page (/transactions/all-shift-report?view=full).

interface PartyRow {
  partyId: number; partyName: string; agentName: string; mobile: string; opening: number;
  totalSale: number; dSale: number; aSale: number; comm: number; dOpen: number; aOpen: number; tpc: number; hissa: number;
  tProfit: number; kist: number; rebate: number; hpAmt: number; payment: number; closing: number;
}

type Sort = 'NAME' | 'LOOSER' | 'WINNER';
type Picking = 'FROM' | 'TO' | null;

export function AllShiftReportScreen() {
  const insets = useSafeAreaInsets();
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  // opens on the From calendar; OK there moves on to To, OK on To loads (live flow)
  const [picking, setPicking] = useState<Picking>('FROM');
  const [chain, setChain] = useState(true);
  const [rows, setRows] = useState<PartyRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort>('NAME');
  const [sortOpen, setSortOpen] = useState(false);
  const [detail, setDetail] = useState<PartyRow | null>(null);

  const load = async (f: string | null = from, t: string | null = to) => {
    if (!f || !t) { failure(); Alert.alert('Message', 'Please select both Dates!'); return; }
    if (f > t) { failure(); Alert.alert('Message', 'From Date cannot be after To Date!'); return; }
    setLoading(true);
    try {
      const res = await apiRequest<{ rows: PartyRow[] }>(`/transactions/all-shift-report?view=full&fromDate=${f}&toDate=${t}&searchMode=START_WITH`);
      setRows(res.data?.rows || []);
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
    const out = (rows || []).filter((r) => !t || r.partyName.toUpperCase().includes(t));
    out.sort((a, b) =>
      sort === 'LOOSER' ? (num(a.tProfit) - num(b.tProfit)) || a.partyName.localeCompare(b.partyName)
        : sort === 'WINNER' ? (num(b.tProfit) - num(a.tProfit)) || a.partyName.localeCompare(b.partyName)
          : a.partyName.localeCompare(b.partyName));
    return out;
  }, [rows, search, sort]);

  const totals = useMemo(
    () => (rows || []).reduce((a, r) => ({ sale: a.sale + num(r.totalSale), profit: a.profit + num(r.tProfit) }), { sale: 0, profit: 0 }),
    [rows],
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <BackHeader title="All Shift Report" />
      <View style={styles.filters}>
        <DateBox value={from} onPress={() => { setChain(false); setPicking('FROM'); }} />
        <DateBox value={to} onPress={() => { setChain(false); setPicking('TO'); }} />
        <Pressable onPress={() => { tap(); void load(); }} style={({ pressed }) => [styles.find, pressed && { backgroundColor: colors.navyDark }]}>
          <Text style={styles.findText}>FIND</Text>
        </Pressable>
      </View>
      <SearchBox value={search} onChangeText={setSearch} placeholder="Search Party.." />
      <View style={styles.sep} />

      <FlatList
        data={list}
        keyExtractor={(r) => String(r.partyId)}
        initialNumToRender={15}
        windowSize={11}
        removeClippedSubviews
        ListEmptyComponent={rows ? <CenterMessage text="Record not avaliable!" /> : null}
        contentContainerStyle={{ paddingBottom: 90, flexGrow: 1 }}
        renderItem={({ item, index }) => {
          const p = num(item.tProfit);
          return (
            <Pressable onPress={() => { tap(); setDetail(item); }} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.canvas }]}>
              <Text style={styles.index}>{index + 1}.</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.party} numberOfLines={1}>{item.partyName}</Text>
                <Text style={styles.sale}>T-SALE : {Math.round(num(item.totalSale))}</Text>
              </View>
              <Text style={[styles.net, { color: p > 0 ? colors.navy : '#E53935' }]}>{Math.round(p)} /-</Text>
            </Pressable>
          );
        }}
      />

      {rows && (
        <View style={[styles.footer, { paddingBottom: 12 + insets.bottom }]}>
          <View>
            <Text style={styles.footValue}>{Math.round(totals.sale)}</Text>
            <Text style={styles.footLabel}>TOTAL SALE</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.footValue}>{Math.round(totals.profit)}</Text>
            <Text style={styles.footLabel}>TOTAL PROFIT</Text>
          </View>
        </View>
      )}

      <Pressable
        accessibilityLabel="Sort"
        onPress={() => { tap(); setSortOpen(true); }}
        style={({ pressed }) => [styles.fab, { bottom: (rows ? 96 : 40) + insets.bottom }, pressed && { opacity: 0.85 }]}
      >
        <MaterialIcons name="add" size={34} color="#5B2A1A" />
      </Pressable>

      <Modal visible={sortOpen} transparent animationType="fade" onRequestClose={() => setSortOpen(false)}>
        <Pressable style={{ flex: 1 }} onPress={() => setSortOpen(false)}>
          <View style={[styles.menu, { bottom: (rows ? 168 : 112) + insets.bottom }]}>
            {([['NAME', 'SORT BY NAME'], ['LOOSER', 'SORT TOP LOOSER'], ['WINNER', 'SORT TOP WINNER']] as Array<[Sort, string]>).map(([k, label]) => (
              <Pressable key={k} onPress={() => { tap(); setSort(k); setSortOpen(false); }} style={({ pressed }) => [styles.menuItem, pressed && { backgroundColor: colors.canvas }]}>
                <Text style={[styles.menuText, sort === k && { color: colors.navy, fontWeight: '700' }]}>{label}</Text>
              </Pressable>
            ))}
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
      <DetailSheet row={detail} from={from} to={to} onClose={() => setDetail(null)} />
    </View>
  );
}

function DateBox({ value, onPress }: { value: string | null; onPress: () => void }) {
  return (
    <Pressable onPress={() => { tap(); onPress(); }} style={({ pressed }) => [styles.dateBox, pressed && { backgroundColor: colors.canvas }]}>
      <Text style={styles.dateText}>{value ? dmy(value) : '00-00-0000'}</Text>
    </Pressable>
  );
}

// A party's other All Shift Report columns for the range (web page's table)
function DetailSheet({ row, from, to, onClose }: { row: PartyRow | null; from: string | null; to: string | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  if (!row) return null;
  const items: Array<[string, number | string]> = [
    ['Agent', row.agentName || '-'],
    ['Opening', row.opening], ['Total Sale', row.totalSale], ['D-Sale', row.dSale], ['A-Sale', row.aSale],
    ['Comm', row.comm], ['D-Open', row.dOpen], ['A-Open', row.aOpen], ['TPC', row.tpc], ['Hissa', row.hissa],
    ['T-Profit', row.tProfit], ['Kist', row.kist], ['Rebate', row.rebate], ['HP-Amt', row.hpAmt], ['Payment', row.payment], ['Closing', row.closing],
  ];
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]} onPress={() => undefined}>
          <View style={styles.sheetHead}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sheetTitle} numberOfLines={1}>{row.partyName}</Text>
              <Text style={styles.sheetSub}>{dmy(from)} – {dmy(to)}</Text>
            </View>
            <Pressable hitSlop={12} onPress={onClose}><MaterialIcons name="close" size={24} color={colors.text} /></Pressable>
          </View>
          {items.map(([k, v]) => (
            <View key={k} style={styles.sheetRow}>
              <Text style={[styles.sheetKey, k === 'T-Profit' && { fontWeight: '700', color: colors.text }]}>{k}</Text>
              <Text style={styles.sheetVal}>{typeof v === 'number' ? Math.round(num(v)) : v}</Text>
            </View>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', gap: 8, paddingHorizontal: 8, paddingTop: 10, backgroundColor: colors.surface },
  dateBox: { flex: 1, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, justifyContent: 'center', paddingVertical: 15, paddingHorizontal: 6 },
  dateText: { fontSize: 17, color: colors.textMuted, textAlign: 'center' },
  find: { flex: 0.9, backgroundColor: colors.navy, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', ...shadow },
  findText: { color: colors.white, fontSize: 19, fontWeight: '600' },
  sep: { height: 1, backgroundColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceMuted, borderBottomWidth: 1.5, borderBottomColor: '#E2E8F0', paddingVertical: 18, paddingHorizontal: 14 },
  index: { width: 56, fontSize: 19, color: colors.text },
  party: { fontSize: 18, fontWeight: '600', color: colors.text, textTransform: 'uppercase' },
  sale: { fontSize: 16, fontWeight: '600', color: '#E8961E', marginTop: 6 },
  net: { fontSize: 20, fontWeight: '600', marginLeft: 8 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.navy, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12 },
  footValue: { color: colors.white, fontSize: 22, fontWeight: '700' },
  footLabel: { color: colors.white, fontSize: 13, fontWeight: '500', marginTop: 2 },
  fab: {
    position: 'absolute', right: 22, width: 64, height: 64, borderRadius: 32,
    backgroundColor: CORAL, alignItems: 'center', justifyContent: 'center', ...shadow, elevation: 8,
  },
  menu: { position: 'absolute', right: 22, width: 240, backgroundColor: colors.surface, borderRadius: 4, paddingVertical: 4, ...shadow, elevation: 10 },
  menuItem: { paddingHorizontal: 20, paddingVertical: 16 },
  menuText: { fontSize: 17, color: colors.text, letterSpacing: 0.3 },
  sheetBackdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 20, maxHeight: '88%' },
  sheetHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 6, gap: 8 },
  sheetTitle: { fontSize: 19, fontWeight: '700', color: colors.navy, textTransform: 'uppercase' },
  sheetSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  sheetRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.divider },
  sheetKey: { fontSize: 14, color: colors.textMuted },
  sheetVal: { fontSize: 14, fontWeight: '700', color: colors.text },
});

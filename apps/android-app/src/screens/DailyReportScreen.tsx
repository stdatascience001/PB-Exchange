import { MaterialIcons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Alert, FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiRequest, errorMessage } from '../api/client';
import type { Shift } from '../api/types';
import { BackHeader } from '../components/BackHeader';
import { CalendarModal, CORAL } from '../components/CalendarModal';
import { CenterMessage, FindButton, SearchBox, SelectField } from '../components/Controls';
import { useApiList } from '../hooks/useApiList';
import { colors, radius, shadow } from '../theme';
import { dmy, num } from '../utils/format';
import { failure, tap } from '../utils/haptics';

// DAILY REPORT (live app): date (calendar) · shift (or ALL SHIFT) · FIND, "Search Party..",
// [ K = <result> ], then each party — name, its sale (amber) and its net (Debit − Credit, " /-":
// navy when the party owes, red when it is owed). TOTAL SALE / TOTAL PROFIT on the navy bar; the
// coral button sorts by name, top looser or top winner. Tap a party for its full figures.
// As live, the screen opens on the calendar: the picked date is applied and the report loads.
// Same API as the web Daily Report (GET /transactions/daily-report?shiftId&date); the result
// number as the web page reads it (GET /transactions/collection?…&declaredOnly=true).

interface DailyRow {
  partyId: number; partyName: string; agentName: string; rate: string; sHissa: number;
  totalSale: number; dSale: number; aSale: number; comm: number; oDara: number; oAkhar: number;
  hissa: number; debit: number; credit: number;
}
interface DailyData {
  shiftId: number; shiftName: string; date: string; isDeclared: boolean; partyCount: number; profit: number; rows: DailyRow[];
  masterTotal: { totalSale: number; dSale: number; aSale: number; comm: number; hissa: number; debit: number; credit: number };
}

// One line of the list (a party, or a party summed over every shift for ALL SHIFT)
interface Line {
  key: string; partyName: string; totalSale: number; net: number;
  agentName: string; rate: string; sHissa: number; dSale: number; aSale: number; comm: number; oDara: number; oAkhar: number; hissa: number; debit: number; credit: number;
  shifts: number;
}
interface Report { lines: Line[]; totalSale: number; profit: number; declared: string | null; isAll: boolean; anyDeclared: boolean }

type Sort = 'NAME' | 'LOOSER' | 'WINNER';
const ALL = 'ALL';

const toLine = (r: DailyRow, key: string): Line => ({
  key, partyName: r.partyName, totalSale: num(r.totalSale), net: num(r.debit) - num(r.credit),
  agentName: r.agentName, rate: r.rate, sHissa: num(r.sHissa), dSale: num(r.dSale), aSale: num(r.aSale), comm: num(r.comm),
  oDara: num(r.oDara), oAkhar: num(r.oAkhar), hissa: num(r.hissa), debit: num(r.debit), credit: num(r.credit), shifts: 1,
});

export function DailyReportScreen() {
  const insets = useSafeAreaInsets();
  const shifts = useApiList<Shift>('/shifts');
  const active = useMemo(() => shifts.data.filter((s) => s.isActive !== false), [shifts.data]);

  const [date, setDate] = useState<string | null>(null);
  // opens on the calendar (live app); OK there loads the report for the picked date
  const [calendarOpen, setCalendarOpen] = useState(true);
  const [shiftId, setShiftId] = useState(ALL);
  const [search, setSearch] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState<Sort>('NAME');
  const [sortOpen, setSortOpen] = useState(false);
  const [detail, setDetail] = useState<Line | null>(null);

  const shiftOptions = useMemo(
    () => [{ value: ALL, label: 'ALL SHIFT' }, ...active.map((s) => ({ value: String(s.id), label: s.name }))],
    [active],
  );

  const load = async (forDate: string | null = date) => {
    const date = forDate;
    if (!date) { failure(); Alert.alert('Message', 'Please select a valid date!'); return; }
    setLoading(true);
    try {
      if (shiftId !== ALL) {
        const [res, coll] = await Promise.all([
          apiRequest<DailyData>(`/transactions/daily-report?shiftId=${shiftId}&date=${date}`),
          apiRequest<{ declaredNumber: string | null }>(`/transactions/collection?shiftId=${shiftId}&date=${date}&declaredOnly=true`).catch(() => ({ data: undefined })),
        ]);
        const d = res.data;
        const lines = (d?.isDeclared ? d.rows : []).map((r, i) => toLine(r, `${r.partyId}-${r.rate}-${i}`));
        setReport({
          lines,
          totalSale: num(d?.masterTotal.totalSale),
          profit: num(d?.profit),
          declared: coll.data?.declaredNumber ?? null,
          isAll: false,
          anyDeclared: !!d?.isDeclared,
        });
        if (!d?.isDeclared || lines.length === 0) Alert.alert('Message', 'Record not avaliable!');
      } else {
        // ALL SHIFT: every active shift's report for the day, summed party by party
        const results = await Promise.all(active.map((s) =>
          apiRequest<DailyData>(`/transactions/daily-report?shiftId=${s.id}&date=${date}`).then((r) => r.data).catch(() => undefined),
        ));
        const byParty = new Map<string, Line>();
        let totalSale = 0;
        let profit = 0;
        let anyDeclared = false;
        for (const d of results) {
          if (!d?.isDeclared) continue;
          anyDeclared = true;
          totalSale += num(d.masterTotal.totalSale);
          profit += num(d.profit);
          d.rows.forEach((r) => {
            const k = r.partyId ? `p${r.partyId}` : `n${r.partyName}`;
            const prev = byParty.get(k);
            const add = toLine(r, k);
            if (!prev) { byParty.set(k, add); return; }
            byParty.set(k, {
              ...prev,
              totalSale: prev.totalSale + add.totalSale, net: prev.net + add.net, dSale: prev.dSale + add.dSale, aSale: prev.aSale + add.aSale,
              comm: prev.comm + add.comm, oDara: prev.oDara + add.oDara, oAkhar: prev.oAkhar + add.oAkhar, hissa: prev.hissa + add.hissa,
              debit: prev.debit + add.debit, credit: prev.credit + add.credit, shifts: prev.shifts + 1,
            });
          });
        }
        setReport({ lines: [...byParty.values()], totalSale, profit, declared: null, isAll: true, anyDeclared });
        if (!anyDeclared) Alert.alert('Message', 'Record not avaliable!');
      }
    } catch (err) {
      failure();
      Alert.alert('Message', errorMessage(err, 'Failed to load report'));
    } finally {
      setLoading(false);
    }
  };

  const lines = useMemo(() => {
    const t = search.trim().toUpperCase();
    const list = (report?.lines || []).filter((l) => !t || l.partyName.toUpperCase().includes(t));
    list.sort((a, b) =>
      sort === 'LOOSER' ? (a.net - b.net) || a.partyName.localeCompare(b.partyName)
        : sort === 'WINNER' ? (b.net - a.net) || a.partyName.localeCompare(b.partyName)
          : a.partyName.localeCompare(b.partyName));
    return list;
  }, [report, search, sort]);

  const banner = report
    ? (report.isAll ? null : report.declared ? `[ K = ${report.declared} ]` : '[ UNDECLARED ]')
    : null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <BackHeader title="Daily Report" />
      <View style={styles.filters}>
        <Pressable onPress={() => { tap(); setCalendarOpen(true); }} style={({ pressed }) => [styles.dateBox, pressed && { backgroundColor: colors.canvas }]}>
          <Text style={styles.dateText}>{date ? dmy(date) : '00-00-0000'}</Text>
        </Pressable>
        <SelectField title="Shift" value={shiftId} onChange={setShiftId} placeholder="ALL SHIFT" options={shiftOptions} />
        <FindButton onPress={() => load()} loading={loading} />
      </View>
      <SearchBox value={search} onChangeText={setSearch} placeholder="Search Party.." />
      <View style={styles.sep} />

      <FlatList
        data={lines}
        keyExtractor={(l) => l.key}
        initialNumToRender={15}
        windowSize={11}
        ListHeaderComponent={banner ? (
          <View style={styles.bannerWrap}><Text style={styles.banner}>{banner}</Text></View>
        ) : null}
        ListEmptyComponent={<CenterMessage loading={loading} text={report ? 'Record not avaliable!' : 'Select date and shift, then FIND'} />}
        contentContainerStyle={{ paddingBottom: 90, flexGrow: 1 }}
        renderItem={({ item, index }) => (
          <Pressable onPress={() => { tap(); setDetail(item); }} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.canvas }]}>
            <Text style={styles.index}>{index + 1}.</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.party} numberOfLines={1}>{item.partyName}</Text>
              <Text style={styles.sale}>{Math.round(item.totalSale)}</Text>
            </View>
            <Text style={[styles.net, item.net < 0 && { color: colors.crimson }]}>{Math.round(item.net)} /-</Text>
          </Pressable>
        )}
      />

      {/* Totals bar + sort button */}
      <View style={[styles.footer, { paddingBottom: 12 + insets.bottom }]}>
        <View>
          <Text style={styles.footValue}>{Math.round(report?.totalSale || 0)}</Text>
          <Text style={styles.footLabel}>TOTAL SALE</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.footValue}>{Math.round(report?.profit || 0)}</Text>
          <Text style={styles.footLabel}>TOTAL PROFIT</Text>
        </View>
      </View>
      <Pressable
        accessibilityLabel="Sort"
        onPress={() => { tap(); setSortOpen(true); }}
        style={({ pressed }) => [styles.fab, { bottom: 34 + insets.bottom }, pressed && { opacity: 0.85 }]}
      >
        <MaterialIcons name="sort" size={30} color="#5B2A1A" />
      </Pressable>

      <Modal visible={sortOpen} transparent animationType="fade" onRequestClose={() => setSortOpen(false)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setSortOpen(false)}>
          <View style={[styles.menu, { bottom: 120 + insets.bottom }]}>
            {([['NAME', 'SORT BY NAME'], ['LOOSER', 'SORT TOP LOOSER'], ['WINNER', 'SORT TOP WINNER']] as Array<[Sort, string]>).map(([k, label]) => (
              <Pressable key={k} onPress={() => { tap(); setSort(k); setSortOpen(false); }} style={({ pressed }) => [styles.menuItem, pressed && { backgroundColor: colors.canvas }]}>
                <Text style={[styles.menuText, sort === k && { color: colors.navy, fontWeight: '700' }]}>{label}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

      <CalendarModal
        visible={calendarOpen}
        value={date}
        onCancel={() => setCalendarOpen(false)}
        onConfirm={(d) => {
          setDate(d);
          setCalendarOpen(false);
          // the date filter is applied right away (the opening calendar, or a new date picked)
          void load(d);
        }}
      />

      <DetailSheet line={detail} isAll={!!report?.isAll} onClose={() => setDetail(null)} />
    </View>
  );
}

// A party's full Daily Report figures (Rate, S-Hissa, Sale, Comm, O-Dara / O-Akhar, Hissa,
// Debit / Credit) — the columns the earlier mobile Daily Report showed on each row
function DetailSheet({ line, isAll, onClose }: { line: Line | null; isAll: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  if (!line) return null;
  const rows: Array<[string, string]> = [
    ['Agent', line.agentName || '-'],
    ...(isAll ? [['Shifts', String(line.shifts)] as [string, string]] : [['Rate', line.rate || '-'] as [string, string], ['S-Hissa', String(line.sHissa)] as [string, string]]),
    ['Total Sale', String(Math.round(line.totalSale))],
    ['D-Sale', String(Math.round(line.dSale))],
    ['A-Sale', String(Math.round(line.aSale))],
    ['Comm', String(Math.round(line.comm))],
    ['O-Dara', String(Math.round(line.oDara))],
    ['O-Akhar', String(Math.round(line.oAkhar))],
    ['Hissa', String(Math.round(line.hissa))],
    ['Debit', String(Math.round(line.debit))],
    ['Credit', String(Math.round(line.credit))],
  ];
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]} onPress={() => undefined}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle} numberOfLines={1}>{line.partyName}</Text>
            <Pressable hitSlop={12} onPress={onClose}><MaterialIcons name="close" size={24} color={colors.text} /></Pressable>
          </View>
          {rows.map(([k, v]) => (
            <View key={k} style={styles.sheetRow}>
              <Text style={styles.sheetKey}>{k}</Text>
              <Text style={styles.sheetVal}>{v}</Text>
            </View>
          ))}
          <View style={[styles.sheetRow, { borderBottomWidth: 0 }]}>
            <Text style={[styles.sheetKey, { fontWeight: '700', color: colors.text }]}>Net</Text>
            <Text style={[styles.sheetVal, { color: line.net < 0 ? colors.crimson : colors.navy }]}>{Math.round(line.net)} /-</Text>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', gap: 8, paddingHorizontal: 8, paddingTop: 10, backgroundColor: colors.surface },
  dateBox: { flex: 1, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, justifyContent: 'center', paddingHorizontal: 10 },
  dateText: { fontSize: 17, color: colors.textMuted, textAlign: 'center' },
  sep: { height: 1, backgroundColor: colors.border },
  bannerWrap: { alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surfaceMuted },
  banner: { color: '#EF4444', fontSize: 30, fontWeight: '700', letterSpacing: 1 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceMuted, borderBottomWidth: 1.5, borderBottomColor: '#E2E8F0', paddingVertical: 18, paddingLeft: 14, paddingRight: 14 },
  index: { width: 56, fontSize: 19, color: colors.text },
  party: { fontSize: 18, fontWeight: '600', color: colors.text, textTransform: 'uppercase' },
  sale: { fontSize: 16, fontWeight: '600', color: '#E8961E', marginTop: 6 },
  net: { fontSize: 20, fontWeight: '600', color: colors.navy, marginLeft: 8 },
  footer: { backgroundColor: colors.navy, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12 },
  footValue: { color: colors.white, fontSize: 22, fontWeight: '700' },
  footLabel: { color: colors.white, fontSize: 13, fontWeight: '500', marginTop: 2 },
  fab: {
    position: 'absolute', alignSelf: 'center', width: 64, height: 64, borderRadius: 32,
    backgroundColor: CORAL, alignItems: 'center', justifyContent: 'center', ...shadow, elevation: 8,
  },
  menuBackdrop: { flex: 1 },
  menu: { position: 'absolute', left: 14, width: 240, backgroundColor: colors.surface, borderRadius: 4, paddingVertical: 4, ...shadow, elevation: 10 },
  menuItem: { paddingHorizontal: 20, paddingVertical: 16 },
  menuText: { fontSize: 17, color: colors.text, letterSpacing: 0.3 },
  sheetBackdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 20 },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 8 },
  sheetTitle: { flex: 1, fontSize: 19, fontWeight: '700', color: colors.navy, textTransform: 'uppercase' },
  sheetRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.divider },
  sheetKey: { fontSize: 14, color: colors.textMuted },
  sheetVal: { fontSize: 14, fontWeight: '700', color: colors.text },
});

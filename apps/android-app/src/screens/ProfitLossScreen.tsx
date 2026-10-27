import { useNavigation } from '@react-navigation/native';
import React, { useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiRequest, errorMessage } from '../api/client';
import { BackHeader } from '../components/BackHeader';
import { CalendarModal } from '../components/CalendarModal';
import { CenterMessage, SearchBox } from '../components/Controls';
import { WaitDialog } from '../components/WaitDialog';
import { colors, radius, shadow } from '../theme';
import { dmy, num } from '../utils/format';
import { failure, tap } from '../utils/haptics';

// P & L REPORT (live app): "Search Party..", From – To dates (calendars) · FIND, then each
// declared shift of the range — "NAME { K-66 }", its sale (amber) and its profit " /-" (navy,
// red when a loss). TOTAL SALE / TOTAL PROFIT on the navy bar. Opens on the From calendar, then
// To, then loads. Tap a shift for its day-wise list. Same API as the web Profit & Loss report
// (GET /transactions/shift-profit-loss?fromDate&toDate).

export interface ShiftPnlRow {
  shiftId: number; shiftName: string; shiftCode: string;
  totalSale: number; dSale: number; aSale: number; comm: number; oDara: number; oAkhar: number; tpc: number; hissa: number; closing: number;
}
interface ShiftPnlResponse { rows: ShiftPnlRow[]; masterTotal: { totalSale: number; closing: number } | null }

type Picking = 'FROM' | 'TO' | null;

export function ProfitLossScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [picking, setPicking] = useState<Picking>('FROM');
  const [chain, setChain] = useState(true);
  const [data, setData] = useState<ShiftPnlResponse | null>(null);
  const [loaded, setLoaded] = useState<{ from: string; to: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  // "{ K-66 }": each shift's declared result of the day (one-day range; the API's shiftCode is
  // the shift's code, not its result) — read as the web pages do (collection?declaredOnly=true)
  const [results, setResults] = useState<Record<number, string>>({});

  const load = async (f: string | null = from, t: string | null = to) => {
    if (!f || !t) { failure(); Alert.alert('Message', 'Please select both Dates!'); return; }
    if (f > t) { failure(); Alert.alert('Message', 'From Date cannot be after To Date!'); return; }
    setLoading(true);
    try {
      const res = await apiRequest<ShiftPnlResponse>(`/transactions/shift-profit-loss?fromDate=${f}&toDate=${t}`);
      const out = res.data || { rows: [], masterTotal: null };
      setData(out);
      setLoaded({ from: f, to: t });
      const found: Record<number, string> = {};
      if (f === t) {
        await Promise.all(out.rows.map((r) =>
          apiRequest<{ declaredNumber: string | null }>(`/transactions/collection?shiftId=${r.shiftId}&date=${f}&declaredOnly=true`)
            .then((c) => { if (c.data?.declaredNumber) found[r.shiftId] = String(parseInt(c.data.declaredNumber, 10) || c.data.declaredNumber); })
            .catch(() => undefined),
        ));
      }
      setResults(found);
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

  const rows = useMemo(() => {
    const t = search.trim().toUpperCase();
    return (data?.rows || []).filter((r) => !t || r.shiftName.toUpperCase().includes(t));
  }, [data, search]);

  const title = (r: ShiftPnlRow) => (results[r.shiftId] ? `${r.shiftName} { K-${results[r.shiftId]} }` : r.shiftName);

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <BackHeader title="P & L Report" />
      <SearchBox value={search} onChangeText={setSearch} placeholder="Search Party..." />
      <View style={styles.filters}>
        <DateBox value={from} onPress={() => { setChain(false); setPicking('FROM'); }} />
        <DateBox value={to} onPress={() => { setChain(false); setPicking('TO'); }} />
        <Pressable onPress={() => { tap(); void load(); }} style={({ pressed }) => [styles.find, pressed && { backgroundColor: colors.navyDark }]}>
          <Text style={styles.findText}>FIND</Text>
        </Pressable>
      </View>
      <View style={styles.sep} />

      <FlatList
        data={rows}
        keyExtractor={(r) => String(r.shiftId)}
        ListEmptyComponent={data ? <CenterMessage text="Record not avaliable!" /> : null}
        contentContainerStyle={{ paddingBottom: 16, flexGrow: 1 }}
        renderItem={({ item, index }) => {
          const p = num(item.closing);
          return (
            <Pressable
              onPress={() => { tap(); if (loaded) navigation.navigate('ProfitLossShift', { shiftId: item.shiftId, title: title(item), from: loaded.from, to: loaded.to }); }}
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.canvas }]}
            >
              <Text style={styles.index}>{index + 1}.</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>{title(item)}</Text>
                <Text style={styles.sale}>{Math.round(num(item.totalSale))}</Text>
              </View>
              <Text style={[styles.net, p < 0 && { color: '#E53935' }]}>{Math.round(p)} /-</Text>
            </Pressable>
          );
        }}
      />

      <View style={[styles.footer, { paddingBottom: 12 + insets.bottom }]}>
        <View>
          <Text style={styles.footValue}>{Math.round(num(data?.masterTotal?.totalSale))}</Text>
          <Text style={styles.footLabel}>TOTAL SALE</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.footValue}>{Math.round(num(data?.masterTotal?.closing))}</Text>
          <Text style={styles.footLabel}>{data ? 'TOTAL PROFIT' : 'PROFIT & LOSS'}</Text>
        </View>
      </View>

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
    <Pressable onPress={() => { tap(); onPress(); }} style={({ pressed }) => [styles.dateBox, pressed && { backgroundColor: colors.canvas }]}>
      <Text style={styles.dateText}>{value ? dmy(value) : '00-00-0000'}</Text>
    </Pressable>
  );
}

export const plStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceMuted, borderBottomWidth: 1.5, borderBottomColor: '#E2E8F0', paddingVertical: 18, paddingHorizontal: 14 },
  index: { width: 56, fontSize: 19, color: colors.text },
  name: { fontSize: 18, fontWeight: '600', color: colors.text, textTransform: 'uppercase' },
  sale: { fontSize: 16, fontWeight: '600', color: '#E8961E', marginTop: 6 },
  net: { fontSize: 20, fontWeight: '600', color: colors.navy, marginLeft: 8 },
});

const styles = StyleSheet.create({
  ...plStyles,
  filters: { flexDirection: 'row', gap: 8, paddingHorizontal: 8, paddingBottom: 10 },
  dateBox: { flex: 1, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, justifyContent: 'center', paddingVertical: 15, paddingHorizontal: 6 },
  dateText: { fontSize: 17, color: colors.textMuted, textAlign: 'center' },
  find: { flex: 0.9, backgroundColor: colors.navy, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', ...shadow },
  findText: { color: colors.white, fontSize: 19, fontWeight: '600' },
  sep: { height: 1, backgroundColor: colors.border },
  footer: { backgroundColor: colors.navy, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12 },
  footValue: { color: colors.white, fontSize: 22, fontWeight: '700' },
  footLabel: { color: colors.white, fontSize: 13, fontWeight: '500', marginTop: 2 },
});

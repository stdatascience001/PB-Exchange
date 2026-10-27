import { useNavigation } from '@react-navigation/native';
import React, { useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiRequest, errorMessage } from '../api/client';
import { BackHeader } from '../components/BackHeader';
import { CalendarModal } from '../components/CalendarModal';
import { CenterMessage } from '../components/Controls';
import { WaitDialog } from '../components/WaitDialog';
import { colors, radius, shadow } from '../theme';
import { dmy, num } from '../utils/format';
import { failure, tap } from '../utils/haptics';

// CASH AGENT REPORT (live app): From – To dates · FIND, then SR. / OPENING / CURRENT / CLOSING —
// each cash agent: name, its opening (red), the period's movement (amber) and closing (navy).
// Bottom: OPENING · CURRENT · CLOSING totals. Opens on the From calendar, then To, then loads.
// Tap an agent: CASH REPORT DETAILS (its entries over the same dates).
// Same API as the web Cash Report (GET /transactions/cash-agent-report?fromDate&toDate).
interface Row { ledgerId: number; partyName: string; opening: number; amount: number; closing: number }
interface Report { rows: Row[]; totalOpening: number; totalAmount: number; totalClosing: number }

export function CashAgentReportScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const [loaded, setLoaded] = useState<{ from: string; to: string } | null>(null);
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [picking, setPicking] = useState<'FROM' | 'TO' | null>('FROM');
  const [chain, setChain] = useState(true);
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async (f: string | null = from, t: string | null = to) => {
    if (!f || !t) { failure(); Alert.alert('Message', 'Please select both Dates!'); return; }
    if (f > t) { failure(); Alert.alert('Message', 'From Date cannot be after To Date!'); return; }
    setLoading(true);
    try {
      const res = await apiRequest<Report>(`/transactions/cash-agent-report?fromDate=${f}&toDate=${t}`);
      setData(res.data || null);
      setLoaded({ from: f, to: t });
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

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <BackHeader title="Cash Agent Report" />
      <View style={styles.filters}>
        <DateBox value={from} onPress={() => { setChain(false); setPicking('FROM'); }} />
        <DateBox value={to} onPress={() => { setChain(false); setPicking('TO'); }} />
        <Pressable onPress={() => { tap(); void load(); }} style={({ pressed }) => [styles.find, pressed && { backgroundColor: colors.navyDark }]}>
          <Text style={styles.findText}>FIND</Text>
        </Pressable>
      </View>

      <View style={styles.head}>
        <Text style={[styles.hCell, { width: 52 }]}>SR.</Text>
        <Text style={[styles.hCell, { flex: 1 }]}>OPENING</Text>
        <Text style={[styles.hCell, { flex: 1, textAlign: 'center' }]}>CURRENT</Text>
        <Text style={[styles.hCell, { flex: 1, textAlign: 'right' }]}>CLOSING</Text>
      </View>

      <FlatList
        data={data?.rows || []}
        keyExtractor={(r) => String(r.ledgerId)}
        initialNumToRender={15}
        removeClippedSubviews
        ListEmptyComponent={data ? <CenterMessage text="Record not avaliable!" /> : null}
        contentContainerStyle={{ flexGrow: 1 }}
        renderItem={({ item, index }) => (
          <Pressable
            onPress={() => { tap(); if (loaded) navigation.navigate('CashReportDetails', { ledgerId: item.ledgerId, name: item.partyName, from: loaded.from, to: loaded.to }); }}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.canvas }]}
          >
            <Text style={styles.index}>{index + 1}.</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={1}>{item.partyName}</Text>
              <View style={styles.line} />
              <View style={styles.nums}>
                <Text style={[styles.num, { color: '#E53935' }]}>{Math.round(num(item.opening))}</Text>
                <Text style={[styles.num, { color: '#E8961E', textAlign: 'center' }]}>{Math.round(num(item.amount))}</Text>
                <Text style={[styles.num, { color: colors.navy, textAlign: 'right' }]}>{Math.round(num(item.closing))}</Text>
              </View>
            </View>
          </Pressable>
        )}
      />

      <View style={[styles.footer, { paddingBottom: 12 + insets.bottom }]}>
        <View>
          <Text style={styles.footValue}>{Math.round(num(data?.totalOpening))}</Text>
          <Text style={styles.footLabel}>OPENING</Text>
        </View>
        <View style={{ alignItems: 'center' }}>
          <Text style={styles.footValue}>{Math.round(num(data?.totalAmount))}</Text>
          <Text style={styles.footLabel}>CURRENT</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.footValue}>{Math.round(num(data?.totalClosing))}</Text>
          <Text style={styles.footLabel}>CLOSING</Text>
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

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', gap: 8, paddingHorizontal: 8, paddingVertical: 10 },
  dateBox: { flex: 1, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, justifyContent: 'center', paddingVertical: 15, paddingHorizontal: 6 },
  dateText: { fontSize: 17, color: colors.textMuted, textAlign: 'center' },
  find: { flex: 1, backgroundColor: colors.navy, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', ...shadow },
  findText: { color: colors.white, fontSize: 19, fontWeight: '600' },
  head: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 12, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceMuted },
  hCell: { fontSize: 17, fontWeight: '700', color: colors.text },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceMuted, borderBottomWidth: 1.5, borderBottomColor: '#E2E8F0', paddingVertical: 12, paddingHorizontal: 12 },
  index: { width: 52, fontSize: 19, color: colors.text },
  name: { fontSize: 17, fontWeight: '600', color: colors.text, textTransform: 'uppercase' },
  line: { height: 1, backgroundColor: colors.divider, marginVertical: 5 },
  nums: { flexDirection: 'row' },
  num: { flex: 1, fontSize: 16, fontWeight: '600' },
  footer: { backgroundColor: colors.navy, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingTop: 12 },
  footValue: { color: colors.white, fontSize: 21, fontWeight: '700' },
  footLabel: { color: colors.white, fontSize: 13, fontWeight: '500', marginTop: 2 },
});

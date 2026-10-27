import { RouteProp, useRoute } from '@react-navigation/native';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiRequest, errorMessage } from '../api/client';
import { BackHeader } from '../components/BackHeader';
import { WaitDialog } from '../components/WaitDialog';
import type { RootStackParamList } from '../navigation/types';
import { colors, radius, shadow } from '../theme';
import { num } from '../utils/format';
import { tap } from '../utils/haptics';

// "<SHIFT> JANTRI" (live app): Amount · Percent · SEARCH, then the grid 1 … 100, the Bahar haruf
// 000 … 999 and the Andar haruf 0000 … 9999, five to a row, each with its amount ("-" when nothing).
// MAIN JANTRI = the raw book (GET /jantri/:id), JANTRI = the net one after each party's
// commission / hissa (GET /jantri/:id/net) — the web Jantri pages' APIs.
//   Amount  — only cells of at least that amount are shown (the rest "-")
//   Percent — every amount is shown as that % of itself
interface JantriView {
  grid: Array<{ number: string; totalAmount: number }>;
  haruf: Array<{ digit: string; andarAmount: number; baharAmount: number }>;
}

export function JantriScreen() {
  const insets = useSafeAreaInsets();
  const { params } = useRoute<RouteProp<RootStackParamList, 'Jantri'>>();
  const [data, setData] = useState<JantriView | null>(null);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState('');
  const [percent, setPercent] = useState('');
  const [applied, setApplied] = useState({ amount: 0, percent: 0 });

  useEffect(() => {
    let alive = true;
    const path = params.net ? `/jantri/${params.shiftId}/net?date=${params.date}&gate=none` : `/jantri/${params.shiftId}?date=${params.date}`;
    apiRequest<JantriView>(path)
      .then((r) => { if (alive) setData(r.data || null); })
      .catch((err) => { if (alive) Alert.alert('Message', errorMessage(err, 'Failed to load Jantri')); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [params]);

  const cells = useMemo(() => {
    const byNum = new Map((data?.grid || []).map((c) => [c.number, num(c.totalAmount)]));
    const andar = new Map((data?.haruf || []).map((h) => [h.digit, num(h.andarAmount)]));
    const bahar = new Map((data?.haruf || []).map((h) => [h.digit, num(h.baharAmount)]));
    const out: Array<{ label: string; value: number }> = [];
    for (let i = 1; i <= 100; i++) out.push({ label: String(i), value: byNum.get(i === 100 ? '00' : String(i).padStart(2, '0')) || 0 });
    for (let d = 0; d <= 9; d++) out.push({ label: String(d).repeat(3), value: bahar.get(String(d)) || 0 });
    for (let d = 0; d <= 9; d++) out.push({ label: String(d).repeat(4), value: andar.get(String(d)) || 0 });
    return out;
  }, [data]);

  const show = (v: number) => {
    if (!v) return '-';
    if (applied.amount && Math.abs(v) < applied.amount) return '-';
    const shown = applied.percent ? (v * applied.percent) / 100 : v;
    return String(Math.round(shown));
  };

  const rows: Array<typeof cells> = [];
  for (let i = 0; i < cells.length; i += 5) rows.push(cells.slice(i, i + 5));

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <BackHeader title={`${params.shiftName} ${params.net ? 'Jantri' : 'Main Jantri'}`} />
      <View style={styles.filters}>
        <TextInput value={amount} onChangeText={setAmount} placeholder="Amount" placeholderTextColor={colors.textFaint} keyboardType="decimal-pad" style={styles.input} />
        <TextInput value={percent} onChangeText={setPercent} placeholder="Percent" placeholderTextColor={colors.textFaint} keyboardType="decimal-pad" style={styles.input} />
        <Pressable
          onPress={() => { tap(); setApplied({ amount: parseFloat(amount) || 0, percent: parseFloat(percent) || 0 }); }}
          style={({ pressed }) => [styles.search, pressed && { backgroundColor: colors.navyDark }]}
        >
          <Text style={styles.searchText}>SEARCH</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: 8 }}>
        {rows.map((r, i) => (
          <View key={i} style={styles.gridRow}>
            {r.map((c) => (
              <View key={c.label} style={styles.cell}>
                <Text style={styles.cellNum}>{c.label}</Text>
                <Text style={[styles.cellVal, c.value !== 0 && styles.cellValOn]} numberOfLines={1} adjustsFontSizeToFit>{show(c.value)}</Text>
              </View>
            ))}
          </View>
        ))}
      </ScrollView>
      <View style={{ height: 40 + insets.bottom, backgroundColor: colors.navy }} />
      <WaitDialog visible={loading} />
    </View>
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', gap: 8, paddingHorizontal: 8, paddingVertical: 10 },
  input: { flex: 1, minWidth: 0, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, paddingHorizontal: 14, paddingVertical: 13, fontSize: 20, color: colors.text },
  search: { flex: 1, backgroundColor: colors.navy, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', ...shadow },
  searchText: { color: colors.white, fontSize: 19, fontWeight: '600' },
  gridRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#E2E8F0' },
  cell: { flex: 1, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', paddingHorizontal: 6, paddingVertical: 8, borderRightWidth: 1, borderRightColor: '#E2E8F0', backgroundColor: colors.surface, minHeight: 46 },
  cellNum: { fontSize: 14, color: '#666', alignSelf: 'flex-start' },
  cellVal: { fontSize: 13, color: '#666', marginLeft: 2, flexShrink: 1 },
  cellValOn: { color: colors.navy, fontWeight: '700' },
});

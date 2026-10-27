import { MaterialIcons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiRequest, errorMessage } from '../api/client';
import { BackHeader } from '../components/BackHeader';
import { CORAL } from '../components/CalendarModal';
import { CenterMessage, SearchBox } from '../components/Controls';
import { WaitDialog } from '../components/WaitDialog';
import { colors, shadow } from '../theme';
import { num } from '../utils/format';
import { failure, tap } from '../utils/haptics';

// LIMIT BALANCE REPORT (live app): "Search Party..", SR. / L-BAL / L-LIMIT / TRANS-CONS / F-LIMIT —
// each party with a limit: name, then its balance, limit, the running cycle's consumption and the
// limit left (red when insufficient). Bottom: T-BAL · T-LIMIT · T-TRANS-CONS · T-F-LIMIT; the coral
// button sorts. Loads on open. Same API as the web Limit & Balance report (GET /vouchers/limit-balance).
interface Row { ledgerId: number; partyName: string; balance: number; limit: number; transConsum: number; finalLimit: number; status: string }
type Sort = 'NAME' | 'ASC' | 'DESC' | 'INSUFFICIENT';

export function LimitBalanceScreen() {
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort>('NAME');
  const [sortOpen, setSortOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest<Row[]>('/vouchers/limit-balance');
      setRows(res.data || []);
    } catch (err) {
      failure();
      Alert.alert('Message', errorMessage(err, 'Failed to load report'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const list = useMemo(() => {
    const t = search.trim().toUpperCase();
    const out = (rows || []).filter((r) => !t || r.partyName.toUpperCase().includes(t));
    out.sort((a, b) =>
      sort === 'ASC' ? num(a.finalLimit) - num(b.finalLimit)
        : sort === 'DESC' ? num(b.finalLimit) - num(a.finalLimit)
          : sort === 'INSUFFICIENT' ? (a.status === b.status ? a.partyName.localeCompare(b.partyName) : a.status === 'INSUFFICIENT' ? -1 : 1)
            : a.partyName.localeCompare(b.partyName));
    return out;
  }, [rows, search, sort]);

  const t = useMemo(() => list.reduce((a, r) => ({
    bal: a.bal + num(r.balance), lim: a.lim + num(r.limit), cons: a.cons + num(r.transConsum), fin: a.fin + num(r.finalLimit),
  }), { bal: 0, lim: 0, cons: 0, fin: 0 }), [list]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <BackHeader title="Limit Balance Report" />
      <SearchBox value={search} onChangeText={setSearch} placeholder="Search Party.." />
      <View style={styles.head}>
        <Text style={[styles.hCell, styles.cSr]}>SR.</Text>
        <Text style={[styles.hCell, styles.cNum]}>L-BAL</Text>
        <Text style={[styles.hCell, styles.cNum]}>L-LIMIT</Text>
        <Text style={[styles.hCell, styles.cNum, { flex: 1.2 }]}>TRANS-CONS</Text>
        <Text style={[styles.hCell, styles.cNum, { textAlign: 'right' }]}>F-LIMIT</Text>
      </View>

      <FlatList
        data={list}
        keyExtractor={(r) => String(r.ledgerId)}
        initialNumToRender={15}
        removeClippedSubviews
        onRefresh={load}
        refreshing={false}
        ListEmptyComponent={rows && !loading ? <CenterMessage text="Record not avaliable!" /> : null}
        contentContainerStyle={{ paddingBottom: 60, flexGrow: 1 }}
        renderItem={({ item, index }) => {
          const short = item.status === 'INSUFFICIENT' || num(item.finalLimit) < 0;
          return (
            <View style={styles.row}>
              <Text style={styles.index}>{index + 1}.</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>{item.partyName}</Text>
                <View style={styles.line} />
                <View style={styles.nums}>
                  <Text style={[styles.num, styles.cNum, { color: '#E53935' }]}>{Math.round(num(item.balance))}</Text>
                  <Text style={[styles.num, styles.cNum, { color: colors.navy }]}>{Math.round(num(item.limit))}</Text>
                  <Text style={[styles.num, styles.cNum, { flex: 1.2, color: '#E8961E' }]}>{Math.round(num(item.transConsum))}</Text>
                  <Text style={[styles.num, styles.cNum, { textAlign: 'right', color: short ? '#E53935' : colors.green }]}>{Math.round(num(item.finalLimit))}</Text>
                </View>
              </View>
            </View>
          );
        }}
      />

      <View style={[styles.footer, { paddingBottom: 10 + insets.bottom }]}>
        {([['T-BAL', t.bal], ['T-LIMIT', t.lim], ['T-TRANS-CONS', t.cons], ['T-F-LIMIT', t.fin]] as Array<[string, number]>).map(([label, v]) => (
          <View key={label} style={styles.foot}>
            <Text style={styles.footValue} numberOfLines={1} adjustsFontSizeToFit>{Math.round(v)}</Text>
            <Text style={styles.footLabel} numberOfLines={1} adjustsFontSizeToFit>{label}</Text>
          </View>
        ))}
      </View>
      <Pressable
        accessibilityLabel="Sort"
        onPress={() => { tap(); setSortOpen(true); }}
        style={({ pressed }) => [styles.fab, { bottom: 34 + insets.bottom }, pressed && { opacity: 0.85 }]}
      >
        <MaterialIcons name="sort" size={30} color="#5B2A1A" />
      </Pressable>

      <Modal visible={sortOpen} transparent animationType="fade" onRequestClose={() => setSortOpen(false)}>
        <Pressable style={{ flex: 1 }} onPress={() => setSortOpen(false)}>
          <View style={[styles.menu, { bottom: 120 + insets.bottom }]}>
            {([['NAME', 'SORT BY PARTY NAME'], ['ASC', 'SORT BY ASC'], ['DESC', 'SORT BY DESC'], ['INSUFFICIENT', 'INSUFFICIENT FIRST']] as Array<[Sort, string]>).map(([k, label]) => (
              <Pressable key={k} onPress={() => { tap(); setSort(k); setSortOpen(false); }} style={({ pressed }) => [styles.menuItem, pressed && { backgroundColor: colors.canvas }]}>
                <Text style={[styles.menuText, sort === k && { color: colors.navy, fontWeight: '700' }]}>{label}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
      <WaitDialog visible={loading} />
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 10, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceMuted },
  hCell: { fontSize: 13, fontWeight: '700', color: colors.text },
  cSr: { width: 40 },
  cNum: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceMuted, borderBottomWidth: 1.5, borderBottomColor: '#E2E8F0', paddingVertical: 12, paddingHorizontal: 10 },
  index: { width: 40, fontSize: 17, color: colors.text },
  name: { fontSize: 16, fontWeight: '600', color: colors.text, textTransform: 'uppercase' },
  line: { height: 1, backgroundColor: colors.divider, marginVertical: 5 },
  nums: { flexDirection: 'row' },
  num: { fontSize: 14, fontWeight: '600' },
  footer: { backgroundColor: colors.navyDark, flexDirection: 'row', paddingTop: 12, paddingHorizontal: 6 },
  foot: { flex: 1, alignItems: 'center' },
  footValue: { color: colors.white, fontSize: 17, fontWeight: '700' },
  footLabel: { color: colors.white, fontSize: 11, fontWeight: '500', marginTop: 2 },
  fab: { position: 'absolute', alignSelf: 'center', width: 60, height: 60, borderRadius: 30, backgroundColor: CORAL, alignItems: 'center', justifyContent: 'center', ...shadow, elevation: 8 },
  menu: { position: 'absolute', left: 14, width: 250, backgroundColor: colors.surface, borderRadius: 4, paddingVertical: 4, ...shadow, elevation: 10 },
  menuItem: { paddingHorizontal: 20, paddingVertical: 16 },
  menuText: { fontSize: 17, color: colors.text, letterSpacing: 0.3 },
});

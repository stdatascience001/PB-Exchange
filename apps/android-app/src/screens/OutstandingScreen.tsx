import { MaterialIcons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiRequest, errorMessage } from '../api/client';
import type { Agent } from '../api/types';
import { BackHeader } from '../components/BackHeader';
import { CORAL } from '../components/CalendarModal';
import { CenterMessage, SearchBox } from '../components/Controls';
import { WaitDialog } from '../components/WaitDialog';
import { colors, shadow } from '../theme';
import { isoDate, num } from '../utils/format';
import { failure, tap } from '../utils/haptics';

// ALL OUTSTANDING (live app): TOP LOOSER (parties with a Debit balance — they owe, "8145 Dr", navy)
// and TOP GAINER (Credit balance, "30563 Cr", red) tabs; each row the party, its agent group
// (amber) and its balance; TOTAL of the tab on the navy bar; the coral button sorts by party
// name, agent name, amount ascending or descending. Loads on open for today, every agent group.
// Same API as the web OutStanding report (GET /transactions/outstanding?date&agentIds).
interface OutRow { ledgerId: number; partyName: string; agentGroup: string; credit: number; debit: number }
interface OutData { rows: OutRow[]; totalCredit: number; totalDebit: number; final: number }

type Tab = 'LOOSER' | 'GAINER';
type Sort = 'PARTY' | 'AGENT' | 'ASC' | 'DESC';

export function OutstandingScreen() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('LOOSER');
  const [data, setData] = useState<OutData | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort>('PARTY');
  const [sortOpen, setSortOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const agents = await apiRequest<Agent[]>('/agents');
      const ids = (agents.data || []).map((a) => a.id).join(',');
      const res = await apiRequest<OutData>(`/transactions/outstanding?date=${isoDate(new Date())}&agentIds=${ids}`);
      setData(res.data || null);
    } catch (err) {
      failure();
      Alert.alert('Message', errorMessage(err, 'Failed to load outstanding'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const list = useMemo(() => {
    const t = search.trim().toUpperCase();
    const amt = (r: OutRow) => (tab === 'LOOSER' ? num(r.debit) : num(r.credit));
    const out = (data?.rows || [])
      .filter((r) => amt(r) > 0)
      .filter((r) => !t || r.partyName.toUpperCase().includes(t) || (r.agentGroup || '').toUpperCase().includes(t));
    out.sort((a, b) =>
      sort === 'AGENT' ? (a.agentGroup || '').localeCompare(b.agentGroup || '') || a.partyName.localeCompare(b.partyName)
        : sort === 'ASC' ? amt(a) - amt(b)
          : sort === 'DESC' ? amt(b) - amt(a)
            : a.partyName.localeCompare(b.partyName));
    return out.map((r) => ({ ...r, amount: amt(r) }));
  }, [data, tab, search, sort]);

  const total = useMemo(() => list.reduce((s, r) => s + r.amount, 0), [list]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <BackHeader title="All Outstanding" />
      <View style={styles.tabs}>
        {([['LOOSER', 'TOP LOOSER'], ['GAINER', 'TOP GAINER']] as Array<[Tab, string]>).map(([k, label]) => (
          <Pressable key={k} onPress={() => { tap(); setTab(k); }} style={styles.tab}>
            <Text style={styles.tabText}>{label}</Text>
            <View style={[styles.tabLine, tab === k && { backgroundColor: CORAL }]} />
          </Pressable>
        ))}
      </View>
      <SearchBox value={search} onChangeText={setSearch} placeholder="SEARCH PARY..." />
      <View style={styles.sep} />

      <FlatList
        data={list}
        keyExtractor={(r) => String(r.ledgerId)}
        initialNumToRender={15}
        windowSize={11}
        removeClippedSubviews
        onRefresh={load}
        refreshing={false}
        ListEmptyComponent={!loading ? <CenterMessage text="Record not avaliable!" /> : null}
        contentContainerStyle={{ paddingBottom: 60, flexGrow: 1 }}
        renderItem={({ item, index }) => (
          <View style={styles.row}>
            <Text style={styles.index}>{index + 1}.</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.party} numberOfLines={1}>{item.partyName}</Text>
              <Text style={styles.agent} numberOfLines={1}>{item.agentGroup || '-'}</Text>
            </View>
            <Text style={[styles.amount, tab === 'GAINER' && { color: '#E53935' }]}>
              {Math.round(item.amount)} {tab === 'LOOSER' ? 'Dr' : 'Cr'}
            </Text>
          </View>
        )}
      />

      <View style={[styles.footer, { paddingBottom: 14 + insets.bottom }]}>
        <Text style={styles.footLabel}>TOTAL</Text>
        <Text style={styles.footValue}>{Math.round(total)}</Text>
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
            {([['PARTY', 'SORT BY PARTY NAME'], ['AGENT', 'SORT BY AGENT NAME'], ['ASC', 'SORT BY ASC'], ['DESC', 'SORT BY DESC']] as Array<[Sort, string]>).map(([k, label]) => (
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
  tabs: { flexDirection: 'row', backgroundColor: colors.navy },
  tab: { flex: 1, alignItems: 'center', paddingTop: 14 },
  tabText: { color: colors.white, fontSize: 17, fontWeight: '500', paddingBottom: 14 },
  tabLine: { height: 4, alignSelf: 'stretch', backgroundColor: 'transparent' },
  sep: { height: 1, backgroundColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceMuted, borderBottomWidth: 1.5, borderBottomColor: '#E2E8F0', paddingVertical: 18, paddingHorizontal: 14 },
  index: { width: 56, fontSize: 19, color: colors.text },
  party: { fontSize: 18, fontWeight: '600', color: colors.text, textTransform: 'uppercase' },
  agent: { fontSize: 16, fontWeight: '600', color: '#E8961E', marginTop: 6, textTransform: 'uppercase' },
  amount: { fontSize: 19, fontWeight: '600', color: colors.navy, marginLeft: 8 },
  footer: { backgroundColor: colors.navy, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18, paddingTop: 14 },
  footLabel: { color: colors.white, fontSize: 17, fontWeight: '500' },
  footValue: { color: colors.white, fontSize: 24, fontWeight: '700' },
  fab: { position: 'absolute', alignSelf: 'center', width: 64, height: 64, borderRadius: 32, backgroundColor: CORAL, alignItems: 'center', justifyContent: 'center', ...shadow, elevation: 8 },
  menu: { position: 'absolute', left: 14, width: 260, backgroundColor: colors.surface, borderRadius: 4, paddingVertical: 4, ...shadow, elevation: 10 },
  menuItem: { paddingHorizontal: 20, paddingVertical: 16 },
  menuText: { fontSize: 17, color: colors.text, letterSpacing: 0.3 },
});

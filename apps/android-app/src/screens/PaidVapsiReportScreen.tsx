import { MaterialIcons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiRequest, errorMessage } from '../api/client';
import type { Ledger } from '../api/types';
import { BackHeader } from '../components/BackHeader';
import { CenterMessage, SearchBox } from '../components/Controls';
import { WaitDialog } from '../components/WaitDialog';
import { useApiList } from '../hooks/useApiList';
import { colors, radius, shadow } from '../theme';
import { num } from '../utils/format';
import { failure, tap } from '../utils/haptics';

// PAID VAPSI REPORT (live app): month (JAN … DEC) · year (2021 … 2028) · FIND, "Search Party..",
// then SR. / PARTY NAME (agent in amber) / B-AMT / % (green) / V-AMT of the month's posted vapsi;
// TOTAL BASE AMT · TOTAL VAPSI AMT on the navy bar. Same API as the web Vapsi Report
// (GET /transactions/vapsi-report?month&year); the agent comes from the party's ledger.
interface VapsiLine { voucherId: number; partyId: number | null; partyName: string; receiverName: string; baseAmt: number; vapsiPct: number; vapsiAmt: number }
interface VapsiReport { rows: VapsiLine[]; totalBase: number; totalVapsiAmt: number }

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const YEARS = [2021, 2022, 2023, 2024, 2025, 2026, 2027, 2028];

export function PaidVapsiReportScreen() {
  const insets = useSafeAreaInsets();
  const ledgers = useApiList<Ledger>('/ledgers');
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [menu, setMenu] = useState<'MONTH' | 'YEAR' | null>(null);
  const [data, setData] = useState<VapsiReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  // a party's agent: by ledger id, else by name (older vapsi lines carry no party id)
  const agentOf = useMemo(() => new Map(ledgers.data.map((l) => [l.id, l.agentName || ''])), [ledgers.data]);
  const agentByName = useMemo(() => new Map(ledgers.data.map((l) => [l.partyName.trim().toUpperCase(), l.agentName || ''])), [ledgers.data]);

  const load = async (m = month, y = year) => {
    setLoading(true);
    try {
      const res = await apiRequest<VapsiReport>(`/transactions/vapsi-report?month=${m}&year=${y}`);
      setData(res.data || null);
      if (!res.data?.rows?.length) Alert.alert('Error', 'Record not avaliable!');
    } catch (err) {
      failure();
      Alert.alert('Message', errorMessage(err, 'Failed to load report'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    const t = search.trim().toUpperCase();
    return (data?.rows || [])
      .filter((r) => !t || r.partyName.toUpperCase().includes(t))
      .sort((a, b) => a.partyName.localeCompare(b.partyName));
  }, [data, search]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <BackHeader title="Paid Vapsi Report" right={<MaterialIcons name="more-vert" size={28} color={colors.white} />} />
      <View style={styles.filters}>
        <Pressable onPress={() => { tap(); setMenu('MONTH'); }} style={({ pressed }) => [styles.box, pressed && { backgroundColor: colors.canvas }]}>
          <Text style={styles.boxText}>{MONTHS[month - 1]}</Text>
        </Pressable>
        <Pressable onPress={() => { tap(); setMenu('YEAR'); }} style={({ pressed }) => [styles.box, pressed && { backgroundColor: colors.canvas }]}>
          <Text style={styles.boxText}>{year}</Text>
        </Pressable>
        <Pressable onPress={() => { tap(); void load(); }} style={({ pressed }) => [styles.find, pressed && { backgroundColor: colors.navyDark }]}>
          <Text style={styles.findText}>FIND</Text>
        </Pressable>
      </View>
      <SearchBox value={search} onChangeText={setSearch} placeholder="Search Party.." />
      <View style={styles.head}>
        <Text style={[styles.hCell, styles.cSr]}>SR.</Text>
        <Text style={[styles.hCell, styles.cName]}>PARTY NAME</Text>
        <Text style={[styles.hCell, styles.cAmt]}>B-AMT</Text>
        <Text style={[styles.hCell, styles.cPct]}>%</Text>
        <Text style={[styles.hCell, styles.cAmt]}>V-AMT</Text>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(r) => String(r.voucherId)}
        initialNumToRender={15}
        removeClippedSubviews
        ListEmptyComponent={data && !loading ? <CenterMessage text="Record not avaliable!" /> : null}
        contentContainerStyle={{ flexGrow: 1 }}
        renderItem={({ item, index }) => (
          <View style={styles.row}>
            <Text style={[styles.sr, styles.cSr]}>{index + 1}.</Text>
            <View style={[styles.cName, { paddingVertical: 12 }]}>
              <Text style={styles.name} numberOfLines={1}>{item.partyName}</Text>
              <View style={styles.line} />
              <Text style={styles.agent} numberOfLines={1}>
                {(item.partyId ? agentOf.get(item.partyId) : '') || agentByName.get(item.partyName.trim().toUpperCase()) || ''}
              </Text>
            </View>
            <View style={[styles.cell, styles.cAmt]}><Text style={styles.val}>{Math.round(num(item.baseAmt))}</Text></View>
            <View style={[styles.cell, styles.cPct]}><Text style={[styles.val, { color: '#43A047' }]}>{num(item.vapsiPct)}</Text></View>
            <View style={[styles.cell, styles.cAmt]}><Text style={styles.val}>{Math.round(num(item.vapsiAmt))}</Text></View>
          </View>
        )}
      />

      <View style={[styles.footer, { paddingBottom: 12 + insets.bottom }]}>
        <View style={styles.foot}>
          <Text style={styles.footValue}>{Math.round(num(data?.totalBase))}</Text>
          <Text style={styles.footLabel}>TOTAL BASE AMT</Text>
        </View>
        <View style={[styles.foot, { borderLeftWidth: 1, borderLeftColor: 'rgba(255,255,255,0.4)' }]}>
          <Text style={styles.footValue}>{Math.round(num(data?.totalVapsiAmt))}</Text>
          <Text style={styles.footLabel}>TOTAL VAPSI AMT</Text>
        </View>
      </View>

      <Modal visible={menu !== null} transparent animationType="fade" onRequestClose={() => setMenu(null)}>
        <Pressable style={{ flex: 1 }} onPress={() => setMenu(null)}>
          <View style={[styles.menu, { top: insets.top + 64, left: menu === 'YEAR' ? '37%' : 10 }]}>
            {(menu === 'YEAR' ? YEARS.map(String) : MONTHS).map((label, i) => (
              <Pressable
                key={label}
                onPress={() => { tap(); if (menu === 'YEAR') setYear(Number(label)); else setMonth(i + 1); setMenu(null); }}
                style={({ pressed }) => [styles.menuItem, pressed && { backgroundColor: colors.canvas }]}
              >
                <Text style={styles.menuText}>{label}</Text>
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
  filters: { flexDirection: 'row', gap: 8, paddingHorizontal: 8, paddingTop: 10 },
  box: { flex: 1, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, justifyContent: 'center', paddingVertical: 14, paddingHorizontal: 18 },
  boxText: { fontSize: 20, color: colors.text },
  find: { flex: 1, backgroundColor: colors.navy, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', ...shadow },
  findText: { color: colors.white, fontSize: 19, fontWeight: '600' },
  head: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 8, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceMuted },
  hCell: { fontSize: 15, fontWeight: '700', color: colors.text },
  cSr: { width: 36 },
  cName: { flex: 1, paddingRight: 8 },
  cAmt: { width: 70, textAlign: 'right' },
  cPct: { width: 40, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'stretch', paddingHorizontal: 8, backgroundColor: colors.surfaceMuted, borderBottomWidth: 1.5, borderBottomColor: '#E2E8F0' },
  sr: { fontSize: 15, color: colors.text, alignSelf: 'center' },
  name: { fontSize: 15, fontWeight: '600', color: colors.text, textTransform: 'uppercase' },
  line: { height: 1, backgroundColor: colors.divider, marginVertical: 4 },
  agent: { fontSize: 14, fontWeight: '600', color: '#E8961E', textTransform: 'uppercase', paddingLeft: 10 },
  cell: { borderLeftWidth: 1, borderLeftColor: colors.divider, justifyContent: 'center', alignItems: 'flex-end', paddingRight: 2 },
  val: { fontSize: 15, fontWeight: '600', color: colors.text },
  footer: { backgroundColor: colors.navyDark, flexDirection: 'row', paddingTop: 12 },
  foot: { flex: 1, alignItems: 'center' },
  footValue: { color: colors.white, fontSize: 22, fontWeight: '700' },
  footLabel: { color: colors.white, fontSize: 13, fontWeight: '500', marginTop: 2 },
  menu: { position: 'absolute', width: 150, backgroundColor: colors.surface, borderRadius: 3, paddingVertical: 4, ...shadow, elevation: 10 },
  menuItem: { paddingHorizontal: 18, paddingVertical: 13 },
  menuText: { fontSize: 18, color: colors.text },
});

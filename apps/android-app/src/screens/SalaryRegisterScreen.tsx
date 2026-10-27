import React, { useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiRequest, errorMessage } from '../api/client';
import type { Staff } from '../api/types';
import { BackHeader } from '../components/BackHeader';
import { CenterMessage, SearchBox } from '../components/Controls';
import { WaitDialog } from '../components/WaitDialog';
import { useApiList } from '../hooks/useApiList';
import { colors, radius, shadow } from '../theme';
import { num } from '../utils/format';
import { failure, tap } from '../utils/haptics';

// SALARY REGISTER (live app, Report → Payroll Salary Register): month (JAN … DEC) · year · FIND,
// "Search Party..", one row per staff salary of the month; TOTAL EARNING · TOTAL DEDUCTION (red) ·
// TOTAL NET SALARY on the bottom bar. Data: the web Salary Register API
// (GET /payroll/salary-register?fromMonth&toMonth, one month).
//   Earning   = the staff's monthly salary (staff record)
//   Net       = the register's net salary (per-day × (present + paid leave))
//   Deduction = Earning − Net (the unpaid days)
interface SalaryRow { id: number; staffId: number; name: string; month: string; tDays: number; presentDays: number; payLeaveDays: number; netSalary: number; status: string }
interface StaffWithSalary extends Staff { monthlySalary?: number | string }

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const YEARS = [2021, 2022, 2023, 2024, 2025, 2026, 2027, 2028];

export function SalaryRegisterScreen() {
  const insets = useSafeAreaInsets();
  const staff = useApiList<StaffWithSalary>('/staff');
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [menu, setMenu] = useState<'MONTH' | 'YEAR' | null>(null);
  const [rows, setRows] = useState<SalaryRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  const salaryOf = useMemo(() => new Map(staff.data.map((s) => [s.id, num(s.monthlySalary)])), [staff.data]);

  const load = async (m = month, y = year) => {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    setLoading(true);
    try {
      const res = await apiRequest<SalaryRow[]>(`/payroll/salary-register?fromMonth=${key}&toMonth=${key}`);
      setRows(res.data || []);
      if (!res.data?.length) Alert.alert('Error', 'Record not avaliable!');
    } catch (err) {
      failure();
      Alert.alert('Message', errorMessage(err, 'Failed to load salary register'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const list = useMemo(() => {
    const t = search.trim().toUpperCase();
    return (rows || [])
      .filter((r) => !t || r.name.toUpperCase().includes(t))
      .map((r) => {
        const net = num(r.netSalary);
        const earning = Math.max(salaryOf.get(r.staffId) || 0, net);
        return { ...r, net, earning, deduction: earning - net };
      });
  }, [rows, search, salaryOf]);

  const totals = useMemo(
    () => list.reduce((a, r) => ({ e: a.e + r.earning, d: a.d + r.deduction, n: a.n + r.net }), { e: 0, d: 0, n: 0 }),
    [list],
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <BackHeader title="Salary Register" />
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
      <View style={styles.sep} />

      <FlatList
        data={list}
        keyExtractor={(r) => String(r.id)}
        initialNumToRender={15}
        ListEmptyComponent={rows && !loading ? <CenterMessage text="Record not avaliable!" /> : null}
        contentContainerStyle={{ flexGrow: 1 }}
        renderItem={({ item, index }) => (
          <View style={styles.row}>
            <Text style={styles.index}>{index + 1}.</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
              <View style={styles.line} />
              <Text style={styles.days}>
                P {item.presentDays} · PL {item.payLeaveDays} / {item.tDays}
                <Text style={{ color: item.status === 'PAID' ? colors.green : colors.amberDark }}>{'   '}{item.status}</Text>
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.net}>{Math.round(item.net)}</Text>
              <Text style={styles.sub}>
                <Text style={{ color: colors.navy }}>{Math.round(item.earning)}</Text>
                {'  '}
                <Text style={{ color: '#E53935' }}>{item.deduction ? `-${Math.round(item.deduction)}` : '0'}</Text>
              </Text>
            </View>
          </View>
        )}
      />

      <View style={[styles.footer, { paddingBottom: insets.bottom }]}>
        <View style={[styles.foot, { backgroundColor: colors.navyDark }]}>
          <Text style={styles.footValue}>{Math.round(totals.e)}</Text>
          <Text style={styles.footLabel}>TOTAL EARNING</Text>
        </View>
        <View style={[styles.foot, { backgroundColor: '#F04438' }]}>
          <Text style={styles.footValue}>{Math.round(totals.d)}</Text>
          <Text style={styles.footLabel}>TOTAL DEDUCTION</Text>
        </View>
        <View style={[styles.foot, { backgroundColor: colors.navyDark }]}>
          <Text style={styles.footValue}>{Math.round(totals.n)}</Text>
          <Text style={styles.footLabel}>TOTAL NET SALARY</Text>
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
  sep: { height: 1, backgroundColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceMuted, borderBottomWidth: 1.5, borderBottomColor: '#E2E8F0', paddingVertical: 14, paddingHorizontal: 12 },
  index: { width: 44, fontSize: 18, color: colors.text },
  name: { fontSize: 17, fontWeight: '600', color: colors.text, textTransform: 'uppercase' },
  line: { height: 1, backgroundColor: colors.divider, marginVertical: 5 },
  days: { fontSize: 13, fontWeight: '600', color: '#29A3D8' },
  net: { fontSize: 19, fontWeight: '700', color: colors.text },
  sub: { fontSize: 12, fontWeight: '600', marginTop: 4 },
  footer: { flexDirection: 'row' },
  foot: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  footValue: { color: colors.white, fontSize: 22, fontWeight: '700' },
  footLabel: { color: colors.white, fontSize: 12, fontWeight: '500', marginTop: 2 },
  menu: { position: 'absolute', width: 150, backgroundColor: colors.surface, borderRadius: 3, paddingVertical: 4, ...shadow, elevation: 10 },
  menuItem: { paddingHorizontal: 18, paddingVertical: 13 },
  menuText: { fontSize: 18, color: colors.text },
});

import React, { useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiRequest, errorMessage } from '../api/client';
import type { Ledger } from '../api/types';
import { BackHeader } from '../components/BackHeader';
import { CalendarModal } from '../components/CalendarModal';
import { CenterMessage } from '../components/Controls';
import { PartyPickerModal } from '../components/PartyPickerModal';
import { WaitDialog } from '../components/WaitDialog';
import { useApiList } from '../hooks/useApiList';
import { colors, radius, shadow } from '../theme';
import { dmy, num } from '../utils/format';
import { failure, tap } from '../utils/haptics';

// ADMIN CASH REPORT (live app): CHOOSE PARTY NAME, From – To dates · FIND, then SR. / PARTY NAME /
// CREDIT / DEBIT rows of the party's account (opening first), and CREDIT · DEBIT (red) · CLOSING
// BALANCE on the bottom bar. Opens on the party chooser, then the From and To calendars, then
// loads. Same API as the web Admin Cash page (GET /transactions/admin-cash?partyId&fromDate&toDate).
interface CashRow { date: string; partyName: string; credit: number; debit: number; balance: number; remark: string; updatedBy: string }
interface CashData { partyId: number; partyName: string; opening: number; closing: number; totalCredit: number; totalDebit: number; rows: CashRow[] }

type Step = 'PARTY' | 'FROM' | 'TO' | null;

// balance as live: credit (owed to the party) positive, debit negative
const crDr = (v: number) => (v < 0 ? `${Math.round(-v)} Cr` : v > 0 ? `${Math.round(v)} Dr` : '0');

export function AdminCashScreen() {
  const insets = useSafeAreaInsets();
  const ledgers = useApiList<Ledger>('/ledgers');
  const [party, setParty] = useState<Ledger | null>(null);
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  // opening flow: party chooser -> From -> To -> load (each OK moves on)
  const [step, setStep] = useState<Step>('PARTY');
  const [chain, setChain] = useState(true);
  const [data, setData] = useState<CashData | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async (p: Ledger | null = party, f: string | null = from, t: string | null = to) => {
    if (!p) { failure(); Alert.alert('Message', 'Please choose a valid party!'); return; }
    if (!f || !t) { failure(); Alert.alert('Message', 'Please select both Dates!'); return; }
    if (f > t) { failure(); Alert.alert('Message', 'From Date cannot be after To Date!'); return; }
    setLoading(true);
    try {
      const res = await apiRequest<CashData>(`/transactions/admin-cash?partyId=${p.id}&fromDate=${f}&toDate=${t}`);
      setData(res.data || null);
    } catch (err) {
      failure();
      setData(null);
      Alert.alert('Message', errorMessage(err, 'Failed to load report'));
    } finally {
      setLoading(false);
    }
  };

  const pickParty = (l: Ledger) => {
    setParty(l);
    setData(null);
    if (chain) { setStep('FROM'); return; }
    setStep(null);
  };

  const onDate = (d: string) => {
    if (step === 'FROM') {
      setFrom(d);
      if (chain) { setTo((prev) => (prev && prev >= d ? prev : d)); setStep('TO'); return; }
      setStep(null);
      return;
    }
    setTo(d);
    setStep(null);
    if (chain) { setChain(false); void load(party, from, d); }
  };

  const stopChain = () => { setChain(false); setStep(null); };

  // opening balance first, then the period's entries
  const rows: Array<CashRow & { key: string }> = data
    ? [
      { key: 'opening', date: from || '', partyName: 'OPENING', credit: data.opening < 0 ? -data.opening : 0, debit: data.opening > 0 ? data.opening : 0, balance: data.opening, remark: '', updatedBy: '' },
      ...data.rows.map((r, i) => ({ ...r, key: `r${i}` })),
    ]
    : [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <BackHeader title="Admin Cash Report" />
      <Pressable onPress={() => { tap(); setChain(false); setStep('PARTY'); }} style={({ pressed }) => [styles.partyBox, pressed && { backgroundColor: colors.canvas }]}>
        <Text style={[styles.partyText, party && { color: colors.text }]} numberOfLines={1}>{party ? party.partyName : 'CHOOSE PARTY NAME'}</Text>
      </Pressable>
      <View style={styles.filters}>
        <DateBox value={from} onPress={() => { setChain(false); setStep('FROM'); }} />
        <DateBox value={to} onPress={() => { setChain(false); setStep('TO'); }} />
        <Pressable onPress={() => { tap(); void load(); }} style={({ pressed }) => [styles.find, pressed && { backgroundColor: colors.navyDark }]}>
          <Text style={styles.findText}>FIND</Text>
        </Pressable>
      </View>

      <View style={styles.head}>
        <Text style={[styles.hCell, styles.cSr]}>SR.</Text>
        <Text style={[styles.hCell, styles.cName]}>PARTY NAME</Text>
        <Text style={[styles.hCell, styles.cAmt]}>CREDIT</Text>
        <Text style={[styles.hCell, styles.cAmt]}>DEBIT</Text>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        initialNumToRender={20}
        ListEmptyComponent={data ? <CenterMessage text="Record not avaliable!" /> : null}
        contentContainerStyle={{ flexGrow: 1 }}
        renderItem={({ item, index }) => (
          <View style={styles.row}>
            <Text style={[styles.cell, styles.cSr]}>{index + 1}.</Text>
            <View style={styles.cName}>
              <Text style={styles.name} numberOfLines={1}>{item.partyName}</Text>
              <Text style={styles.sub} numberOfLines={1}>
                {dmy(item.date)}{item.remark ? ` · ${item.remark}` : ''}  ·  {crDr(num(item.balance))}
              </Text>
            </View>
            <Text style={[styles.cell, styles.cAmt, { color: colors.green }]}>{num(item.credit) ? Math.round(num(item.credit)) : ''}</Text>
            <Text style={[styles.cell, styles.cAmt, { color: colors.crimson }]}>{num(item.debit) ? Math.round(num(item.debit)) : ''}</Text>
          </View>
        )}
      />

      <View style={[styles.footer, { paddingBottom: insets.bottom }]}>
        <View style={[styles.foot, { backgroundColor: colors.navy }]}>
          <Text style={styles.footValue}>{Math.round(num(data?.totalCredit))}</Text>
          <Text style={styles.footLabel}>CREDIT</Text>
        </View>
        <View style={[styles.foot, { backgroundColor: '#F04438', alignItems: 'center' }]}>
          <Text style={styles.footValue}>{Math.round(num(data?.totalDebit))}</Text>
          <Text style={styles.footLabel}>DEBIT</Text>
        </View>
        <View style={[styles.foot, { backgroundColor: colors.navyDark, alignItems: 'flex-end' }]}>
          <Text style={styles.footValue} numberOfLines={1} adjustsFontSizeToFit>{data ? crDr(num(data.closing)) : '0'}</Text>
          <Text style={styles.footLabel} numberOfLines={1} adjustsFontSizeToFit>CLOSING BALANCE</Text>
        </View>
      </View>

      <PartyPickerModal
        visible={step === 'PARTY'}
        parties={ledgers.data}
        loading={ledgers.loading}
        onClose={stopChain}
        onPick={pickParty}
      />
      <CalendarModal
        visible={step === 'FROM' || step === 'TO'}
        value={step === 'TO' ? (to || from) : from}
        onCancel={stopChain}
        onConfirm={onDate}
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
  partyBox: { marginHorizontal: 8, marginTop: 10, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, paddingVertical: 15, paddingHorizontal: 16 },
  partyText: { fontSize: 18, color: colors.textMuted, textTransform: 'uppercase' },
  filters: { flexDirection: 'row', gap: 8, paddingHorizontal: 8, paddingVertical: 10 },
  dateBox: { flex: 1, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, justifyContent: 'center', paddingVertical: 15, paddingHorizontal: 6 },
  dateText: { fontSize: 17, color: colors.textMuted, textAlign: 'center' },
  find: { flex: 1, backgroundColor: colors.navy, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', ...shadow },
  findText: { color: colors.white, fontSize: 19, fontWeight: '600' },
  head: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 10, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceMuted },
  hCell: { fontSize: 17, fontWeight: '700', color: colors.text },
  cSr: { width: 42 },
  cName: { flex: 1, paddingRight: 6 },
  cAmt: { width: 82, textAlign: 'right' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: '#E2E8F0', backgroundColor: colors.surfaceMuted },
  cell: { fontSize: 15, color: colors.text, fontWeight: '600' },
  name: { fontSize: 15, fontWeight: '600', color: colors.text, textTransform: 'uppercase' },
  sub: { fontSize: 11.5, color: colors.textMuted, marginTop: 2 },
  footer: { flexDirection: 'row', backgroundColor: colors.navyDark },
  foot: { flex: 1, paddingHorizontal: 10, paddingVertical: 12 },
  footValue: { color: colors.white, fontSize: 22, fontWeight: '700' },
  footLabel: { color: colors.white, fontSize: 13, fontWeight: '500', marginTop: 2 },
});

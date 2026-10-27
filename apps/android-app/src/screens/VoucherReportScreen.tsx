import React, { useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiRequest, errorMessage } from '../api/client';
import type { Ledger, ManualVoucher } from '../api/types';
import { BackHeader } from '../components/BackHeader';
import { CalendarModal } from '../components/CalendarModal';
import { PartyPickerModal } from '../components/PartyPickerModal';
import { WaitDialog } from '../components/WaitDialog';
import { useApiList } from '../hooks/useApiList';
import { colors, radius, shadow } from '../theme';
import { dmy, isoDate, num } from '../utils/format';
import { failure, tap } from '../utils/haptics';

// VOUCHER REPORT (live app, Report → Voucher List): a party's vouchers (Journal, Limit, Kist,
// Vapsi, Hawa Patti …) over From – To — OPENING first, then each voucher with the other party,
// its date (cyan) and the amount under CREDIT (came in, "AAYE") or DEBIT (went out, "GAYA").
// Bottom bar: CREDIT / AAYE · DEBIT / GAYA (red) · CLOSING BALANCE. Opens on the party chooser,
// then the From and To calendars, then loads. Data: GET /vouchers/manual (the web Voucher List API).
interface Line { key: string; name: string; date: string; credit: number; debit: number; narration?: string | null }

// Credit for this party = money received (its own side Cr, or the other side of a Dr voucher)
const sideFor = (v: ManualVoucher, partyId: number): 'CR' | 'DR' | null => {
  const own = v.entrySide === 'CR' ? 'CR' : 'DR';
  if (v.partyLedgerId === partyId) return own;
  if (v.oppositeLedgerId === partyId) return own === 'CR' ? 'DR' : 'CR';
  return null;
};

const dayBefore = (iso: string) => { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() - 1); return isoDate(d); };

export function VoucherReportScreen() {
  const insets = useSafeAreaInsets();
  const ledgers = useApiList<Ledger>('/ledgers');
  const [party, setParty] = useState<Ledger | null>(null);
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [step, setStep] = useState<'PARTY' | 'FROM' | 'TO' | null>('PARTY');
  const [chain, setChain] = useState(true);
  const [lines, setLines] = useState<Line[] | null>(null);
  const [totals, setTotals] = useState({ credit: 0, debit: 0, closing: 0 });
  const [loading, setLoading] = useState(false);

  const load = async (p: Ledger | null = party, f: string | null = from, t: string | null = to) => {
    if (!p) { failure(); Alert.alert('Message', 'Please choose a valid party!'); return; }
    if (!f || !t) { failure(); Alert.alert('Message', 'Please select both Dates!'); return; }
    if (f > t) { failure(); Alert.alert('Message', 'From Date cannot be after To Date!'); return; }
    setLoading(true);
    try {
      const [period, before] = await Promise.all([
        apiRequest<ManualVoucher[]>(`/vouchers/manual?fromDate=${f}&toDate=${t}`),
        apiRequest<ManualVoucher[]>(`/vouchers/manual?fromDate=2000-01-01&toDate=${dayBefore(f)}`),
      ]);
      // opening: credit − debit of every earlier voucher of the party
      let opening = 0;
      for (const v of before.data || []) {
        const s = sideFor(v, p.id);
        if (s) opening += s === 'CR' ? num(v.totalAmount) : -num(v.totalAmount);
      }
      const rows: Line[] = [{ key: 'opening', name: 'OPENING', date: f, credit: opening > 0 ? opening : 0, debit: opening < 0 ? -opening : 0 }];
      let credit = 0;
      let debit = 0;
      const mine = (period.data || [])
        .filter((v) => sideFor(v, p.id))
        .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
      for (const v of mine) {
        const s = sideFor(v, p.id);
        const amt = num(v.totalAmount);
        if (s === 'CR') credit += amt; else debit += amt;
        rows.push({
          key: String(v.id),
          // a cash voucher has no other party ("-"): shown by its type (CASH PAYMENT …)
          name: ((v.partyLedgerId === p.id ? v.oppositePartyName : v.partyName) || '').replace(/^-$/, '') || String((v as ManualVoucher & { voucherType?: string }).voucherType || 'CASH').replace(/_/g, ' '),
          date: v.createdAt,
          credit: s === 'CR' ? amt : 0,
          debit: s === 'DR' ? amt : 0,
          narration: v.narration,
        });
      }
      setLines(rows);
      setTotals({ credit, debit, closing: opening + credit - debit });
    } catch (err) {
      failure();
      Alert.alert('Message', errorMessage(err, 'Failed to load report'));
    } finally {
      setLoading(false);
    }
  };

  const pickParty = (l: Ledger) => { setParty(l); setLines(null); setStep(chain ? 'FROM' : null); };
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

  const closingText = totals.closing > 0 ? `${Math.round(totals.closing)} Cr` : totals.closing < 0 ? `${Math.round(-totals.closing)} Dr` : '0';

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <BackHeader title="Voucher Report" />
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
        data={lines || []}
        keyExtractor={(l) => l.key}
        initialNumToRender={20}
        contentContainerStyle={{ flexGrow: 1 }}
        renderItem={({ item, index }) => (
          <View style={styles.row}>
            <Text style={[styles.sr, styles.cSr]}>{index + 1}.</Text>
            <View style={styles.cName}>
              <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
              <View style={styles.line} />
              <Text style={styles.date} numberOfLines={1}>{dmy(item.date)}{item.narration ? `  ·  ${item.narration}` : ''}</Text>
            </View>
            <View style={styles.amtCell}><Text style={styles.amt}>{item.key === 'opening' || item.credit ? Math.round(item.credit) : ''}</Text></View>
            <View style={styles.amtCell}><Text style={[styles.amt, { color: colors.crimson }]}>{item.debit ? Math.round(item.debit) : ''}</Text></View>
          </View>
        )}
      />

      <View style={[styles.footer, { paddingBottom: insets.bottom }]}>
        <View style={[styles.foot, { backgroundColor: colors.navy }]}>
          <Text style={styles.footValue}>{Math.round(totals.credit)}</Text>
          <Text style={styles.footLabel}>CREDIT / AAYE</Text>
        </View>
        <View style={[styles.foot, { backgroundColor: '#F04438', alignItems: 'center' }]}>
          <Text style={styles.footValue}>{Math.round(totals.debit)}</Text>
          <Text style={styles.footLabel}>DEBIT / GAYA</Text>
        </View>
        <View style={[styles.foot, { backgroundColor: colors.navyDark, alignItems: 'flex-end' }]}>
          <Text style={styles.footValue} numberOfLines={1} adjustsFontSizeToFit>{closingText}</Text>
          <Text style={styles.footLabel} numberOfLines={1} adjustsFontSizeToFit>CLOSING BALANCE</Text>
        </View>
      </View>

      <PartyPickerModal visible={step === 'PARTY'} parties={ledgers.data} loading={ledgers.loading} onClose={stopChain} onPick={pickParty} />
      <CalendarModal visible={step === 'FROM' || step === 'TO'} value={step === 'TO' ? (to || from) : from} onCancel={stopChain} onConfirm={onDate} />
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
  cName: { flex: 1, paddingRight: 10 },
  cAmt: { width: 80, textAlign: 'right' },
  row: { flexDirection: 'row', alignItems: 'stretch', paddingHorizontal: 10, backgroundColor: colors.surfaceMuted },
  sr: { fontSize: 17, color: colors.text, alignSelf: 'center' },
  name: { fontSize: 16, fontWeight: '600', color: colors.text, textTransform: 'uppercase', marginTop: 12 },
  line: { height: 1, backgroundColor: colors.divider, marginVertical: 5 },
  date: { fontSize: 14, fontWeight: '600', color: '#29A3D8', marginBottom: 12 },
  amtCell: { width: 80, borderLeftWidth: 1, borderLeftColor: colors.divider, justifyContent: 'center', alignItems: 'flex-end', paddingRight: 4 },
  amt: { fontSize: 17, fontWeight: '600', color: colors.navy },
  footer: { flexDirection: 'row', backgroundColor: colors.navyDark },
  foot: { flex: 1, paddingHorizontal: 10, paddingVertical: 12 },
  footValue: { color: colors.white, fontSize: 22, fontWeight: '700' },
  footLabel: { color: colors.white, fontSize: 13, fontWeight: '500', marginTop: 2 },
});

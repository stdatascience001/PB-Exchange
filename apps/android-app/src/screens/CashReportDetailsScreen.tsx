import { RouteProp, useRoute } from '@react-navigation/native';
import React, { useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiRequest, errorMessage } from '../api/client';
import { BackHeader } from '../components/BackHeader';
import { CenterMessage } from '../components/Controls';
import { WaitDialog } from '../components/WaitDialog';
import type { RootStackParamList } from '../navigation/types';
import { colors } from '../theme';
import { dmy, num } from '../utils/format';

// CASH REPORT DETAILS (live app: Cash Agent Report → tap an agent): the agent's account over the
// report's From – To — OPENING first, then each entry: the other party, its date (cyan) and remark
// (amber), CREDIT / DEBIT (a debit printed negative, red). Bottom: CREDIT · DEBIT · CLOSING BALANCE
// (credit − debit side, as live: an agent holding 1143740 shows −1143740).
// Same API as the web Admin Cash page (GET /transactions/admin-cash?partyId&fromDate&toDate).
interface CashRow { date: string; partyName: string; credit: number; debit: number; remark: string }
interface CashData { opening: number; closing: number; totalCredit: number; totalDebit: number; rows: CashRow[] }
interface Line { key: string; name: string; date: string; tag: string; credit: number; debit: number }

export function CashReportDetailsScreen() {
  const insets = useSafeAreaInsets();
  const { params } = useRoute<RouteProp<RootStackParamList, 'CashReportDetails'>>();
  const [data, setData] = useState<CashData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    apiRequest<CashData>(`/transactions/admin-cash?partyId=${params.ledgerId}&fromDate=${params.from}&toDate=${params.to}`)
      .then((r) => { if (alive) setData(r.data || null); })
      .catch((err) => { if (alive) setError(errorMessage(err, 'Failed to load details')); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [params]);

  const opening = num(data?.opening);
  const lines: Line[] = data
    ? [
      { key: 'opening', name: '', date: params.from, tag: 'OPENING', credit: opening < 0 ? -opening : 0, debit: opening > 0 ? opening : 0 },
      ...data.rows.map((r, i) => ({ key: `r${i}`, name: r.partyName, date: r.date, tag: r.remark || '', credit: num(r.credit), debit: num(r.debit) })),
    ]
    : [];
  const closing = -num(data?.closing);

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <BackHeader title="Cash Report Details" />
      <View style={styles.head}>
        <Text style={[styles.hCell, styles.cSr]}>SR.</Text>
        <Text style={[styles.hCell, styles.cName]}>PARTY NAME</Text>
        <Text style={[styles.hCell, styles.cAmt]}>CREDIT</Text>
        <Text style={[styles.hCell, styles.cAmt]}>DEBIT</Text>
      </View>
      <FlatList
        data={lines}
        keyExtractor={(l) => l.key}
        initialNumToRender={20}
        ListEmptyComponent={!loading ? <CenterMessage text={error || 'Record not avaliable!'} /> : null}
        contentContainerStyle={{ flexGrow: 1 }}
        renderItem={({ item, index }) => (
          <View style={styles.row}>
            <Text style={[styles.sr, styles.cSr]}>{index + 1}.</Text>
            <View style={styles.cName}>
              <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
              <View style={styles.line} />
              <Text numberOfLines={1}>
                <Text style={styles.date}>{dmy(item.date)}</Text>
                {!!item.tag && <Text style={styles.tag}>{'   '}{item.tag}</Text>}
              </Text>
            </View>
            <View style={styles.amtCell}><Text style={[styles.amt, { color: colors.navy }]}>{item.credit ? Math.round(item.credit) : ''}</Text></View>
            <View style={styles.amtCell}><Text style={[styles.amt, { color: '#E53935' }]}>{item.debit ? Math.round(-item.debit) : item.key === 'opening' && !item.credit ? '0' : ''}</Text></View>
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
        <View style={[styles.foot, { backgroundColor: closing < 0 ? '#F04438' : colors.navyDark, alignItems: 'flex-end', borderLeftWidth: 1, borderLeftColor: 'rgba(255,255,255,0.25)' }]}>
          <Text style={styles.footValue} numberOfLines={1} adjustsFontSizeToFit>{Math.round(closing)}</Text>
          <Text style={styles.footLabel} numberOfLines={1} adjustsFontSizeToFit>CLOSING BALANCE</Text>
        </View>
      </View>
      <WaitDialog visible={loading} />
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 10, borderBottomWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceMuted },
  hCell: { fontSize: 17, fontWeight: '700', color: colors.text },
  cSr: { width: 42 },
  cName: { flex: 1, paddingRight: 10 },
  cAmt: { width: 86, textAlign: 'right' },
  row: { flexDirection: 'row', alignItems: 'stretch', paddingHorizontal: 10, backgroundColor: colors.surfaceMuted },
  sr: { fontSize: 18, color: colors.text, alignSelf: 'center' },
  name: { fontSize: 16, fontWeight: '600', color: colors.text, textTransform: 'uppercase', marginTop: 12, minHeight: 20 },
  line: { height: 1, backgroundColor: colors.divider, marginVertical: 5 },
  date: { fontSize: 15, fontWeight: '600', color: '#29A3D8' },
  tag: { fontSize: 15, fontWeight: '600', color: '#E8961E' },
  amtCell: { width: 86, borderLeftWidth: 1, borderLeftColor: colors.divider, justifyContent: 'center', alignItems: 'flex-end', paddingVertical: 12 },
  amt: { fontSize: 18, fontWeight: '600' },
  footer: { flexDirection: 'row' },
  foot: { flex: 1, paddingHorizontal: 10, paddingVertical: 12 },
  footValue: { color: colors.white, fontSize: 22, fontWeight: '700' },
  footLabel: { color: colors.white, fontSize: 13, fontWeight: '500', marginTop: 2 },
});

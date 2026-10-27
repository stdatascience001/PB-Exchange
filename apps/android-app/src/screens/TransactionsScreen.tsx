import { RouteProp, useRoute } from '@react-navigation/native';
import React, { useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import type { TransactionRow } from '../api/types';
import { BackHeader } from '../components/BackHeader';
import { CenterMessage, SearchBox } from '../components/Controls';
import { ListRow } from '../components/ListRow';
import { useApiList } from '../hooks/useApiList';
import type { RootStackParamList } from '../navigation/types';
import { colors } from '../theme';
import { dmyTime, num } from '../utils/format';

// A shift's slips for its day (GET /transactions?shiftId&date) — opened from a Dashboard card.
// Amounts as entered (a Company slip shows positive, as live), with the total on top.
export function TransactionsScreen() {
  const { params } = useRoute<RouteProp<RootStackParamList, 'Transactions'>>();
  const path = params?.shiftId ? `/transactions?shiftId=${params.shiftId}${params.date ? `&date=${params.date}` : ''}` : null;
  const tx = useApiList<TransactionRow>(path);
  const [search, setSearch] = useState('');

  const list = useMemo(() => {
    const t = search.trim().toUpperCase();
    return tx.data.filter((r) => r.status !== 'VOIDED' && (!t || r.partyName.toUpperCase().includes(t)));
  }, [tx.data, search]);
  const total = useMemo(() => list.reduce((s, r) => s + Math.abs(num(r.totalAmount)), 0), [list]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <BackHeader title={params?.shiftName || 'Transactions'} />
      <View style={styles.summary}>
        <Text style={styles.summaryText}>{list.length} SLIPS</Text>
        <Text style={styles.summaryTotal}>{Math.round(total)}</Text>
      </View>
      <SearchBox value={search} onChangeText={setSearch} placeholder="Search Party.." />
      <View style={styles.sep} />
      <FlatList
        data={list}
        keyExtractor={(r) => String(r.id)}
        initialNumToRender={15}
        removeClippedSubviews
        refreshControl={<RefreshControl refreshing={tx.refreshing} onRefresh={tx.refresh} colors={[colors.navy]} />}
        ListEmptyComponent={<CenterMessage loading={tx.loading} text={tx.error || 'No transactions'} />}
        contentContainerStyle={list.length === 0 ? { flexGrow: 1 } : undefined}
        renderItem={({ item, index }) => (
          <ListRow
            index={index + 1}
            title={item.partyName}
            tag={item.rateStr || ''}
            tagColor={colors.cyan}
            code={String(Math.round(Math.abs(num(item.totalAmount))))}
            codeColor={colors.text}
            rightTop={item.addedBy || ''}
            rightBottom={dmyTime(item.createdAt)}
          />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  summary: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.surface, paddingHorizontal: 18, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  summaryText: { fontSize: 15, fontWeight: '700', color: colors.textMuted },
  summaryTotal: { fontSize: 22, fontWeight: '700', color: colors.navy },
  sep: { height: 1, backgroundColor: colors.border },
});

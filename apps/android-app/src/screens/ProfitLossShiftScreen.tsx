import { RouteProp, useRoute } from '@react-navigation/native';
import React, { useEffect, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { apiRequest } from '../api/client';
import { BackHeader } from '../components/BackHeader';
import { CenterMessage } from '../components/Controls';
import type { RootStackParamList } from '../navigation/types';
import { colors } from '../theme';
import { isoDate, num } from '../utils/format';
import type { ShiftPnlRow } from './ProfitLossScreen';
import { plStyles as styles } from './ProfitLossScreen';

// P & L Report → a shift ("DELHI BAZAAR { K-66 }"): one row per day of the range with its sale
// (amber) and profit " /-" — the same report asked for each day on its own
const MAX_DAYS = 62;

export function ProfitLossShiftScreen() {
  const { params } = useRoute<RouteProp<RootStackParamList, 'ProfitLossShift'>>();
  const [days, setDays] = useState<Array<{ date: string; sale: number; profit: number }> | null>(null);

  useEffect(() => {
    let alive = true;
    const dates: string[] = [];
    const end = new Date(`${params.to}T00:00:00`);
    for (let d = new Date(`${params.from}T00:00:00`); d <= end && dates.length < MAX_DAYS; d.setDate(d.getDate() + 1)) dates.push(isoDate(d));
    Promise.all(dates.map((day) =>
      apiRequest<{ rows: ShiftPnlRow[] }>(`/transactions/shift-profit-loss?fromDate=${day}&toDate=${day}`)
        .then((r) => {
          const row = (r.data?.rows || []).find((x) => x.shiftId === params.shiftId);
          return row ? { date: day, sale: num(row.totalSale), profit: num(row.closing) } : null;
        })
        .catch(() => null),
    )).then((list) => { if (alive) setDays(list.filter(Boolean) as Array<{ date: string; sale: number; profit: number }>); });
    return () => { alive = false; };
  }, [params.shiftId, params.from, params.to]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <BackHeader title={params.title} />
      <FlatList
        data={days || []}
        keyExtractor={(d) => d.date}
        ListEmptyComponent={<CenterMessage loading={!days} text="Record not avaliable!" />}
        contentContainerStyle={{ flexGrow: 1 }}
        renderItem={({ item, index }) => (
          <View style={[styles.row, { borderBottomWidth: 0 }]}>
            <Text style={styles.index}>{index + 1}.</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.date}</Text>
              <Text style={styles.sale}>{Math.round(item.sale)}</Text>
            </View>
            <Text style={[styles.net, item.profit < 0 && { color: '#E53935' }]}>{Math.round(item.profit)} /-</Text>
          </View>
        )}
      />
    </View>
  );
}

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiRequest } from '../api/client';
import type { Shift } from '../api/types';
import { BackHeader } from '../components/BackHeader';
import { CORAL } from '../components/CalendarModal';
import { CenterMessage } from '../components/Controls';
import { useApiList } from '../hooks/useApiList';
import { colors } from '../theme';
import { tap } from '../utils/haptics';

// RESULT (live app, Report → Result Report): one scrolling tab per shift (DELHI BAZAAR, SHRI GANESH …,
// the active one underlined in coral); under it the shift's declared results, newest first —
// "1.  26-10-2026  ………  28". Same API as the web pages' result history
// (GET /declarations/summary?shiftId), the date read as stored (the web's rule).
interface Declaration { id: number; winningNumber: string; declaredAt: string }

const ddmmyyyy = (v: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v || '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : v;
};

export function ResultReportScreen() {
  const insets = useSafeAreaInsets();
  const shifts = useApiList<Shift>('/shifts');
  const active = useMemo(() => shifts.data.filter((s) => s.isActive !== false), [shifts.data]);
  const [shiftId, setShiftId] = useState<number | null>(null);
  const [cache, setCache] = useState<Record<number, Declaration[]>>({});
  const [loading, setLoading] = useState(false);
  const tabs = useRef<ScrollView>(null);

  useEffect(() => { if (shiftId === null && active.length) setShiftId(active[0].id); }, [active, shiftId]);

  useEffect(() => {
    if (shiftId === null || cache[shiftId]) return;
    let alive = true;
    setLoading(true);
    apiRequest<Declaration[]>(`/declarations/summary?shiftId=${shiftId}`)
      .then((r) => { if (alive) setCache((c) => ({ ...c, [shiftId]: r.data || [] })); })
      .catch(() => { if (alive) setCache((c) => ({ ...c, [shiftId]: [] })); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [shiftId, cache]);

  const rows = shiftId !== null ? cache[shiftId] : undefined;

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <BackHeader title="Result" />
      <View style={styles.tabBar}>
        <ScrollView ref={tabs} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 4 }}>
          {active.map((s) => (
            <Pressable key={s.id} onPress={() => { tap(); setShiftId(s.id); }} style={styles.tab}>
              <Text style={styles.tabText} numberOfLines={1}>{s.name}</Text>
              <View style={[styles.tabLine, shiftId === s.id && { backgroundColor: CORAL }]} />
            </Pressable>
          ))}
        </ScrollView>
      </View>
      <FlatList
        data={rows || []}
        keyExtractor={(d) => String(d.id)}
        initialNumToRender={20}
        ListEmptyComponent={<CenterMessage loading={loading || shifts.loading || !rows} text="Record not avaliable!" />}
        contentContainerStyle={{ flexGrow: 1, paddingBottom: insets.bottom + 8 }}
        renderItem={({ item, index }) => (
          <View style={styles.row}>
            <Text style={styles.index}>{index + 1}.</Text>
            <Text style={styles.date}>{ddmmyyyy(item.declaredAt)}</Text>
            <Text style={styles.result}>{String(item.winningNumber).padStart(2, '0')}</Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  tabBar: { backgroundColor: colors.navy },
  tab: { paddingTop: 14, paddingHorizontal: 14, alignItems: 'center' },
  tabText: { color: colors.white, fontSize: 16, fontWeight: '500', paddingBottom: 14, textTransform: 'uppercase' },
  tabLine: { height: 4, alignSelf: 'stretch', backgroundColor: 'transparent' },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderBottomWidth: 1.5, borderBottomColor: '#E2E8F0', paddingVertical: 16, paddingHorizontal: 16 },
  index: { width: 46, fontSize: 16, color: '#555' },
  date: { flex: 1, fontSize: 16, color: '#555' },
  result: { fontSize: 22, fontWeight: '700', color: colors.text },
});

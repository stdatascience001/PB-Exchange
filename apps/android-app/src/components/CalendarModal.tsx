import { MaterialIcons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius } from '../theme';
import { isoDate } from '../utils/format';
import { tap } from '../utils/haptics';

// Material-style date picker of the live app: coral header (year + "Fri, 23 Oct"), month with
// ‹ › navigation, S M T W T F S grid, the picked day in a coral circle, CANCEL / OK.
// Same look on Android, iOS and the web build.
export const CORAL = '#F2956E';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON = MONTHS.map((m) => m.slice(0, 3));
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const parse = (iso: string | null | undefined): Date => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date();
};

export function CalendarModal({ visible, value, onCancel, onConfirm }: {
  visible: boolean; value: string | null; onCancel: () => void; onConfirm: (iso: string) => void;
}) {
  const [picked, setPicked] = useState<Date>(parse(value));
  const [month, setMonth] = useState<Date>(new Date(parse(value).getFullYear(), parse(value).getMonth(), 1));

  // re-open on the field's current value
  useEffect(() => {
    if (!visible) return;
    const d = parse(value);
    setPicked(d);
    setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
  }, [visible, value]);

  const cells = useMemo(() => {
    const first = month.getDay();
    const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const out: Array<number | null> = Array.from({ length: first }, () => null);
    for (let d = 1; d <= days; d++) out.push(d);
    while (out.length % 7) out.push(null);
    return out;
  }, [month]);

  const isPicked = (d: number) =>
    picked.getFullYear() === month.getFullYear() && picked.getMonth() === month.getMonth() && picked.getDate() === d;

  const shift = (n: number) => { tap(); setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1)); };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.card} onPress={() => undefined}>
          <View style={styles.head}>
            <Text style={styles.year}>{picked.getFullYear()}</Text>
            <Text style={styles.date}>{DAYS[picked.getDay()]}, {picked.getDate()} {MON[picked.getMonth()]}</Text>
          </View>

          <View style={styles.monthRow}>
            <Pressable hitSlop={12} onPress={() => shift(-1)}><MaterialIcons name="chevron-left" size={30} color={colors.text} /></Pressable>
            <Text style={styles.month}>{MONTHS[month.getMonth()]} {month.getFullYear()}</Text>
            <Pressable hitSlop={12} onPress={() => shift(1)}><MaterialIcons name="chevron-right" size={30} color={colors.text} /></Pressable>
          </View>

          <View style={styles.week}>
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <Text key={i} style={styles.weekDay}>{d}</Text>)}
          </View>
          <View style={styles.grid}>
            {cells.map((d, i) => (
              <View key={i} style={styles.cell}>
                {d !== null && (
                  <Pressable
                    onPress={() => { tap(); setPicked(new Date(month.getFullYear(), month.getMonth(), d)); }}
                    style={[styles.day, isPicked(d) && styles.dayOn]}
                  >
                    <Text style={[styles.dayText, isPicked(d) && styles.dayTextOn]}>{d}</Text>
                  </Pressable>
                )}
              </View>
            ))}
          </View>

          <View style={styles.actions}>
            <Pressable hitSlop={8} onPress={() => { tap(); onCancel(); }}><Text style={styles.action}>CANCEL</Text></Pressable>
            <Pressable hitSlop={8} onPress={() => { tap(); onConfirm(isoDate(picked)); }}><Text style={styles.action}>OK</Text></Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 360, backgroundColor: colors.surface, borderRadius: 3, overflow: 'hidden' },
  head: { backgroundColor: CORAL, paddingHorizontal: 22, paddingTop: 18, paddingBottom: 20 },
  year: { color: 'rgba(255,255,255,0.75)', fontSize: 17, fontWeight: '500' },
  date: { color: colors.white, fontSize: 34, fontWeight: '600', marginTop: 4 },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22, paddingTop: 20, paddingBottom: 14 },
  month: { fontSize: 16, fontWeight: '600', color: colors.text },
  week: { flexDirection: 'row', paddingHorizontal: 12, marginBottom: 6 },
  weekDay: { flex: 1, textAlign: 'center', fontSize: 13, color: colors.textMuted },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12 },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  day: { width: '86%', aspectRatio: 1, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  dayOn: { backgroundColor: CORAL },
  dayText: { fontSize: 15, color: colors.text },
  dayTextOn: { color: colors.white, fontWeight: '700' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 40, paddingHorizontal: 26, paddingVertical: 22 },
  action: { color: CORAL, fontSize: 16, fontWeight: '600', letterSpacing: 0.4 },
});

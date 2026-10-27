import { useNavigation } from '@react-navigation/native';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import type { DashboardShift } from '../api/types';
import { RoleMessageBanner } from '../components/RoleMessageBanner';
import { canOpenRoute } from '../config/roleAccess';
import { useAuth } from '../store/auth';
import { subscribeDashboard, useDashboard } from '../store/dashboard';
import { colors, radius, shadow } from '../theme';
import { amount, dmy, num } from '../utils/format';
import { tap } from '../utils/haptics';

// Dashboard (live app): greeting banner, the role's message (if any), then TRANSACTION — one card per active shift.
//   declared shift -> name, date, "Result" and the result number in a coral circle
//   open shift     -> name, "Sale", total sale and the live amount in a red pill
// Live through the dashboard stream (store/dashboard.ts); pull down to refresh.
export function DashboardScreen() {
  const navigation = useNavigation<any>();
  const user = useAuth((s) => s.user);
  const { metrics, loading, refresh, live, error } = useDashboard();
  const { width } = useWindowDimensions();
  const [messageKey, setMessageKey] = useState(0); // pull-to-refresh reloads the role message too

  useEffect(() => subscribeDashboard(), []);

  const shifts = useMemo(() => (metrics?.shifts || []).filter((s) => s.isActive !== false), [metrics]);
  const cardWidth = (width - 24 * 2 - 12 * 2 - 12) / 2;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.canvas }}
      contentContainerStyle={{ paddingBottom: 24 }}
      refreshControl={<RefreshControl refreshing={loading && !!metrics} onRefresh={() => { setMessageKey((k) => k + 1); void refresh(); }} colors={[colors.navy]} />}
    >
      <View style={styles.banner}>
        <View style={{ flex: 1 }}>
          <Text style={styles.hi} numberOfLines={1}>HI, {(user?.username || '').toUpperCase()}.</Text>
          <Text style={styles.role}>{(user?.roleName || '').toUpperCase()}</Text>
        </View>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{(user?.username || '?').charAt(0).toUpperCase()}</Text>
        </View>
      </View>

      <RoleMessageBanner roleId={user?.roleId} reloadKey={messageKey} />

      <View style={styles.sectionRow}>
        <Text style={styles.section}>TRANSACTION</Text>
        <View style={[styles.liveDot, { backgroundColor: live ? colors.green : colors.textFaint }]} />
      </View>

      <View style={styles.gridWrap}>
        {!metrics && loading && <Text style={styles.empty}>Loading...</Text>}
        {!metrics && !loading && !!error && <Text style={styles.empty}>{error}</Text>}
        {metrics && shifts.length === 0 && <Text style={styles.empty}>No active shifts</Text>}
        <View style={styles.grid}>
          {shifts.map((s) => (
            <ShiftCard
              key={s.id}
              shift={s}
              width={cardWidth}
              // tap: the shift's Live / Declared transactions (live app) — roles whose website has no
              // transaction pages (e.g. MANAGER) stay on the dashboard
              onPress={() => { tap(); if (!canOpenRoute(user?.roleName, 'ShiftTransactions')) return; navigation.navigate('ShiftTransactions', { shiftId: s.id, shiftName: s.name, date: (s.rawOpenDate || s.openDate || '').slice(0, 10), declared: isDeclared(s) }); }}
            />
          ))}
        </View>
      </View>

    </ScrollView>
  );
}

const isDeclared = (s: DashboardShift) => s.declaredNumber !== null && s.declaredNumber !== undefined && s.declaredNumber !== '';

function ShiftCard({ shift, width, onPress, onLongPress }: { shift: DashboardShift; width: number; onPress: () => void; onLongPress?: () => void }) {
  const declared = isDeclared(shift);
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} style={({ pressed }) => [styles.card, { width }, pressed && { transform: [{ scale: 0.98 }] }]}>
      <Text style={styles.cardName} numberOfLines={1}>{shift.name}</Text>
      {declared ? (
        <View style={styles.cardBottom}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardDate} numberOfLines={1}>{dmy(shift.rawOpenDate || shift.openDate)}</Text>
            <Text style={styles.cardLabel}>Result</Text>
          </View>
          <View style={styles.resultCircle}>
            <Text style={styles.resultText}>{shift.declaredNumber}</Text>
          </View>
        </View>
      ) : (
        <View>
          <Text style={styles.saleLabel}>Sale</Text>
          <View style={styles.saleRow}>
            <Text style={styles.saleAmount} numberOfLines={1} adjustsFontSizeToFit>{amount(shift.totalAmount)}</Text>
            {num(shift.totalAmount) > 0 && (
              <View style={styles.pill}>
                <Text style={styles.pillText} numberOfLines={1}>{amount(shift.netAmount)}</Text>
              </View>
            )}
          </View>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    margin: 24,
    marginBottom: 12,
    backgroundColor: colors.navy,
    borderRadius: radius.md,
    paddingVertical: 22,
    paddingHorizontal: 22,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.navyBanner,
    ...shadow,
  },
  hi: { color: colors.white, fontSize: 28, fontWeight: '700', letterSpacing: -0.3 },
  role: { color: colors.white, fontSize: 19, fontWeight: '600', marginTop: 4 },
  avatar: { width: 66, height: 66, borderRadius: 33, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.navy, fontSize: 30, fontWeight: '800' },
  sectionRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 24, marginTop: 8, marginBottom: 12 },
  section: { fontSize: 20, fontWeight: '700', color: colors.text, letterSpacing: 0.6 },
  liveDot: { width: 8, height: 8, borderRadius: 4, marginLeft: 8 },
  gridWrap: { marginHorizontal: 24, backgroundColor: '#EEF0F3', borderRadius: radius.md, padding: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  empty: { textAlign: 'center', color: colors.textMuted, paddingVertical: 24 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 14,
    minHeight: 118,
    justifyContent: 'space-between',
    ...shadow,
  },
  cardName: { fontSize: 17, fontWeight: '500', color: colors.text, textTransform: 'uppercase' },
  cardBottom: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  cardDate: { fontSize: 15, color: colors.dateRed },
  cardLabel: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  resultCircle: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.coralSoft, alignItems: 'center', justifyContent: 'center' },
  resultText: { color: colors.white, fontSize: 26, fontWeight: '700' },
  saleLabel: { fontSize: 16, color: colors.peach, marginTop: 6 },
  saleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4, gap: 6 },
  saleAmount: { flex: 1, fontSize: 20, fontWeight: '500', color: colors.text },
  pill: { backgroundColor: colors.crimson, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1, borderColor: '#FBD5DA' },
  pillText: { color: colors.white, fontSize: 13, fontWeight: '600' },
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 20 },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  sheetTitle: { fontSize: 20, fontWeight: '700', color: colors.navy, textTransform: 'uppercase' },
  sheetRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.divider },
  sheetKey: { fontSize: 15, color: colors.textMuted },
  sheetVal: { fontSize: 15, fontWeight: '700', color: colors.text },
});

import React, { useEffect, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import type { StaffWorking } from '../api/types';
import { BackHeader } from '../components/BackHeader';
import { CenterMessage } from '../components/Controls';
import { ListRow } from '../components/ListRow';
import { subscribeDashboard, useDashboard } from '../store/dashboard';
import { colors, radius } from '../theme';
import { elapsed } from '../utils/format';

// STAFF WORKING (live app): every operator on duty — name, login (magenta), role (amber), the
// WORKING / IDLE badge and the time since their last activity ("0 0:0:12", ticking).
// Same list as the web Dashboard's Staff Working, from the live dashboard feed.
export function StaffWorkingScreen() {
  const { metrics, loading, refresh, error } = useDashboard();
  const [now, setNow] = useState(Date.now());

  useEffect(() => subscribeDashboard(), []);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const list = metrics?.staffWorking || [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <BackHeader title="Staff Working" />
      <FlatList
        data={list}
        keyExtractor={(s) => String(s.id)}
        extraData={now}
        refreshControl={<RefreshControl refreshing={loading && !!metrics} onRefresh={refresh} colors={[colors.navy]} />}
        ListEmptyComponent={<CenterMessage loading={!metrics && loading} text={error || 'No staff working right now'} />}
        contentContainerStyle={list.length === 0 ? { flexGrow: 1 } : undefined}
        renderItem={({ item, index }) => <StaffRow item={item} index={index + 1} now={now} />}
      />
    </View>
  );
}

function StaffRow({ item, index, now }: { item: StaffWorking; index: number; now: number }) {
  const working = item.status === 'WORKING';
  return (
    <ListRow
      index={index}
      title={item.fullName || item.code}
      tag={item.username || item.code}
      tagColor={colors.magenta}
      code={(item.role || item.designation || '').toUpperCase()}
      codeColor="#EAB308"
      rightNode={
        <View style={{ alignItems: 'center' }}>
          <View style={[styles.badge, !working && { backgroundColor: colors.textMuted }]}>
            <Text style={styles.badgeText}>{item.status}</Text>
          </View>
          <Text style={styles.timer}>{elapsed(item.timestamp, now)}</Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  badge: { backgroundColor: colors.navy, borderRadius: radius.sm, paddingHorizontal: 18, paddingVertical: 7, minWidth: 116, alignItems: 'center' },
  badgeText: { color: colors.white, fontSize: 17, fontWeight: '600', letterSpacing: 0.3 },
  timer: { fontSize: 13, color: colors.textMuted, marginTop: 6 },
});

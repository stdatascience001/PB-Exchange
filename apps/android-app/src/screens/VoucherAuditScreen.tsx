import React, { useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { apiRequest, errorMessage } from '../api/client';
import type { ManualVoucher } from '../api/types';
import { BackHeader } from '../components/BackHeader';
import { CenterMessage, DateField, FindButton, SelectField } from '../components/Controls';
import { AUDIT_FILTERS } from '../constants';
import { useApiList } from '../hooks/useApiList';
import { colors, radius } from '../theme';
import { amount, dmyTime, isoDate } from '../utils/format';
import { failure, success, tap } from '../utils/haptics';

// Voucher Audit / Verify — the manual vouchers (Journal, Limit, Kist, Vapsi, Hawa Patti) of a date
// range by audit status, each ALLOWED / CANCELED from here (PATCH /vouchers/:id/audit), as the web page.
export function VoucherAuditScreen() {
  const today = isoDate(new Date());
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [status, setStatus] = useState('FOR_AUDIT');
  const [query, setQuery] = useState({ from: today, to: today, status: 'FOR_AUDIT' });
  const [busyId, setBusyId] = useState<number | null>(null);

  const path = `/vouchers/manual?fromDate=${query.from}&toDate=${query.to}&auditStatus=${query.status}&manualOnly=1`;
  const vouchers = useApiList<ManualVoucher>(path);

  const act = (v: ManualVoucher, next: 'ALLOWED' | 'CANCELED') => {
    tap();
    Alert.alert(next === 'ALLOWED' ? 'Allow voucher' : 'Cancel voucher', `${v.voucherNumber} · ${v.partyName} · ${amount(v.totalAmount)}`, [
      { text: 'No', style: 'cancel' },
      {
        text: 'Yes',
        onPress: async () => {
          setBusyId(v.id);
          try {
            await apiRequest(`/vouchers/${v.id}/audit`, { method: 'PATCH', body: { auditStatus: next } });
            success();
            void vouchers.reload();
          } catch (err) {
            failure();
            Alert.alert('Message', errorMessage(err, 'Failed to update audit status'));
          } finally {
            setBusyId(null);
          }
        },
      },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <BackHeader title="Voucher Audit" />
      <View style={styles.filters}>
        <DateField value={from} onChange={setFrom} />
        <DateField value={to} onChange={setTo} />
      </View>
      <View style={styles.filters}>
        <SelectField title="Status" value={status} onChange={setStatus} placeholder="FOR AUDIT" options={AUDIT_FILTERS} />
        <FindButton
          loading={vouchers.loading}
          onPress={() => {
            if (from > to) { Alert.alert('Message', 'From date cannot be after To date'); return; }
            setQuery({ from, to, status });
          }}
        />
      </View>
      <View style={[styles.sep, { marginTop: 10 }]} />
      <FlatList
        data={vouchers.data}
        keyExtractor={(v) => String(v.id)}
        refreshControl={<RefreshControl refreshing={vouchers.refreshing} onRefresh={vouchers.refresh} colors={[colors.navy]} />}
        ListEmptyComponent={<CenterMessage loading={vouchers.loading} text={vouchers.error || 'No vouchers for this range'} />}
        contentContainerStyle={vouchers.data.length === 0 ? { flexGrow: 1 } : undefined}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardTop}>
              <Text style={styles.party} numberOfLines={1}>{item.partyName}</Text>
              <Text style={styles.amount}>{amount(item.totalAmount)}</Text>
            </View>
            <Text style={styles.meta} numberOfLines={1}>
              {item.voucherNumber} · {item.entrySide === 'CR' ? 'Cr' : 'Dr'} · {item.oppositePartyName}
            </Text>
            <Text style={styles.meta}>{item.createdByUsername || item.updatedBy} · {dmyTime(item.addedAt || item.createdAt)}</Text>
            {!!item.narration && <Text style={styles.meta} numberOfLines={2}>{item.narration}</Text>}
            <View style={styles.actions}>
              <Text style={[styles.status, item.auditStatus === 'ALLOWED' ? { color: colors.green } : item.auditStatus === 'CANCELED' ? { color: colors.crimson } : null]}>
                {item.auditStatus || 'FOR AUDIT'}
              </Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <ActionButton label="ALLOW" color={colors.green} disabled={busyId === item.id || item.auditStatus === 'ALLOWED'} onPress={() => act(item, 'ALLOWED')} />
                <ActionButton label="CANCEL" color={colors.crimson} disabled={busyId === item.id || item.auditStatus === 'CANCELED'} onPress={() => act(item, 'CANCELED')} />
              </View>
            </View>
          </View>
        )}
      />
    </View>
  );
}

function ActionButton({ label, color, disabled, onPress }: { label: string; color: string; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.btn, { backgroundColor: color }, (disabled || pressed) && { opacity: 0.5 }]}>
      <Text style={styles.btnText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', gap: 8, paddingHorizontal: 10, paddingTop: 10 },
  sep: { height: 1, backgroundColor: colors.border },
  card: { backgroundColor: colors.surface, marginHorizontal: 12, marginTop: 10, borderRadius: radius.md, padding: 14, borderWidth: 1, borderColor: colors.border },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  party: { flex: 1, fontSize: 17, fontWeight: '700', color: colors.text, textTransform: 'uppercase' },
  amount: { fontSize: 18, fontWeight: '700', color: colors.navy },
  meta: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
  actions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  status: { fontSize: 13, fontWeight: '700', color: colors.amberDark },
  btn: { borderRadius: radius.sm, paddingHorizontal: 14, paddingVertical: 8 },
  btnText: { color: colors.white, fontWeight: '700', fontSize: 13 },
});

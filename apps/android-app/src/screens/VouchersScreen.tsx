import { MaterialIcons } from '@expo/vector-icons';
import { RouteProp, useRoute } from '@react-navigation/native';
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiRequest, errorMessage } from '../api/client';
import type { Ledger, ManualVoucher } from '../api/types';
import { BackHeader } from '../components/BackHeader';
import { BottomActionBar, CenterMessage, DateField, FieldLabel, FindButton, FormField, PrimaryButton, SearchBox, SelectField } from '../components/Controls';
import { useApiList } from '../hooks/useApiList';
import type { RootStackParamList } from '../navigation/types';
import { colors } from '../theme';
import { amount, dmy, isoDate } from '../utils/format';
import { failure, success, tap } from '../utils/haptics';

// PAYMENT VOUCHER (Journal) / LIMIT VOUCHER (live app): From – To dates + FIND, "SEARCH PARTY..",
// the vouchers of the range (GET /vouchers/manual), and ADD VOUCHER (POST /vouchers) with the
// same fields as the web form: date, party, Dr / Cr, opposite party, amount, remark.
export function VouchersScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'Vouchers'>>();
  const type = route.params?.type === 'LIMIT' ? 'LIMIT' : 'JOURNAL';
  const today = isoDate(new Date());
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [query, setQuery] = useState({ from: today, to: today });
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [info, setInfo] = useState<ManualVoucher | null>(null);

  const path = `/vouchers/manual?voucherType=${type}&fromDate=${query.from}&toDate=${query.to}`;
  const vouchers = useApiList<ManualVoucher>(path);

  const list = useMemo(() => {
    const t = search.trim().toUpperCase();
    return t ? vouchers.data.filter((v) => v.partyName.toUpperCase().includes(t) || (v.oppositePartyName || '').toUpperCase().includes(t)) : vouchers.data;
  }, [vouchers.data, search]);

  const title = type === 'LIMIT' ? 'Limit Voucher' : 'Payment Voucher';

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <BackHeader title={title} />
      <View style={styles.filters}>
        <DateField value={from} onChange={setFrom} />
        <DateField value={to} onChange={setTo} />
        <FindButton
          loading={vouchers.loading}
          onPress={() => {
            if (from > to) { Alert.alert('Message', 'From date cannot be after To date'); return; }
            if (from === query.from && to === query.to) void vouchers.reload();
            else setQuery({ from, to });
          }}
        />
      </View>
      <SearchBox value={search} onChangeText={setSearch} placeholder="SEARCH PARTY.." />
      <View style={styles.sep} />
      <FlatList
        data={list}
        keyExtractor={(v) => String(v.id)}
        refreshControl={<RefreshControl refreshing={vouchers.refreshing} onRefresh={vouchers.refresh} colors={[colors.navy]} />}
        ListEmptyComponent={vouchers.loading ? <CenterMessage loading /> : vouchers.error ? <CenterMessage text={vouchers.error} /> : null}
        contentContainerStyle={list.length === 0 ? { flexGrow: 1 } : undefined}
        renderItem={({ item, index }) => (
          // live row: party, the other party (cyan), who added it and when; amount Cr / Dr and the
          // voucher date (amber). Tap -> Voucher Info (remarks, Delete Voucher)
          <Pressable onPress={() => { tap(); setInfo(item); }} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.canvas }]}>
            <Text style={styles.index}>{index + 1}.</Text>
            <View style={{ flex: 1, paddingRight: 8 }}>
              <Text style={styles.party} numberOfLines={1}>{item.partyName}</Text>
              <View style={styles.line} />
              <Text style={styles.opposite} numberOfLines={1}>{item.oppositePartyName || ''}</Text>
              <View style={styles.line} />
              <View style={styles.byRow}>
                <Text style={styles.by} numberOfLines={1}>{item.createdByUsername || item.updatedBy || ''}</Text>
                <Text style={styles.by} numberOfLines={1}>{stamp(item.addedAt || item.createdAt)}</Text>
              </View>
            </View>
            <View style={styles.rightCol}>
              <Text style={styles.amt} numberOfLines={1} adjustsFontSizeToFit>{amount(item.totalAmount)} {item.entrySide === 'CR' ? 'Cr' : 'Dr'}</Text>
              <Text style={styles.vdate}>{dmy(item.createdAt)}</Text>
            </View>
          </Pressable>
        )}
      />
      <BottomActionBar title="ADD VOUCHER" subtitle="CLICK HERE TO ADD NEW VOUCHER" onPress={() => setAdding(true)} />
      <VoucherInfoModal voucher={info} onClose={() => setInfo(null)} onDeleted={() => { setInfo(null); void vouchers.reload(); }} />
      <AddVoucherModal type={type} visible={adding} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); void vouchers.reload(); }} />
    </View>
  );
}

// stored wall-clock time as live prints it: "2026-10-26 13:00:19"
const stamp = (v?: string | null) => {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d.getTime())) return v.slice(0, 19).replace('T', ' ');
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

// Voucher Info (live): pale-yellow popup — the voucher's remarks, Delete Voucher (DELETE
// /vouchers/:id, the web Journal / Limit page's delete, after a confirm), CLOSE
function VoucherInfoModal({ voucher, onClose, onDeleted }: { voucher: ManualVoucher | null; onClose: () => void; onDeleted: () => void }) {
  const [deleting, setDeleting] = useState(false);
  if (!voucher) return null;
  const remove = () => {
    tap();
    Alert.alert('Delete Voucher', 'Are you sure you want to delete this voucher?', [
      { text: 'No', style: 'cancel' },
      {
        text: 'Yes',
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          try {
            await apiRequest(`/vouchers/${voucher.id}`, { method: 'DELETE' });
            success();
            Alert.alert('Message', 'Voucher has been deleted successfully!');
            onDeleted();
          } catch (err) {
            failure();
            Alert.alert('Message', errorMessage(err, 'Failed to delete voucher'));
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
  };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.infoBackdrop}>
        <View style={styles.info}>
          <View style={styles.infoHead}><Text style={styles.infoTitle}>Voucher Info</Text></View>
          <View style={styles.infoBody}>
            <Text style={styles.infoLabel}>Remarks</Text>
            <View style={styles.infoRemark}><Text style={styles.infoRemarkText}>{voucher.narration || ''}</Text></View>
          </View>
          <Pressable disabled={deleting} onPress={remove} style={({ pressed }) => [styles.infoDelete, (pressed || deleting) && { opacity: 0.85 }]}>
            {deleting ? <ActivityIndicator color={colors.white} /> : <Text style={styles.infoDeleteText}>Delete Voucher</Text>}
          </Pressable>
          <View style={{ height: 230 }} />
          <Pressable onPress={() => { tap(); onClose(); }} style={styles.infoClose}><Text style={styles.infoCloseText}>CLOSE</Text></Pressable>
        </View>
      </View>
    </Modal>
  );
}

function AddVoucherModal({ type, visible, onClose, onSaved }: { type: 'JOURNAL' | 'LIMIT'; visible: boolean; onClose: () => void; onSaved: () => void }) {
  const insets = useSafeAreaInsets();
  const ledgers = useApiList<Ledger>(visible ? '/ledgers' : null);
  const [date, setDate] = useState(isoDate(new Date()));
  const [partyId, setPartyId] = useState('');
  const [side, setSide] = useState<'DR' | 'CR'>('CR');
  const [oppositeId, setOppositeId] = useState('');
  const [amt, setAmt] = useState('');
  const [remark, setRemark] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = useMemo(
    () => ledgers.data.map((l) => ({ value: String(l.id), label: l.partyName })).sort((a, b) => a.label.localeCompare(b.label)),
    [ledgers.data],
  );

  const reset = () => { setPartyId(''); setOppositeId(''); setAmt(''); setRemark(''); setSide('CR'); setError(null); };
  const close = () => { reset(); onClose(); };

  const save = async () => {
    setError(null);
    const value = parseFloat(amt);
    if (!partyId) { setError('Please select Party from the list!'); failure(); return; }
    if (!oppositeId) { setError('Please select Opposite Party from the list!'); failure(); return; }
    if (partyId === oppositeId) { setError('Party and Opposite Party must be different!'); failure(); return; }
    if (!(value > 0)) { setError('Please enter Amount!'); failure(); return; }
    setSaving(true);
    try {
      await apiRequest('/vouchers', {
        method: 'POST',
        body: {
          voucherType: type,
          voucherDate: date,
          partyLedgerId: Number(partyId),
          entrySide: side,
          oppositeLedgerId: Number(oppositeId),
          amount: value,
          narration: remark.trim() || undefined,
        },
      });
      success();
      Alert.alert('Message', `${type === 'LIMIT' ? 'Limit Voucher' : 'Journal Voucher'} has been saved successfully!`);
      reset();
      onSaved();
    } catch (err) {
      failure();
      setError(errorMessage(err, 'Failed to save voucher'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>Add {type === 'LIMIT' ? 'Limit' : 'Payment'} Voucher</Text>
            <Pressable hitSlop={12} onPress={close}><MaterialIcons name="close" size={24} color={colors.text} /></Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled">
            {!!error && <Text style={styles.error}>{error}</Text>}
            <FieldLabel>Date</FieldLabel>
            <View style={styles.selectRow}><DateField value={date} onChange={setDate} /></View>
            <FieldLabel>Party</FieldLabel>
            <View style={styles.selectRow}>
              <SelectField title="Party" value={partyId} onChange={setPartyId} placeholder={ledgers.loading ? 'LOADING...' : 'SELECT PARTY'} options={options} />
            </View>
            <FieldLabel>Dr / Cr</FieldLabel>
            <View style={styles.selectRow}>
              <SelectField title="Dr / Cr" value={side} onChange={(v) => setSide(v === 'DR' ? 'DR' : 'CR')} placeholder="CR" options={[{ value: 'CR', label: 'CR' }, { value: 'DR', label: 'DR' }]} />
            </View>
            <FieldLabel>Opposite Party</FieldLabel>
            <View style={styles.selectRow}>
              <SelectField title="Opposite Party" value={oppositeId} onChange={setOppositeId} placeholder="SELECT OPPOSITE PARTY" options={options} />
            </View>
            <FormField label="Amount" value={amt} onChangeText={setAmt} keyboardType="decimal-pad" placeholder="0" />
            <FormField label="Remark" value={remark} onChangeText={setRemark} placeholder="REMARK" />
            <PrimaryButton label="SAVE VOUCHER" onPress={save} loading={saving} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceMuted, borderBottomWidth: 1.5, borderBottomColor: '#E2E8F0', paddingVertical: 12, paddingHorizontal: 12 },
  index: { width: 44, fontSize: 19, color: colors.text },
  party: { fontSize: 16, fontWeight: '600', color: colors.text, textTransform: 'uppercase' },
  line: { height: 1, backgroundColor: colors.divider, marginVertical: 4 },
  opposite: { fontSize: 15, fontWeight: '600', color: '#29A3D8', textTransform: 'uppercase' },
  byRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  by: { fontSize: 13, color: '#555' },
  rightCol: { width: 112, alignItems: 'flex-end', borderLeftWidth: 1, borderLeftColor: colors.divider, alignSelf: 'stretch', justifyContent: 'center' },
  amt: { fontSize: 17, fontWeight: '700', color: colors.navy },
  vdate: { fontSize: 13, fontWeight: '600', color: '#E8961E', marginTop: 6 },
  infoBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  info: { width: '84%', maxWidth: 380, backgroundColor: '#FBFAD9', overflow: 'hidden' },
  infoHead: { backgroundColor: colors.navy, paddingVertical: 20, alignItems: 'center', borderTopWidth: 6, borderTopColor: colors.navyDark },
  infoTitle: { color: colors.white, fontSize: 18, fontWeight: '500' },
  infoBody: { paddingHorizontal: 12, paddingTop: 14, paddingBottom: 10 },
  infoLabel: { fontSize: 16, color: '#666', marginBottom: 6 },
  infoRemark: { backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.border, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 12, minHeight: 46 },
  infoRemarkText: { fontSize: 16, color: '#555', textTransform: 'uppercase' },
  infoDelete: { backgroundColor: colors.navy, borderRadius: 4, paddingVertical: 14, alignItems: 'center', marginRight: 10 },
  infoDeleteText: { color: colors.white, fontSize: 17, fontWeight: '500' },
  infoClose: { backgroundColor: colors.navyDark, paddingVertical: 18, alignItems: 'center' },
  infoCloseText: { color: colors.white, fontSize: 17, fontWeight: '500' },
  filters: { flexDirection: 'row', gap: 8, paddingHorizontal: 10, paddingTop: 12 },
  sep: { height: 1, backgroundColor: colors.border },
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 20, maxHeight: '90%' },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  sheetTitle: { fontSize: 20, fontWeight: '700', color: colors.navy },
  error: { color: colors.crimson, fontWeight: '600', marginBottom: 12 },
  selectRow: { flexDirection: 'row', marginBottom: 14 },
});

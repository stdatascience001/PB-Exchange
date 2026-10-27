import { MaterialIcons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiRequest, errorMessage } from '../api/client';
import type { Shift } from '../api/types';
import { BackHeader } from '../components/BackHeader';
import { CenterMessage, DateField, FindButton, PrimaryButton, SelectField } from '../components/Controls';
import { useApiList } from '../hooks/useApiList';
import { isSuperUser, useAuth } from '../store/auth';
import { subscribeDashboard, useDashboard } from '../store/dashboard';
import { colors, radius, shadow } from '../theme';
import { dmy, isoDate, num } from '../utils/format';
import { failure, success, tap } from '../utils/haptics';

// PREDICTION (live app) — three tabs:
//   TODAY PREDICTION  the chosen shift's live cycle
//   OLD PREDICTION    any shift + date; a declared cycle gets the "66 | RE-DECLARE & UN-DECLARE" bar
//   DECLARE NEEDED    the Dashboard's Declare Needed list (RE-DECLARE / DECLARE)
// Per number (sorted by profit if it wins, best first):
//   SALE   = stake that wins on it (number + its Andar / Bahar haruf)   — /jantri/:id/prediction
//   NET    = the same stake after each party's Commission / Hissa         — /jantri/:id/net
//   %      = profit if it wins ÷ the cycle's net collection × 100
//   RESULT COUNT = times it was the declared result in the shift's last 30 declarations
//   PROFIT / LOSS = book result if it wins
// The strip on top: the shift's last 8 results with their dates. Same APIs as the web pages.

interface PredictionNumber { number: string; sale: number; liability: number; profitLoss: number }
interface PredictionData { shiftId: number; shiftName: string; shiftDate: string; totalCollected: number; netCollected: number; numberPreview: PredictionNumber[]; isCycleDeclared?: boolean }
interface NetJantri { grid: Array<{ number: string; totalAmount: number }>; haruf: Array<{ digit: string; andarAmount: number; baharAmount: number }> }
interface Declaration { id: number; shiftId: number; winningNumber: string; declaredAt: string }

type Tab = 'TODAY' | 'OLD' | 'NEEDED';

const showNumber = (n: string) => (n === '00' ? '100' : String(parseInt(n, 10)));
const pad2 = (n: string) => n.trim().padStart(2, '0').slice(-2);
const localDate = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? iso.slice(0, 10) : isoDate(d); };
const ddmm = (iso: string) => { const [, m, d] = localDate(iso).split('-'); return `${d}-${m}`; };

export function PredictionScreen() {
  const [tab, setTab] = useState<Tab>('TODAY');
  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <BackHeader title="Prediction" />
      <View style={styles.tabs}>
        {([['TODAY', 'TODAY PREDICTION'], ['OLD', 'OLD PREDICTION'], ['NEEDED', 'DECLARE NEEDED']] as Array<[Tab, string]>).map(([key, label]) => (
          <Pressable key={key} onPress={() => { tap(); setTab(key); }} style={styles.tab}>
            <Text style={styles.tabText} numberOfLines={1} adjustsFontSizeToFit>{label}</Text>
            <View style={[styles.tabLine, tab === key && styles.tabLineOn]} />
          </Pressable>
        ))}
      </View>
      {tab === 'NEEDED' ? <DeclareNeeded /> : <PredictionTab key={tab} mode={tab} />}
    </View>
  );
}

// ---- Today / Old prediction ------------------------------------------------------------------
function PredictionTab({ mode }: { mode: 'TODAY' | 'OLD' }) {
  const user = useAuth((s) => s.user);
  const shifts = useApiList<Shift>('/shifts');
  const active = useMemo(() => shifts.data.filter((s) => s.isActive !== false), [shifts.data]);

  const [shiftId, setShiftId] = useState('');
  const [date, setDate] = useState(isoDate(new Date()));
  const [data, setData] = useState<PredictionData | null>(null);
  const [net, setNet] = useState<NetJantri | null>(null);
  const [history, setHistory] = useState<Declaration[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadedFor, setLoadedFor] = useState<{ shiftId: string; date: string } | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);

  const shift = active.find((s) => String(s.id) === shiftId);
  // Today: the shift's own live cycle date (an undeclared shift keeps its date past midnight)
  const effectiveDate = mode === 'TODAY' ? (shift?.openDate || isoDate(new Date())) : date;

  // Default shift: Today -> the first still-open one; Old -> the first active one
  useEffect(() => {
    if (shiftId || !active.length) return;
    const pick = mode === 'TODAY' ? (active.find((s) => !s.declaredNumber && s.status === 'OPEN') || active[0]) : active[0];
    setShiftId(String(pick.id));
  }, [active, shiftId, mode]);

  const load = useCallback(async (id: string, d: string, announce = false) => {
    if (!id) return;
    setLoading(true);
    try {
      const [pred, netRes, hist] = await Promise.all([
        apiRequest<PredictionData>(`/jantri/${id}/prediction?date=${d}`),
        apiRequest<NetJantri>(`/jantri/${id}/net?date=${d}&gate=none`).catch(() => ({ data: undefined })),
        apiRequest<Declaration[]>(`/declarations/summary?shiftId=${id}`).catch(() => ({ data: [] as Declaration[] })),
      ]);
      setData(pred.data || null);
      setNet(netRes.data || null);
      setHistory((hist.data || []).slice(0, 30));
      setLoadedFor({ shiftId: id, date: d });
      if (announce && (!pred.data || num(pred.data.totalCollected) === 0)) {
        Alert.alert('Error', 'Record not avaliable!');
      }
    } catch (err) {
      failure();
      Alert.alert('Error', errorMessage(err, 'Failed to load prediction'));
    } finally {
      setLoading(false);
    }
  }, []);

  // first load once the default shift is known
  useEffect(() => {
    if (shiftId && !loadedFor) void load(shiftId, effectiveDate);
  }, [shiftId, loadedFor, load, effectiveDate]);

  const winCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const h of history) { const k = pad2(h.winningNumber); m.set(k, (m.get(k) || 0) + 1); }
    return m;
  }, [history]);

  const netByNumber = useMemo(() => {
    const m = new Map<string, number>();
    if (!net) return m;
    const andar = new Map(net.haruf.map((h) => [h.digit, num(h.andarAmount)]));
    const bahar = new Map(net.haruf.map((h) => [h.digit, num(h.baharAmount)]));
    for (const c of net.grid) {
      m.set(c.number, num(c.totalAmount) + (andar.get(c.number[0]) || 0) + (bahar.get(c.number[1]) || 0));
    }
    return m;
  }, [net]);

  const rows = useMemo(() => {
    const list = [...(data?.numberPreview || [])];
    list.sort((a, b) => (b.profitLoss - a.profitLoss) || a.number.localeCompare(b.number));
    return list;
  }, [data]);

  // strip: the last 8 results, oldest on the left
  const strip = useMemo(() => history.slice(0, 8).reverse(), [history]);

  // OLD: the cycle on screen is the shift's current, declared one -> Re-Declare / Un-Declare
  // (declaring writes the live shift row, so only its current cycle — as the web page)
  const currentDeclaration = useMemo(() => {
    if (mode !== 'OLD' || !shift || !loadedFor || loadedFor.shiftId !== String(shift.id)) return null;
    if (!shift.declaredNumber || loadedFor.date !== shift.openDate) return null;
    return history.find((h) => localDate(h.declaredAt) >= shift.openDate) || history[0] || null;
  }, [mode, shift, loadedFor, history]);
  const canChangeResult = isSuperUser(user?.roleName);

  const totalNet = num(data?.netCollected);

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.filters}>
        {mode === 'OLD'
          ? <DateField value={date} onChange={setDate} />
          : <View style={styles.datePill}><Text style={styles.datePillText}>{dmy(effectiveDate)}</Text></View>}
        <SelectField title="Shift" value={shiftId} onChange={setShiftId} placeholder="SHIFT" options={active.map((s) => ({ value: String(s.id), label: s.name }))} />
        <FindButton loading={loading} onPress={() => { if (!shiftId) { Alert.alert('Message', 'Please choose a valid shift!'); return; } void load(shiftId, effectiveDate, true); }} />
      </View>

      <View style={styles.strip}>
        {strip.length === 0 && <Text style={styles.stripEmpty}>{loadedFor ? 'No results yet' : ''}</Text>}
        {strip.map((h) => (
          <View key={h.id} style={styles.stripItem}>
            <View style={styles.stripBox}><Text style={styles.stripNum} numberOfLines={1} adjustsFontSizeToFit>{showNumber(pad2(h.winningNumber))}</Text></View>
            <Text style={styles.stripDate}>{ddmm(h.declaredAt)}</Text>
          </View>
        ))}
      </View>

      <FlatList
        data={rows}
        keyExtractor={(r) => r.number}
        initialNumToRender={12}
        windowSize={9}
        ListEmptyComponent={<CenterMessage loading={loading || shifts.loading} text={loadedFor ? 'Record not avaliable!' : 'Choose a shift, then FIND'} />}
        contentContainerStyle={{ paddingBottom: currentDeclaration ? 110 : 16, flexGrow: rows.length ? undefined : 1 }}
        renderItem={({ item, index }) => {
          const count = winCount.get(item.number) || 0;
          const pct = totalNet ? Math.round((item.profitLoss / totalNet) * 100) : 0;
          const profit = item.profitLoss > 0;
          return (
            <View style={styles.row}>
              <Text style={styles.index}>{index + 1}.</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.number}>{showNumber(item.number)}</Text>
                <View style={styles.figs}>
                  <Text style={styles.fig} numberOfLines={1}>SALE | {Math.round(num(item.sale))}</Text>
                  <Text style={styles.fig} numberOfLines={1}>NET | {Math.round(netByNumber.get(item.number) || 0)}</Text>
                  <Text style={styles.fig} numberOfLines={1}>% | {pct}</Text>
                </View>
              </View>
              <View style={styles.countCol}>
                <View style={[styles.countBadge, count > 0 ? styles.countOn : styles.countOff]}>
                  <Text style={styles.countText}>{count}</Text>
                </View>
                <Text style={styles.countLabel}>RESULT COUNT</Text>
                <Text style={styles.countSub}>IN LAST 30 DAYS</Text>
              </View>
              <View style={styles.plCol}>
                <Text style={[styles.plValue, { color: profit ? '#3FA34D' : colors.crimson }]} numberOfLines={1} adjustsFontSizeToFit>
                  {Math.abs(Math.round(item.profitLoss))}
                </Text>
                <Text style={[styles.plLabel, { color: profit ? '#3FA34D' : colors.crimson }]}>{profit ? 'PROFIT' : 'LOSS'}</Text>
              </View>
            </View>
          );
        }}
      />

      {currentDeclaration && canChangeResult && (
        <Pressable onPress={() => { tap(); setActionsOpen(true); }} style={({ pressed }) => [styles.floatBar, pressed && { opacity: 0.85 }]}>
          <Text style={styles.floatNum}>{showNumber(pad2(currentDeclaration.winningNumber))}</Text>
          <View style={styles.floatSep} />
          <Text style={styles.floatText}>RE-DECLARE & UN-DECLARE</Text>
        </Pressable>
      )}

      {currentDeclaration && shift && (
        <ResultActionsModal
          visible={actionsOpen}
          shift={shift}
          declaration={currentDeclaration}
          onClose={() => setActionsOpen(false)}
          onDone={() => { setActionsOpen(false); void shifts.reload(); void load(String(shift.id), effectiveDate); }}
        />
      )}
    </View>
  );
}

// Re-Declare (reverse + declare the corrected number) / Un-Declare (reverse) — the web Live
// Prediction actions: POST /declarations/:shiftId/reverse { declarationId } and POST /declarations/:shiftId
function ResultActionsModal({ visible, shift, declaration, onClose, onDone }: {
  visible: boolean; shift: Shift; declaration: Declaration; onClose: () => void; onDone: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState<'re' | 'un' | null>(null);

  const valid = (raw: string) => /^\d{1,2}$/.test(raw.trim()) ? pad2(raw) : null;

  const reDeclare = () => {
    const padded = valid(value);
    if (!padded) { failure(); Alert.alert('Message', 'Enter a valid winning number between 00 and 99.'); return; }
    Alert.alert('Re-Declare', `Replace declared number ${declaration.winningNumber} with ${padded} for ${shift.name}?`, [
      { text: 'No', style: 'cancel' },
      {
        text: 'Yes',
        onPress: async () => {
          setBusy('re');
          try {
            await apiRequest(`/declarations/${shift.id}/reverse`, { method: 'POST', body: { declarationId: declaration.id } });
            await apiRequest(`/declarations/${shift.id}`, { method: 'POST', body: { winningNumber: padded } });
            success();
            Alert.alert('Message', 'Result re-declared successfully.');
            setValue('');
            onDone();
          } catch (err) {
            failure();
            Alert.alert('Message', errorMessage(err, 'Failed to re-declare result'));
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  };

  const unDeclare = () => {
    Alert.alert('Un-Declare', `Undo the declared result ${declaration.winningNumber} for ${shift.name}?`, [
      { text: 'No', style: 'cancel' },
      {
        text: 'Yes',
        style: 'destructive',
        onPress: async () => {
          setBusy('un');
          try {
            await apiRequest(`/declarations/${shift.id}/reverse`, { method: 'POST', body: { declarationId: declaration.id } });
            success();
            Alert.alert('Message', 'Result un-declared successfully.');
            onDone();
          } catch (err) {
            failure();
            Alert.alert('Message', errorMessage(err, 'Failed to reverse declaration'));
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>{shift.name} | {dmy(shift.openDate)}</Text>
            <Pressable hitSlop={12} onPress={onClose}><MaterialIcons name="close" size={24} color={colors.text} /></Pressable>
          </View>
          <Text style={styles.sheetLabel}>DECLARED RESULT</Text>
          <Text style={styles.sheetResult}>{showNumber(pad2(declaration.winningNumber))}</Text>
          <Text style={styles.sheetLabel}>CORRECTED NUMBER</Text>
          <TextInput value={value} onChangeText={setValue} keyboardType="number-pad" maxLength={2} placeholder="00 - 99" placeholderTextColor={colors.textFaint} style={styles.input} />
          <PrimaryButton label="RE-DECLARE" onPress={reDeclare} loading={busy === 're'} disabled={!!busy} />
          <Pressable disabled={!!busy} onPress={unDeclare} style={({ pressed }) => [styles.unBtn, (pressed || !!busy) && { opacity: 0.7 }]}>
            {busy === 'un' ? <ActivityIndicator color={colors.white} /> : <Text style={styles.unText}>UN-DECLARE</Text>}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ---- Declare Needed --------------------------------------------------------------------------
// As the web Dashboard and the live app: the declared cycles whose slips changed after the
// declare, each with RE-DECLARE (DECLARE INFO summary, then re-settle the same number on the
// current data: /declarations/redeclare/:id)
interface NeededRow { id: number; name: string; openDate: string; rawOpenDate?: string; status: string; isDeclared?: boolean; declarationId?: number; changeCount?: number }

function DeclareNeeded() {
  const user = useAuth((s) => s.user);
  const { metrics, loading, refresh } = useDashboard();
  const [redeclare, setRedeclare] = useState<NeededRow | null>(null);
  useEffect(() => subscribeDashboard(), []);

  const role = String(user?.roleName || '').toUpperCase().replace(/_/g, ' ');
  const canDeclare = role === 'DEVELOPER' || role === 'SUPER ADMIN' || role === 'ADMIN';
  const rows = ((metrics?.declareNeeded || []) as NeededRow[]).filter((d) => d.isDeclared && d.declarationId);

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={rows}
        keyExtractor={(r) => `re-${r.declarationId}`}
        onRefresh={refresh}
        refreshing={loading && !!metrics}
        ListEmptyComponent={<CenterMessage loading={!metrics && loading} text="No shifts pending declaration" />}
        contentContainerStyle={rows.length === 0 ? { flexGrow: 1 } : undefined}
        renderItem={({ item, index }) => (
            <View style={styles.neededRow}>
              <Text style={styles.index}>{index + 1}.</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.neededName} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.neededDate}>{dmy(item.rawOpenDate || item.openDate)}</Text>
              </View>
              {canDeclare && (
                <Pressable
                  onPress={() => { tap(); setRedeclare(item); }}
                  style={({ pressed }) => [styles.neededBtn, pressed && { opacity: 0.8 }]}
                >
                  <Text style={styles.neededBtnText}>RE-DECLARE</Text>
                </Pressable>
              )}
            </View>
        )}
      />
      <RedeclareModal row={redeclare} onClose={() => setRedeclare(null)} onDone={() => { setRedeclare(null); void refresh(); }} />
    </View>
  );
}

interface RedeclareInfo {
  declarationId: number; shiftName: string; displayDate: string; winningNumber: string;
  summary: { declare: { sale: number; pl: number }; reDeclare: { sale: number; pl: number }; difference: { sale: number; pl: number } };
  rows: Array<{ partyId: number; partyName: string; sale: number; reSale: number; diffSale: number; pl: number; rePl: number; diffPl: number }>;
}

function RedeclareModal({ row, onClose, onDone }: { row: NeededRow | null; onClose: () => void; onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const [info, setInfo] = useState<RedeclareInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!row?.declarationId) { setInfo(null); return; }
    let alive = true;
    setLoading(true);
    apiRequest<RedeclareInfo>(`/declarations/redeclare/${row.declarationId}`)
      .then((res) => { if (alive) setInfo(res.data || null); })
      .catch((err) => { if (alive) Alert.alert('Message', errorMessage(err, 'Failed to load declare info')); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [row?.declarationId]);

  const save = async () => {
    if (!info) return;
    setSaving(true);
    try {
      await apiRequest(`/declarations/redeclare/${info.declarationId}`, { method: 'POST' });
      success();
      Alert.alert('Message', `${info.shiftName} | ${info.displayDate} re-declared successfully`);
      onDone();
    } catch (err) {
      failure();
      Alert.alert('Message', errorMessage(err, 'Re-declare failed'));
    } finally {
      setSaving(false);
    }
  };

  const block = (label: string, v?: { sale: number; pl: number }) => (
    <View style={styles.sumRow}>
      <Text style={styles.sumLabel}>{label}</Text>
      <Text style={styles.sumVal}>{Math.round(num(v?.sale))}</Text>
      <Text style={[styles.sumVal, { fontWeight: '800' }]}>{Math.round(num(v?.pl))}</Text>
    </View>
  );

  return (
    <Modal visible={!!row} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16, maxHeight: '88%' }]}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle} numberOfLines={1}>DECLARE INFO{info ? ` | ${info.shiftName} | ${info.displayDate}` : ''}</Text>
            <Pressable hitSlop={12} onPress={onClose}><MaterialIcons name="close" size={24} color={colors.text} /></Pressable>
          </View>
          {loading || !info ? <CenterMessage loading={loading} text="No data" /> : (
            <ScrollView>
              <View style={styles.sumHead}>
                <Text style={styles.sumLabel}>SUMMARY</Text><Text style={styles.sumHeadText}>SALE</Text><Text style={styles.sumHeadText}>P&L</Text>
              </View>
              {block('Declare', info.summary.declare)}
              {block('Re-Declare', info.summary.reDeclare)}
              {block('Diffrance', info.summary.difference)}
              <PrimaryButton label={`RE-DECLARE (${row?.changeCount ?? 0})`} onPress={save} loading={saving} style={{ marginVertical: 14 }} />
              {info.rows.map((r) => (
                <View key={r.partyId} style={styles.partyRow}>
                  <Text style={styles.partyName} numberOfLines={1}>{r.partyName}</Text>
                  <Text style={styles.partyMeta}>SALE {Math.round(r.sale)} → {Math.round(r.reSale)} ({Math.round(r.diffSale)})</Text>
                  <Text style={styles.partyMeta}>P&L {Math.round(r.pl)} → {Math.round(r.rePl)} ({Math.round(r.diffPl)})</Text>
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const AMBER = '#D4A017';

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', backgroundColor: colors.navy, paddingHorizontal: 4 },
  tab: { flex: 1, alignItems: 'center', paddingTop: 12 },
  tabText: { color: colors.white, fontSize: 13, fontWeight: '600', paddingHorizontal: 2, paddingBottom: 14, letterSpacing: 0.2 },
  tabLine: { height: 4, alignSelf: 'stretch', backgroundColor: 'transparent' },
  tabLineOn: { backgroundColor: colors.coralSoft },
  filters: { flexDirection: 'row', gap: 8, paddingHorizontal: 8, paddingVertical: 10, backgroundColor: colors.surface },
  datePill: { flex: 1, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.lg, justifyContent: 'center', paddingHorizontal: 12 },
  datePillText: { fontSize: 17, color: colors.textMuted, textAlign: 'center' },
  strip: { flexDirection: 'row', justifyContent: 'flex-start', paddingHorizontal: 8, paddingVertical: 8, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border, minHeight: 64 },
  stripEmpty: { flex: 1, textAlign: 'center', color: colors.textMuted, alignSelf: 'center' },
  stripItem: { alignItems: 'center', width: '12.5%' },
  stripBox: { backgroundColor: colors.navy, borderRadius: 7, minWidth: 34, height: 34, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  stripNum: { color: colors.white, fontSize: 17, fontWeight: '700' },
  stripDate: { fontSize: 11, color: colors.text, marginTop: 3 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceMuted, borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 12, paddingHorizontal: 10 },
  index: { width: 34, fontSize: 18, color: colors.text },
  number: { fontSize: 22, fontWeight: '700', color: colors.text },
  figs: { flexDirection: 'row', marginTop: 4, gap: 10, flexWrap: 'wrap' },
  fig: { color: AMBER, fontSize: 13, fontWeight: '700' },
  countCol: { width: 84, alignItems: 'center' },
  countBadge: { minWidth: 30, height: 30, borderRadius: 6, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  countOff: { backgroundColor: '#F2B705' },
  countOn: { backgroundColor: colors.navy },
  countText: { color: colors.white, fontSize: 17, fontWeight: '700' },
  countLabel: { fontSize: 9.5, color: colors.text, marginTop: 3, fontWeight: '600' },
  countSub: { fontSize: 8, color: colors.textMuted },
  plCol: { width: 74, alignItems: 'flex-end' },
  plValue: { fontSize: 18, fontWeight: '700' },
  plLabel: { fontSize: 12, fontStyle: 'italic', fontWeight: '600', marginTop: 2 },
  floatBar: {
    position: 'absolute', left: 30, right: 30, bottom: 22,
    backgroundColor: colors.navy, borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center',
    paddingVertical: 14, paddingHorizontal: 24, ...shadow, elevation: 8,
  },
  floatNum: { color: colors.white, fontSize: 24, fontWeight: '600' },
  floatSep: { width: 2, height: 26, backgroundColor: colors.white, marginHorizontal: 16 },
  floatText: { color: colors.white, fontSize: 15, fontWeight: '500', flexShrink: 1 },
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 20 },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8 },
  sheetTitle: { flex: 1, fontSize: 17, fontWeight: '700', color: colors.navy, textTransform: 'uppercase' },
  sheetLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginTop: 6, marginBottom: 6 },
  sheetResult: { fontSize: 34, fontWeight: '800', color: colors.navy, marginBottom: 6 },
  input: { borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 20, textAlign: 'center', marginBottom: 14, color: colors.text },
  unBtn: { marginTop: 10, backgroundColor: colors.crimson, borderRadius: radius.md, paddingVertical: 15, alignItems: 'center' },
  unText: { color: colors.white, fontSize: 17, fontWeight: '700' },
  neededRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceMuted, borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 16, paddingHorizontal: 12 },
  neededName: { fontSize: 20, fontWeight: '600', color: colors.text, textTransform: 'uppercase' },
  neededDate: { fontSize: 15, fontWeight: '600', color: AMBER, marginTop: 4 },
  neededBtn: { backgroundColor: '#F04438', borderRadius: radius.sm, paddingVertical: 12, paddingHorizontal: 20, minWidth: 128, alignItems: 'center' },
  neededBtnText: { color: colors.white, fontSize: 17, fontWeight: '600' },
  sumHead: { flexDirection: 'row', paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: colors.border },
  sumHeadText: { width: 90, textAlign: 'right', fontSize: 12, color: colors.textMuted, fontWeight: '700' },
  sumRow: { flexDirection: 'row', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.divider },
  sumLabel: { flex: 1, fontSize: 13, fontWeight: '700', color: colors.text, textTransform: 'uppercase' },
  sumVal: { width: 90, textAlign: 'right', fontSize: 15, color: colors.text },
  partyRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.divider },
  partyName: { fontSize: 14, fontWeight: '700', color: colors.text },
  partyMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
});

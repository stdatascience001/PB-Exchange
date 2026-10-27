import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiRequest, errorMessage } from '../api/client';
import { BackHeader } from '../components/BackHeader';
import { CalendarModal } from '../components/CalendarModal';
import { CenterMessage } from '../components/Controls';
import { WaitDialog } from '../components/WaitDialog';
import { colors, radius, shadow } from '../theme';
import { dmy, isoDate, num } from '../utils/format';
import { failure, success, tap } from '../utils/haptics';

// OUTSTANDING REPORT (live app, Report → Agent Outstanding Report): date (calendar) · main agent
// (cash agent list) · FIND, "SEARCH PARY..." + the yellow funnel (tick agent groups, APPLY FILTER /
// CLEAR & CLOSE), then each party of the agent's groups — name, its group (amber), balance
// (Dr navy / Cr red). Bottom: CREDIT / DENA (red) · DEBIT / LENA · FINAL LENA. Tap a party:
// Vapsi %, mobile, login status, PAY / RECEIVE (a cash entry, as the web Admin Cash form) and CLOSE.
// Same APIs as the web OutStanding report (/agents, /vouchers/cash-agent-ledgers, /transactions/outstanding).

interface AgentRow { id: number; group: string; agent: string }
interface OutRow { ledgerId: number; partyName: string; agentGroup: string; credit: number; debit: number }
interface OutData { rows: OutRow[]; totalCredit: number; totalDebit: number; final: number }

export function AgentOutstandingScreen() {
  const insets = useSafeAreaInsets();
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [cashAgents, setCashAgents] = useState<string[]>([]);
  const [date, setDate] = useState<string | null>(null);
  const [agent, setAgent] = useState('');
  const [agentMenu, setAgentMenu] = useState(false);
  const [calendar, setCalendar] = useState(false);
  const [data, setData] = useState<OutData | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState<number[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [party, setParty] = useState<OutRow | null>(null);

  useEffect(() => {
    apiRequest<AgentRow[]>('/agents').then((r) => setAgents(r.data || [])).catch(() => undefined);
    apiRequest<Array<{ id: number; partyName: string }>>('/vouchers/cash-agent-ledgers')
      .then((r) => setCashAgents((r.data || []).map((l) => (l.partyName || '').trim()).filter(Boolean)))
      .catch(() => undefined);
  }, []);

  // agents = every Cash Agent ledger plus the agent column of the agents master (web page rule)
  const agentNames = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const n of [...cashAgents, ...agents.map((a) => (a.agent || '').trim())]) {
      if (n && !byKey.has(n.toUpperCase())) byKey.set(n.toUpperCase(), n);
    }
    return [...byKey.values()].sort((a, b) => b.localeCompare(a)); // live lists Z → A
  }, [agents, cashAgents]);

  useEffect(() => { if (!agent && agentNames.length) setAgent(agentNames[0]); }, [agentNames, agent]);

  const groups = useMemo(
    () => agents.filter((a) => (a.agent || '').trim().toUpperCase() === agent.trim().toUpperCase()).sort((a, b) => a.group.localeCompare(b.group)),
    [agents, agent],
  );

  const load = async (d: string | null = date, g: number[] = groupFilter) => {
    if (!d) { failure(); Alert.alert('Message', 'Please select Date!'); return; }
    if (!agent) { failure(); Alert.alert('Message', 'Please select Agent!'); return; }
    const ids = g.length ? g : groups.map((x) => x.id);
    if (!ids.length) { setData(null); Alert.alert('Error', 'Record not avaliable!'); return; }
    setLoading(true);
    try {
      const res = await apiRequest<OutData>(`/transactions/outstanding?date=${d}&agentIds=${ids.join(',')}`);
      setData(res.data || null);
      if (!res.data?.rows?.length) Alert.alert('Error', 'Record not avaliable!');
    } catch (err) {
      failure();
      Alert.alert('Message', errorMessage(err, 'Failed to load report'));
    } finally {
      setLoading(false);
    }
  };

  const list = useMemo(() => {
    const t = search.trim().toUpperCase();
    return (data?.rows || [])
      .filter((r) => !t || r.partyName.toUpperCase().includes(t) || (r.agentGroup || '').toUpperCase().includes(t))
      .sort((a, b) => a.partyName.localeCompare(b.partyName));
  }, [data, search]);

  const credit = num(data?.totalCredit);
  const debit = num(data?.totalDebit);

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <BackHeader title="Outstanding Report" right={<MaterialIcons name="more-vert" size={28} color={colors.white} />} />
      <View style={styles.filters}>
        <Pressable onPress={() => { tap(); setCalendar(true); }} style={({ pressed }) => [styles.box, { flex: 1 }, pressed && { backgroundColor: colors.canvas }]}>
          <Text style={styles.boxMuted}>{date ? dmy(date) : '00-00-0000'}</Text>
        </Pressable>
        <Pressable onPress={() => { tap(); setAgentMenu(true); }} style={({ pressed }) => [styles.box, { flex: 1.15 }, pressed && { backgroundColor: colors.canvas }]}>
          <Text style={styles.boxText} numberOfLines={1}>{agent || 'AGENT'}</Text>
        </Pressable>
        <Pressable onPress={() => { tap(); void load(); }} style={({ pressed }) => [styles.find, pressed && { backgroundColor: colors.navyDark }]}>
          <Text style={styles.findText}>FIND</Text>
        </Pressable>
      </View>
      <View style={styles.searchRow}>
        <TextInput value={search} onChangeText={setSearch} placeholder="SEARCH PARY..." placeholderTextColor={colors.textMuted} autoCapitalize="characters" style={styles.search} />
        <Pressable accessibilityLabel="Filter groups" onPress={() => { tap(); setFilterOpen(true); }} style={({ pressed }) => [styles.funnel, pressed && { backgroundColor: colors.canvas }]}>
          <MaterialCommunityIcons name="filter" size={36} color={groupFilter.length ? colors.amberDark : '#F2C200'} />
        </Pressable>
      </View>
      <View style={styles.sep} />

      <FlatList
        data={list}
        keyExtractor={(r) => String(r.ledgerId)}
        initialNumToRender={15}
        removeClippedSubviews
        ListEmptyComponent={data ? <CenterMessage text="Record not avaliable!" /> : null}
        contentContainerStyle={{ flexGrow: 1 }}
        renderItem={({ item, index }) => {
          const bal = num(item.debit) - num(item.credit);
          return (
            <Pressable onPress={() => { tap(); setParty(item); }} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.canvas }]}>
              <Text style={styles.index}>{index + 1}.</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.party} numberOfLines={1}>{item.partyName}</Text>
                <Text style={styles.group} numberOfLines={1}>{item.agentGroup || '-'}</Text>
              </View>
              <Text style={[styles.amount, bal < 0 && { color: '#E53935' }]}>
                {Math.round(Math.abs(bal))} {bal < 0 ? 'Cr' : 'Dr'}
              </Text>
            </Pressable>
          );
        }}
      />

      <View style={[styles.footer, { paddingBottom: insets.bottom }]}>
        <View style={[styles.foot, { backgroundColor: '#F04438' }]}>
          <Text style={styles.footValue} numberOfLines={1} adjustsFontSizeToFit>{Math.round(credit)}</Text>
          <Text style={styles.footLabel}>CREDIT / DENA</Text>
        </View>
        <View style={[styles.foot, { backgroundColor: colors.navy, alignItems: 'center' }]}>
          <Text style={styles.footValue} numberOfLines={1} adjustsFontSizeToFit>{Math.round(-debit)}</Text>
          <Text style={styles.footLabel}>DEBIT / LENA</Text>
        </View>
        <View style={[styles.foot, { backgroundColor: colors.navyDark, alignItems: 'flex-end' }]}>
          <Text style={styles.footValue} numberOfLines={1} adjustsFontSizeToFit>{Math.round(credit - debit)}</Text>
          <Text style={styles.footLabel}>FINAL LENA</Text>
        </View>
      </View>

      {/* main agent list (white menu under the field) */}
      <Modal visible={agentMenu} transparent animationType="fade" onRequestClose={() => setAgentMenu(false)}>
        <Pressable style={{ flex: 1 }} onPress={() => setAgentMenu(false)}>
          <View style={[styles.agentMenu, { top: insets.top + 60 }]}>
            <FlatList
              data={agentNames}
              keyExtractor={(n) => n}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => { tap(); setAgent(item); setGroupFilter([]); setData(null); setAgentMenu(false); }}
                  style={({ pressed }) => [styles.agentItem, pressed && { backgroundColor: colors.canvas }]}
                >
                  <Text style={[styles.agentText, item === agent && { fontWeight: '700', color: colors.navy }]} numberOfLines={1}>{item}</Text>
                </Pressable>
              )}
            />
          </View>
        </Pressable>
      </Modal>

      <GroupFilterModal
        visible={filterOpen}
        groups={groups}
        selected={groupFilter}
        onClear={() => { setGroupFilter([]); setFilterOpen(false); if (data) void load(date, []); }}
        onApply={(ids) => { setGroupFilter(ids); setFilterOpen(false); void load(date, ids); }}
      />
      <CalendarModal
        visible={calendar}
        value={date}
        onCancel={() => setCalendar(false)}
        onConfirm={(d) => { setDate(d); setCalendar(false); void load(d); }}
      />
      <PartyModal row={party} date={date} onClose={() => setParty(null)} onSaved={() => { setParty(null); void load(); }} />
      <WaitDialog visible={loading} />
    </View>
  );
}

// Yellow agent-group chooser: SEARCH..., ticks, CLEAR & CLOSE / APPLY FILTER
function GroupFilterModal({ visible, groups, selected, onClear, onApply }: {
  visible: boolean; groups: AgentRow[]; selected: number[]; onClear: () => void; onApply: (ids: number[]) => void;
}) {
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const [ticked, setTicked] = useState<number[]>(selected);
  useEffect(() => { if (visible) { setTicked(selected); setQ(''); } }, [visible, selected]);
  const list = groups.filter((g) => !q.trim() || g.group.toUpperCase().includes(q.trim().toUpperCase()));
  const toggle = (id: number) => setTicked((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClear}>
      <View style={styles.filterBackdrop}>
        <View style={[styles.filterCard, { marginTop: insets.top + 50, marginBottom: insets.bottom + 8 }]}>
          <View style={styles.filterSearchWrap}>
            <TextInput value={q} onChangeText={setQ} placeholder="SEARCH..." placeholderTextColor={colors.textMuted} autoCapitalize="characters" style={styles.filterSearch} />
          </View>
          <FlatList
            data={list}
            keyExtractor={(g) => String(g.id)}
            ListEmptyComponent={<Text style={{ textAlign: 'center', padding: 20, color: colors.textMuted }}>No groups</Text>}
            renderItem={({ item, index }) => (
              <Pressable onPress={() => { tap(); toggle(item.id); }} style={styles.filterRow}>
                <Text style={styles.filterIndex}>{index + 1}.</Text>
                <Text style={styles.filterName} numberOfLines={1}>{item.group}</Text>
                <MaterialIcons name={ticked.includes(item.id) ? 'check-box' : 'check-box-outline-blank'} size={26} color={ticked.includes(item.id) ? colors.navy : '#666'} />
              </Pressable>
            )}
          />
          <View style={styles.filterActions}>
            <Pressable onPress={() => { tap(); onClear(); }} style={[styles.filterBtn, { backgroundColor: '#F04438' }]}><Text style={styles.filterBtnText}>CLEAR & CLOSE</Text></Pressable>
            <Pressable onPress={() => { tap(); onApply(ticked); }} style={[styles.filterBtn, { backgroundColor: colors.navy }]}><Text style={styles.filterBtnText}>APPLY FILTER</Text></Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// Party popup: Vapsi %, mobile, login status; PAY / RECEIVE a cash entry (POST /vouchers/settlement,
// the web Admin Cash form: PAY = Debit, RECEIVE = Credit); CLOSE
interface LedgerInfo { id: number; partyName: string; rebate?: number; mobile?: string | null; loginActive?: boolean }
function PartyModal({ row, date, onClose, onSaved }: { row: OutRow | null; date: string | null; onClose: () => void; onSaved: () => void }) {
  const [info, setInfo] = useState<LedgerInfo | null>(null);
  const [mode, setMode] = useState<'PAY' | 'RECEIVE' | null>(null);
  const [amount, setAmount] = useState('');
  const [remark, setRemark] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setInfo(null); setMode(null); setAmount(''); setRemark('');
    if (!row) return;
    apiRequest<LedgerInfo>(`/ledgers/${row.ledgerId}`).then((r) => setInfo(r.data || null)).catch(() => undefined);
  }, [row]);

  const save = async () => {
    if (!row || !mode) return;
    const amt = parseFloat(amount);
    if (!(amt > 0)) { failure(); Alert.alert('Message', 'Please enter a valid amount!'); return; }
    setSaving(true);
    try {
      await apiRequest('/vouchers/settlement', {
        method: 'POST',
        body: { partyLedgerId: row.ledgerId, entrySide: mode === 'RECEIVE' ? 'CR' : 'DR', amount: amt, narration: remark.trim() || undefined, voucherDate: date || isoDate(new Date()) },
      });
      success();
      Alert.alert('Message', 'Entry has been saved successfully!');
      onSaved();
    } catch (err) {
      failure();
      Alert.alert('Message', errorMessage(err, 'Failed to save entry'));
    } finally {
      setSaving(false);
    }
  };

  if (!row) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.popBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.pop}>
          <View style={styles.popHead}><Text style={styles.popTitle} numberOfLines={1}>{row.partyName}</Text></View>
          <View style={{ padding: 18, paddingBottom: 22 }}>
            {!info ? <ActivityIndicator color={colors.navy} style={{ marginVertical: 20 }} /> : (
              <>
                <InfoLine label="VAPSI" value={`${Math.round(num(info.rebate))} %`} />
                <InfoLine label="MOBILE" value={info.mobile || '-'} underline />
                <InfoLine label="LOGIN" value={info.loginActive === false ? 'DISABLE' : 'ENABLE'} color={info.loginActive === false ? colors.crimson : colors.green} />
              </>
            )}
            {mode ? (
              <>
                <Text style={styles.modeLabel}>{mode === 'PAY' ? 'PAY (DEBIT)' : 'RECEIVE (CREDIT)'}</Text>
                <TextInput value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="AMOUNT" placeholderTextColor={colors.textFaint} style={styles.popInput} />
                <TextInput value={remark} onChangeText={setRemark} placeholder="REMARK" placeholderTextColor={colors.textFaint} autoCapitalize="characters" style={styles.popInput} />
                <View style={styles.popRow}>
                  <Pressable onPress={() => setMode(null)} style={[styles.popBtn, { backgroundColor: colors.textMuted }]}><Text style={styles.popBtnText}>BACK</Text></Pressable>
                  <Pressable disabled={saving} onPress={save} style={[styles.popBtn, { backgroundColor: mode === 'PAY' ? '#F04438' : colors.navy }]}>
                    {saving ? <ActivityIndicator color={colors.white} /> : <Text style={styles.popBtnText}>SAVE</Text>}
                  </Pressable>
                </View>
              </>
            ) : (
              <View style={styles.popRow}>
                <Pressable onPress={() => { tap(); setMode('PAY'); }} style={[styles.popBtn, { backgroundColor: '#F04438' }]}><Text style={styles.popBtnText}>PAY</Text></Pressable>
                <Pressable onPress={() => { tap(); setMode('RECEIVE'); }} style={[styles.popBtn, { backgroundColor: colors.navy }]}><Text style={styles.popBtnText}>RECEIVE</Text></Pressable>
              </View>
            )}
            <Pressable onPress={() => { tap(); onClose(); }} style={[styles.popBtn, styles.popClose]}><Text style={styles.popBtnText}>CLOSE</Text></Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function InfoLine({ label, value, color, underline }: { label: string; value: string; color?: string; underline?: boolean }) {
  return (
    <View style={styles.infoLine}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={[styles.infoValue, color ? { color } : null, underline && { textDecorationLine: 'underline' }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', gap: 8, paddingHorizontal: 8, paddingTop: 10 },
  box: { borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, justifyContent: 'center', paddingVertical: 15, paddingHorizontal: 10 },
  boxMuted: { fontSize: 17, color: colors.textMuted, textAlign: 'center' },
  boxText: { fontSize: 18, color: colors.text, textTransform: 'uppercase' },
  find: { flex: 0.95, backgroundColor: colors.navy, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', ...shadow },
  findText: { color: colors.white, fontSize: 19, fontWeight: '600' },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 8, paddingVertical: 10 },
  search: { flex: 1, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, paddingHorizontal: 16, paddingVertical: 14, fontSize: 19, color: colors.text },
  funnel: { width: 60, height: 56, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  sep: { height: 1, backgroundColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceMuted, borderBottomWidth: 1.5, borderBottomColor: '#E2E8F0', paddingVertical: 18, paddingHorizontal: 14 },
  index: { width: 56, fontSize: 19, color: colors.text },
  party: { fontSize: 18, fontWeight: '600', color: colors.text, textTransform: 'uppercase' },
  group: { fontSize: 16, fontWeight: '600', color: '#E8961E', marginTop: 6, textTransform: 'uppercase' },
  amount: { fontSize: 19, fontWeight: '600', color: colors.navy, marginLeft: 8 },
  footer: { flexDirection: 'row' },
  foot: { flex: 1, paddingHorizontal: 10, paddingVertical: 12 },
  footValue: { color: colors.white, fontSize: 21, fontWeight: '700' },
  footLabel: { color: colors.white, fontSize: 13, fontWeight: '500', marginTop: 2 },
  agentMenu: { position: 'absolute', left: '35%', right: '21%', bottom: 20, backgroundColor: colors.surface, borderRadius: 3, ...shadow, elevation: 10 },
  agentItem: { paddingHorizontal: 16, paddingVertical: 15 },
  agentText: { fontSize: 17, color: colors.text, textTransform: 'uppercase' },
  filterBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center' },
  filterCard: { flex: 1, width: '84%', backgroundColor: '#FBFAD9', overflow: 'hidden' },
  filterSearchWrap: { padding: 12, borderBottomWidth: 1, borderBottomColor: '#E2E0B8' },
  filterSearch: { backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 17, color: colors.text },
  filterRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#E2E0B8' },
  filterIndex: { width: 36, fontSize: 15, color: colors.text },
  filterName: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text, textTransform: 'uppercase' },
  filterActions: { flexDirection: 'row', gap: 10, padding: 12 },
  filterBtn: { flex: 1, borderRadius: radius.sm, paddingVertical: 14, alignItems: 'center' },
  filterBtnText: { color: colors.white, fontSize: 15, fontWeight: '600' },
  popBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 28 },
  pop: { width: '100%', maxWidth: 380, backgroundColor: colors.surface, borderRadius: 3, overflow: 'hidden', maxHeight: '85%' },
  popHead: { backgroundColor: colors.navy, paddingVertical: 18, alignItems: 'center', paddingHorizontal: 12 },
  popTitle: { color: colors.white, fontSize: 16, fontWeight: '600', textTransform: 'uppercase' },
  infoLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 14, marginBottom: 12 },
  infoLabel: { fontSize: 15, color: colors.textMuted },
  infoValue: { fontSize: 16, fontWeight: '600', color: colors.text },
  popRow: { flexDirection: 'row', gap: 10, marginTop: 6 },
  popBtn: { flex: 1, borderRadius: radius.sm, paddingVertical: 14, alignItems: 'center' },
  popBtnText: { color: colors.white, fontSize: 15, fontWeight: '600' },
  popClose: { flex: 0, alignSelf: 'stretch', backgroundColor: colors.navy, marginTop: 26, minHeight: 48, justifyContent: 'center' },
  modeLabel: { fontSize: 13, fontWeight: '700', color: colors.textMuted, marginTop: 6, marginBottom: 8 },
  popInput: { borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: colors.text, marginBottom: 10 },
});

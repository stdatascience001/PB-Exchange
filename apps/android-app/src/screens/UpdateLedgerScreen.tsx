import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiRequest, errorMessage } from '../api/client';
import type { Agent, Ledger } from '../api/types';
import { BackHeader } from '../components/BackHeader';
import { PartyPickerModal } from '../components/PartyPickerModal';
import { useApiList } from '../hooks/useApiList';
import type { RootStackParamList } from '../navigation/types';
import { colors, radius, shadow } from '../theme';
import { num } from '../utils/format';
import { failure, success, tap } from '../utils/haptics';

// UPDATE LEDGER (live app: All Ledgers → tap a party). Each card saves on its own — the same
// calls, fields and messages as the web Ledger Update popup:
//   Ledger Name                    → UPDATE LEDGER NAME   PUT { partyName }
//   Password                       → UPDATE PASSWORD      PUT { password } (min 8, a number, a letter)
//   Real / Grantor / Mobile / Address → UPDATE INFO       PUT { realName, grantor, mobile, address }
//   D-Rate D-Comm A-Rate A-Comm S-Hissa → UPDATE CONFIG  PUT { daraRate, akharRate, commissionRate, hissaPercentage }
//     (D-Comm = 100 − D-Rate, A-Comm = 100 − A-Rate × 10, as the web Re-Config)
//   3rd Party Commission / Hissa rows → +  POST /ledgers/:id/links, −  DELETE /ledgers/links/:id
//   3rd Party Rebate rows             → +  / −  the same
//   Agent / Ref-Ledger / Rebate / Limit / Dibba / Dibba Amt / Dealing → UPDATE OTHER INFO
//   LOGIN STATUS · ACCOUNT STATUS (toggle) · DELETE ACCOUNT
interface LedgerDetail {
  id: number; partyName: string; realName?: string | null; grantor?: string | null; mobile?: string | null; address?: string | null;
  daraRate: number | string; akharRate: number | string; commissionRate: number | string; hissaPercentage: number | string;
  agentId?: number | null; agentName?: string | null; refLedgerId?: number | null; refLedgerName?: string | null;
  rebate?: number | string; hasLimit?: boolean; dibba?: boolean; dAmt?: number | string; dealing?: string | null;
  loginActive?: boolean; accountActive?: boolean;
}
interface Link { id: number; linkType: 'HISSA' | 'TPC' | 'TPV'; partyName: string; percent: number | string; dComm: number | string; aComm: number | string }

type Busy = string | null;
type Pick = 'TPC' | 'HISSA' | 'TPV' | 'REF' | 'AGENT' | 'LIMIT' | 'DIBBA' | 'DEALING' | null;

const numText = (v: unknown) => String(Math.round(num(v) * 100) / 100);
const decimal = (v: string) => v.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
const commFromDara = (v: string) => (v.trim() === '' || isNaN(parseFloat(v)) ? '' : String(100 - parseFloat(v)));
const commFromAkhar = (v: string) => (v.trim() === '' || isNaN(parseFloat(v)) ? '' : String(Math.round((100 - parseFloat(v) * 10) * 100) / 100));
const HISSA_MAX = 99;
const HISSA_TOTAL_MAX = 90;

export function UpdateLedgerScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { params } = useRoute<RouteProp<RootStackParamList, 'UpdateLedger'>>();
  const ledgers = useApiList<Ledger>('/ledgers');
  const agents = useApiList<Agent>('/agents');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Busy>(null);
  const [pick, setPick] = useState<Pick>(null);

  const [detail, setDetail] = useState<LedgerDetail | null>(null);
  const [name, setName] = useState('');
  // masked placeholder only (as the web): the real password is never sent to the app
  const [password, setPassword] = useState('123456');
  const [realName, setRealName] = useState('');
  const [grantor, setGrantor] = useState('');
  const [mobile, setMobile] = useState('');
  const [address, setAddress] = useState('');
  const [dRate, setDRate] = useState('0');
  const [dComm, setDComm] = useState('0');
  const [aRate, setARate] = useState('0');
  const [aComm, setAComm] = useState('0');
  const [sHissa, setSHissa] = useState('0');
  const loaded = useRef({ daraRate: '0', commissionRate: 0 });

  const [links, setLinks] = useState<Link[]>([]);
  const [tpc, setTpc] = useState({ party: '', d: '', a: '' });
  const [hissa, setHissa] = useState({ party: '', pct: '' });
  const [tpv, setTpv] = useState({ party: '', pct: '' });

  const [agentName, setAgentName] = useState('');
  const [refId, setRefId] = useState<number | null>(null);
  const [refName, setRefName] = useState('');
  const [rebate, setRebate] = useState('0');
  const [limitType, setLimitType] = useState('NO');
  const [dibba, setDibba] = useState('NO');
  const [dAmt, setDAmt] = useState('0');
  const [dealing, setDealing] = useState('DAILY');

  const loadLinks = useCallback(() => {
    apiRequest<Link[]>(`/ledgers/${params.id}/links`).then((r) => setLinks(r.data || [])).catch(() => undefined);
  }, [params.id]);

  useEffect(() => {
    let alive = true;
    apiRequest<LedgerDetail>(`/ledgers/${params.id}`)
      .then((r) => {
        const d = r.data;
        if (!alive || !d) return;
        setDetail(d);
        setName(d.partyName || '');
        setRealName(d.realName || '');
        setGrantor(d.grantor || '');
        setMobile(d.mobile || '');
        setAddress(d.address || '');
        const dr = numText(d.daraRate);
        const ar = numText(d.akharRate);
        setDRate(dr); setDComm(commFromDara(dr));
        setARate(ar); setAComm(commFromAkhar(ar));
        setSHissa(numText(d.hissaPercentage));
        loaded.current = { daraRate: dr, commissionRate: num(d.commissionRate) };
        setAgentName(d.agentName || '');
        setRefId(d.refLedgerId ?? null);
        setRefName(d.refLedgerName || '');
        setRebate(numText(d.rebate));
        setLimitType(d.hasLimit ? 'YES' : 'NO');
        setDibba(d.dibba ? 'YES' : 'NO');
        setDAmt(numText(d.dAmt));
        setDealing(d.dealing || 'DAILY');
      })
      .catch((err) => { if (alive) Alert.alert('Message', errorMessage(err, 'Failed to load ledger')); })
      .finally(() => { if (alive) setLoading(false); });
    loadLinks();
    return () => { alive = false; };
  }, [params.id, loadLinks]);

  const put = async (key: string, body: Record<string, unknown>, label: string): Promise<boolean> => {
    setBusy(key);
    try {
      await apiRequest(`/ledgers/${params.id}`, { method: 'PUT', body });
      success();
      Alert.alert('Success', `Ledger info (${label}) has been updated successfully!`);
      return true;
    } catch (err) {
      failure();
      Alert.alert('Message', errorMessage(err, 'Failed to update ledger'));
      return false;
    } finally {
      setBusy(null);
    }
  };

  // ---- Name / Password / Info / Config ----------------------------------------------------------
  const saveName = () => {
    if (!name.trim()) { failure(); Alert.alert('Message', 'Please enter valid Ledger Name!'); return; }
    void put('NAME', { partyName: name.trim() }, 'Name');
  };
  const savePassword = () => {
    const pw = password.trim();
    if (pw.length < 8 || !/\d/.test(pw) || !/[A-Za-z]/.test(pw)) {
      failure();
      Alert.alert('Message', 'Please enter a valid new password!\n• Must be a minimum of 8 characters.\n• Must contain at least 1 number.\n• Must contain at least 1 alphabet character.');
      return;
    }
    void put('PASSWORD', { password: pw }, 'Password');
  };
  const saveInfo = () => {
    void put('INFO', { realName: realName.trim() || undefined, grantor: grantor.trim(), mobile: mobile.trim() || undefined, address: address.trim() }, 'Info');
  };
  const saveConfig = async (label = 'Reconfig') => {
    const d = parseFloat(dRate) || 0;
    const a = parseFloat(aRate) || 0;
    const h = parseFloat(sHissa) || 0;
    if (d > 100 || a > 10) { failure(); Alert.alert('Message', 'Please enter valid Rate!'); return false; }
    if (h > HISSA_MAX) { failure(); Alert.alert('Message', `Please enter total valid hissa max ${HISSA_MAX}% !`); return false; }
    return put('CONFIG', {
      daraRate: d,
      akharRate: a,
      // D-Rate changed -> its derived commission; otherwise the stored commission stays (web rule)
      commissionRate: dRate.trim() !== loaded.current.daraRate ? (parseFloat(dComm) || 0) : loaded.current.commissionRate,
      hissaPercentage: h,
    }, label);
  };

  // ---- 3rd party / hissa links -------------------------------------------------------------------
  const tpcLinks = links.filter((l) => l.linkType === 'TPC');
  const hissaLinks = links.filter((l) => l.linkType === 'HISSA');
  const tpvLinks = links.filter((l) => l.linkType === 'TPV');

  const addLink = async (linkType: Link['linkType'], payload: Record<string, unknown>): Promise<boolean> => {
    setBusy(`ADD-${linkType}`);
    try {
      await apiRequest(`/ledgers/${params.id}/links`, { method: 'POST', body: { linkType, ...payload } });
      success();
      loadLinks();
      return true;
    } catch (err) {
      failure();
      Alert.alert('Message', errorMessage(err, 'Failed to add'));
      return false;
    } finally {
      setBusy(null);
    }
  };
  const invalidRow = () => { failure(); Alert.alert('Message', 'Please enter a valid party or Percent.'); };

  const addTpc = async () => {
    const d = parseFloat(tpc.d) || 0;
    if (!tpc.party.trim() || !(d > 0)) { invalidRow(); return false; }
    const maxAllow = 100 - (parseFloat(dRate) || 0);
    if (d > maxAllow) { failure(); Alert.alert('Message', `Transfer Dara Percent has been exceeded. Max Allow: ${maxAllow}`); return false; }
    const ok = await addLink('TPC', { partyName: tpc.party, dComm: d, aComm: parseFloat(tpc.a) || 0 });
    if (ok) setTpc({ party: '', d: '', a: '' });
    return ok;
  };
  const addHissa = async () => {
    const pct = parseFloat(hissa.pct) || 0;
    if (!hissa.party.trim() || !(pct > 0)) { invalidRow(); return false; }
    const total = hissaLinks.reduce((s, l) => s + num(l.percent), 0) + pct;
    const limit = pct > HISSA_MAX ? HISSA_MAX : total > HISSA_TOTAL_MAX ? HISSA_TOTAL_MAX : null;
    if (limit !== null) { failure(); Alert.alert('Message', `Transfer hissa has been exceeded max limit: ${limit}`); return false; }
    const ok = await addLink('HISSA', { partyName: hissa.party, percent: pct });
    if (ok) setHissa({ party: '', pct: '' });
    return ok;
  };
  const addTpv = async () => {
    const pct = parseFloat(tpv.pct) || 0;
    if (!tpv.party.trim() || !(pct > 0)) { invalidRow(); return false; }
    const ok = await addLink('TPV', { partyName: tpv.party, percent: pct });
    if (ok) setTpv({ party: '', pct: '' });
    return ok;
  };
  const deleteLink = (l: Link) => {
    Alert.alert('Remove', `Remove ${l.partyName}?`, [
      { text: 'No', style: 'cancel' },
      {
        text: 'Yes',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiRequest(`/ledgers/links/${l.id}`, { method: 'DELETE' });
            success();
            loadLinks();
          } catch (err) {
            failure();
            Alert.alert('Message', errorMessage(err, 'Failed to remove'));
          }
        },
      },
    ]);
  };
  // "Update Hissa/TPComm" / "UPDATE TP-REBATE": add a row still typed in, then save the ledger's
  // config (the web Re-Config save behind those buttons)
  const updateHissaTpc = async () => {
    if (tpc.party.trim() && !(await addTpc())) return;
    if (hissa.party.trim() && !(await addHissa())) return;
    await saveConfig('Reconfig');
  };
  const updateTpRebate = async () => {
    if (tpv.party.trim() && !(await addTpv())) return;
    await saveConfig('Reconfig');
  };

  // ---- Other info / status / delete --------------------------------------------------------------
  const saveOther = () => {
    const clean = agentName.trim().toUpperCase();
    const matched = agents.data.find((a) => a.agentName.toUpperCase() === clean);
    const agentId = clean ? (matched ? matched.id : detail?.agentId ?? null) : null;
    void put('OTHER', {
      agentId,
      refLedgerId: refId || null,
      rebate: parseFloat(rebate) || 0,
      hasLimit: limitType === 'YES',
      dibba: dibba === 'YES',
      dAmt: parseFloat(dAmt) || 0,
      dealing,
    }, 'Info');
  };
  const toggle = async (field: 'loginActive' | 'accountActive') => {
    if (!detail) return;
    const next = detail[field] === false;
    const ok = await put(field, { [field]: next }, field === 'loginActive' ? 'LoginStatus' : 'AccountStatus');
    if (ok) setDetail({ ...detail, [field]: next });
  };
  const deleteAccount = () => {
    Alert.alert('Delete Account', `Delete ${name}?`, [
      { text: 'No', style: 'cancel' },
      {
        text: 'Yes',
        style: 'destructive',
        onPress: async () => {
          setBusy('DELETE');
          try {
            await apiRequest(`/ledgers/${params.id}`, { method: 'DELETE' });
            success();
            Alert.alert('Success', 'Ledger has been deleted successfully!');
            navigation.goBack();
          } catch (err) {
            failure();
            Alert.alert('Message', errorMessage(err, 'Failed to delete ledger'));
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  };

  // party lists for the pickers (Hissa also offers the system "HP A/C" account, as the web)
  const partyList = useMemo<Ledger[]>(() => {
    if (pick !== 'HISSA') return ledgers.data;
    const hp = { id: -1, partyName: 'HP A/C', daraRate: 0, akharRate: 0, commissionRate: 0 } as Ledger;
    return [hp, ...ledgers.data.filter((l) => l.partyName.toUpperCase() !== 'HP A/C')];
  }, [pick, ledgers.data]);

  const optionList = pick === 'AGENT' ? agents.data.map((a) => a.agentName).sort((a, b) => a.localeCompare(b))
    : pick === 'LIMIT' || pick === 'DIBBA' ? ['YES', 'NO']
      : pick === 'DEALING' ? ['DAILY', 'WEEKLY', 'MONTHLY'] : [];

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.canvas }}>
        <BackHeader title="Update Ledger" />
        <ActivityIndicator color={colors.navy} style={{ marginTop: 40 }} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#E5E7EB' }}>
      <BackHeader title="Update Ledger" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24, gap: 10 }} keyboardShouldPersistTaps="handled">
          <Card>
            <Field label="Ledger Name" value={name} onChange={setName} caps />
            <Button label="UPDATE LEDGER NAME" busy={busy === 'NAME'} onPress={saveName} />
          </Card>

          <Card>
            <Field label="Password" value={password} onChange={setPassword} />
            <Button label="UPDATE PASSWORD" busy={busy === 'PASSWORD'} onPress={savePassword} />
          </Card>

          <Card>
            <View style={styles.two}>
              <View style={{ flex: 1 }}><Field label="Real Name" value={realName} onChange={setRealName} caps /></View>
              <View style={{ flex: 1 }}><Field label="Grantor Name" value={grantor} onChange={setGrantor} caps /></View>
            </View>
            <View style={styles.two}>
              <View style={{ flex: 1 }}><Field label="Mobile" value={mobile} onChange={setMobile} keyboard="phone-pad" /></View>
              <View style={{ flex: 1 }}><Field label="Address" value={address} onChange={setAddress} /></View>
            </View>
            <Button label="UPDATE INFO" busy={busy === 'INFO'} onPress={saveInfo} />
          </Card>

          <Card>
            <View style={styles.five}>
              <Small label="D-Rate" value={dRate} onChange={(v) => { const x = decimal(v); setDRate(x); setDComm(commFromDara(x)); }} />
              <Small label="D-Comm" value={dComm} onChange={(v) => setDComm(decimal(v))} />
              <Small label="A-Rate" value={aRate} onChange={(v) => { const x = decimal(v); setARate(x); setAComm(commFromAkhar(x)); }} />
              <Small label="A-Comm" value={aComm} onChange={(v) => setAComm(decimal(v))} />
              <Small label="S-Hissa" value={sHissa} onChange={(v) => setSHissa(decimal(v))} />
            </View>
            <Button label="UPDATE CONFIG" busy={busy === 'CONFIG'} onPress={() => { void saveConfig(); }} />
          </Card>

          <Card>
            <Text style={styles.section}>3rd Party Commission</Text>
            <View style={styles.addRow}>
              <PickBox flex={3} value={tpc.party} placeholder="Party Name" onPress={() => setPick('TPC')} />
              <SmallInput flex={1.1} value={tpc.d} placeholder="D-Comm" onChange={(v) => setTpc((s) => ({ ...s, d: decimal(v) }))} />
              <SmallInput flex={1.1} value={tpc.a} placeholder="A-Comm" onChange={(v) => setTpc((s) => ({ ...s, a: decimal(v) }))} />
              <PlusButton busy={busy === 'ADD-TPC'} onPress={() => { void addTpc(); }} />
            </View>
            {tpcLinks.map((l, i) => (
              <LinkRow key={l.id} index={i + 1} name={l.partyName} values={[numText(l.dComm), numText(l.aComm)]} onRemove={() => deleteLink(l)} />
            ))}

            <Text style={[styles.section, { marginTop: 10 }]}>Hissa</Text>
            <View style={styles.addRow}>
              <PickBox flex={3} value={hissa.party} placeholder="Hissa Party Name" onPress={() => setPick('HISSA')} />
              <SmallInput flex={1.3} value={hissa.pct} placeholder="%" onChange={(v) => setHissa((s) => ({ ...s, pct: decimal(v) }))} />
              <PlusButton busy={busy === 'ADD-HISSA'} onPress={() => { void addHissa(); }} />
            </View>
            {hissaLinks.map((l, i) => (
              <LinkRow key={l.id} index={i + 1} name={l.partyName} values={[numText(l.percent)]} onRemove={() => deleteLink(l)} />
            ))}
            <Button label="Update Hissa/TPComm" busy={busy === 'CONFIG' || busy === 'ADD-TPC' || busy === 'ADD-HISSA'} onPress={() => { void updateHissaTpc(); }} plain />
          </Card>

          <Card>
            <Text style={styles.section}>3rd Party Rebate</Text>
            <View style={styles.addRow}>
              <PickBox flex={3} value={tpv.party} placeholder="Party Name" onPress={() => setPick('TPV')} />
              <SmallInput flex={1.3} value={tpv.pct} placeholder="%" onChange={(v) => setTpv((s) => ({ ...s, pct: decimal(v) }))} />
              <PlusButton busy={busy === 'ADD-TPV'} onPress={() => { void addTpv(); }} />
            </View>
            {tpvLinks.map((l, i) => (
              <LinkRow key={l.id} index={i + 1} name={l.partyName} values={[numText(l.percent)]} onRemove={() => deleteLink(l)} />
            ))}
            <Button label="UPDATE TP-REBATE" busy={busy === 'ADD-TPV'} onPress={() => { void updateTpRebate(); }} />
          </Card>

          <Card>
            <View style={styles.two}>
              <View style={{ flex: 1 }}><Text style={styles.label}>Agent Name</Text><PickBox value={agentName} onPress={() => setPick('AGENT')} bold /></View>
              <View style={{ flex: 1 }}><Text style={styles.label}>Ref-Ledger</Text><PickBox value={refName} onPress={() => setPick('REF')} bold /></View>
            </View>
            <View style={[styles.two, { marginTop: 12 }]}>
              <View style={{ flex: 0.8 }}><Text style={styles.label}>Rebate</Text><TextInput value={rebate} onChangeText={(v) => setRebate(decimal(v))} keyboardType="decimal-pad" style={[styles.input, { textAlign: 'center' }]} /></View>
              <View style={{ flex: 1 }}><Text style={styles.label}>Limit Type</Text><PickBox value={limitType} onPress={() => setPick('LIMIT')} /></View>
              <View style={{ flex: 1 }}><Text style={styles.label}>Dibba</Text><PickBox value={dibba} onPress={() => setPick('DIBBA')} /></View>
              <View style={{ flex: 1 }}><Text style={styles.label} numberOfLines={1}>Dibba Amount</Text><TextInput value={dAmt} onChangeText={(v) => setDAmt(decimal(v))} keyboardType="decimal-pad" style={[styles.input, { textAlign: 'center' }]} /></View>
            </View>
            <Text style={[styles.label, { marginTop: 12 }]}>Dealing Type</Text>
            <PickBox value={dealing} onPress={() => setPick('DEALING')} />
            <View style={{ height: 14 }} />
            <Button label="UPDATE OTHER INFO" busy={busy === 'OTHER'} onPress={saveOther} />
          </Card>

          <Card>
            <View style={{ gap: 26, paddingVertical: 10 }}>
              <Button label={`LOGIN STATUS | ${detail?.loginActive === false ? 'DEACTIVE NOW' : 'ACTIVE NOW'}`} busy={busy === 'loginActive'} onPress={() => { void toggle('loginActive'); }} />
              <Button label={`ACCOUNT STATUS | ${detail?.accountActive === false ? 'DEACTIVE NOW' : 'ACTIVE NOW'}`} busy={busy === 'accountActive'} onPress={() => { void toggle('accountActive'); }} />
              <Button label="DELETE ACCOUNT" busy={busy === 'DELETE'} onPress={deleteAccount} danger />
            </View>
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>

      <PartyPickerModal
        visible={pick === 'TPC' || pick === 'HISSA' || pick === 'TPV' || pick === 'REF'}
        parties={partyList}
        loading={ledgers.loading}
        onClose={() => setPick(null)}
        onPick={(l) => {
          if (pick === 'TPC') setTpc((s) => ({ ...s, party: l.partyName }));
          else if (pick === 'HISSA') setHissa((s) => ({ ...s, party: l.partyName }));
          else if (pick === 'TPV') setTpv((s) => ({ ...s, party: l.partyName }));
          else if (pick === 'REF') { setRefId(l.id); setRefName(l.partyName); }
          setPick(null);
        }}
      />
      <Modal visible={pick === 'AGENT' || pick === 'LIMIT' || pick === 'DIBBA' || pick === 'DEALING'} transparent animationType="fade" onRequestClose={() => setPick(null)}>
        <Pressable style={styles.backdrop} onPress={() => setPick(null)}>
          <View style={[styles.menu, pick === 'AGENT' ? { flex: 1, marginTop: insets.top + 80, marginBottom: insets.bottom + 40 } : { marginTop: 220 }]}>
            <FlatList
              data={pick === 'AGENT' ? ['', ...optionList] : optionList}
              keyExtractor={(n, i) => `${n}-${i}`}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => {
                    tap();
                    if (pick === 'AGENT') setAgentName(item);
                    else if (pick === 'LIMIT') setLimitType(item);
                    else if (pick === 'DIBBA') setDibba(item);
                    else if (pick === 'DEALING') setDealing(item);
                    setPick(null);
                  }}
                  style={({ pressed }) => [styles.menuItem, pressed && { backgroundColor: colors.canvas }]}
                >
                  <Text style={styles.menuText} numberOfLines={1}>{item || 'NONE'}</Text>
                </Pressable>
              )}
            />
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

function Field({ label, value, onChange, caps, keyboard }: { label: string; value: string; onChange: (v: string) => void; caps?: boolean; keyboard?: 'phone-pad' }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} autoCapitalize={caps ? 'characters' : 'none'} autoCorrect={false} keyboardType={keyboard} style={styles.input} />
    </View>
  );
}

function Small({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} keyboardType="decimal-pad" style={[styles.input, styles.small]} />
    </View>
  );
}

function SmallInput({ value, placeholder, onChange, flex }: { value: string; placeholder: string; onChange: (v: string) => void; flex: number }) {
  return (
    <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor="#999" keyboardType="decimal-pad" style={[styles.input, { flex, textAlign: 'center', paddingHorizontal: 2, minWidth: 0 }]} />
  );
}

function PickBox({ value, placeholder, onPress, flex, bold }: { value: string; placeholder?: string; onPress: () => void; flex?: number; bold?: boolean }) {
  return (
    <Pressable onPress={() => { tap(); onPress(); }} style={[styles.input, { justifyContent: 'center', flex, minWidth: 0 }]}>
      <Text style={[styles.pickText, !value && { color: '#999', fontWeight: '400', textTransform: 'none' }, bold && value ? { color: '#0F3B12', fontWeight: '700' } : null]} numberOfLines={1}>
        {value || placeholder || ''}
      </Text>
    </Pressable>
  );
}

function PlusButton({ onPress, busy }: { onPress: () => void; busy?: boolean }) {
  return (
    <Pressable disabled={busy} onPress={() => { tap(); onPress(); }} style={({ pressed }) => [styles.plus, (pressed || busy) && { backgroundColor: colors.navyDark }]}>
      {busy ? <ActivityIndicator color={colors.white} size="small" /> : <Text style={styles.plusText}>+</Text>}
    </Pressable>
  );
}

function LinkRow({ index, name, values, onRemove }: { index: number; name: string; values: string[]; onRemove: () => void }) {
  return (
    <View style={styles.linkRow}>
      <Text style={styles.linkName} numberOfLines={1}>{index}.  {name}</Text>
      {values.map((v, i) => (
        <View key={i} style={styles.linkVal}><Text style={styles.linkValText}>{v}</Text></View>
      ))}
      <Pressable onPress={() => { tap(); onRemove(); }} style={styles.minus}><Text style={styles.minusText}>-</Text></Pressable>
    </View>
  );
}

function Button({ label, busy, onPress, danger, plain }: { label: string; busy: boolean; onPress: () => void; danger?: boolean; plain?: boolean }) {
  return (
    <Pressable
      disabled={busy}
      onPress={() => { tap(); onPress(); }}
      style={({ pressed }) => [styles.button, danger && { backgroundColor: '#F04438' }, (pressed || busy) && { opacity: 0.85 }]}
    >
      {busy ? <ActivityIndicator color={colors.white} /> : <Text style={[styles.buttonText, plain && { textTransform: 'none' }]}>{label}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, paddingHorizontal: 18, paddingVertical: 18 },
  section: { fontSize: 15, color: '#555', marginBottom: 8 },
  label: { fontSize: 13, color: '#555', marginBottom: 5 },
  input: { borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 10, height: 42, fontSize: 15, fontWeight: '700', color: '#0F3B12', backgroundColor: colors.surface },
  pickText: { fontSize: 15, color: colors.text, fontWeight: '500', textTransform: 'uppercase' },
  small: { width: '92%', textAlign: 'center', paddingHorizontal: 4 },
  two: { flexDirection: 'row', gap: 8 },
  five: { flexDirection: 'row', gap: 4, marginBottom: 6 },
  addRow: { flexDirection: 'row', gap: 6, alignItems: 'center', marginBottom: 8 },
  plus: { width: 42, height: 42, borderRadius: radius.sm, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
  plusText: { color: colors.white, fontSize: 22, fontWeight: '700' },
  linkRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, paddingLeft: 10, paddingRight: 6, height: 42, marginBottom: 8 },
  linkName: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text },
  linkVal: { width: 52, alignItems: 'center', borderLeftWidth: 1, borderLeftColor: colors.divider },
  linkValText: { fontSize: 16, fontWeight: '600', color: colors.text },
  minus: { width: 48, height: 28, borderRadius: 7, backgroundColor: '#F04438', alignItems: 'center', justifyContent: 'center', marginLeft: 6 },
  minusText: { color: colors.white, fontSize: 16, fontWeight: '700' },
  button: { backgroundColor: colors.navy, borderRadius: radius.sm, height: 46, alignItems: 'center', justifyContent: 'center', ...shadow },
  buttonText: { color: colors.white, fontSize: 15, fontWeight: '500', letterSpacing: 0.3 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center' },
  menu: { width: '78%', backgroundColor: colors.surface, borderRadius: 4, ...shadow, elevation: 10 },
  menuItem: { paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.divider },
  menuText: { fontSize: 16, color: colors.text, textTransform: 'uppercase' },
});

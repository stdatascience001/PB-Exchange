import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import React, { useState } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiRequest, errorMessage } from '../api/client';
import type { Agent } from '../api/types';
import { BackHeader } from '../components/BackHeader';
import { useApiList } from '../hooks/useApiList';
import type { RootStackParamList } from '../navigation/types';
import { colors, radius, shadow } from '../theme';
import { failure, success, tap } from '../utils/haptics';

// Staff add / update (live app: All Staffs → ADD STAFF, or tap a staff). Same calls, fields and
// rules as the web Staff page:
//   Add     POST /staff  { fullName, role, designation, wMode, username, password, agent, mobile, address }
//           Staff Name, Username, Password required ("Invalid / Please enter all valid fields!")
//   Update  title = the staff's name;  UPDATE STAFF PASSWORD  PUT /staff/:id { password }
//           UPDATE STAFF INFO  PUT /staff/:id { role, designation, wMode, agent, mobile, address }
//           ACCOUNT STATUS     PATCH /staff/:id/active (active ⇄ deactive)
//   Passwords: min 8 characters, at least 1 number and 1 letter.

export const STAFF_ROLES = ['ADMIN', 'MANAGER', 'MARKETER', 'AUDITOR', 'DATA ENTRY OPERATOR', 'TALLY OPERATOR'];
export const W_MODES = ['NONE', 'COMMAN', 'WHATSAPP', 'CALLING'];

const strong = (pw: string) => pw.length >= 8 && /\d/.test(pw) && /[A-Za-z]/.test(pw);
const weakPassword = () => {
  failure();
  Alert.alert('Message', 'Please enter a valid new password!\n• Must be a minimum of 8 characters.\n• Must contain at least 1 number.\n• Must contain at least 1 alphabet character.');
};

type Pick = 'ROLE' | 'WMODE' | 'AGENT' | null;

function usePickers() {
  const agents = useApiList<Agent>('/agents');
  const [pick, setPick] = useState<Pick>(null);
  const options = pick === 'ROLE' ? STAFF_ROLES
    : pick === 'WMODE' ? W_MODES
      : pick === 'AGENT' ? ['', ...agents.data.map((a) => a.agentName).sort((a, b) => a.localeCompare(b))] : [];
  return { pick, setPick, options, loadingAgents: agents.loading };
}

// ---- Update ------------------------------------------------------------------------------------
export function UpdateStaffScreen() {
  const insets = useSafeAreaInsets();
  const { params } = useRoute<RouteProp<RootStackParamList, 'UpdateStaff'>>();
  const s = params.staff;
  const { pick, setPick, options, loadingAgents } = usePickers();
  // masked placeholder only (as the web): the real password is never sent to the app
  const [password, setPassword] = useState('123456');
  const [role, setRole] = useState(s.role || 'DATA ENTRY OPERATOR');
  const [wMode, setWMode] = useState(s.wMode || 'NONE');
  const [agent, setAgent] = useState(s.agent || '');
  const [mobile, setMobile] = useState(s.mobile || '');
  const [address, setAddress] = useState(s.address || '');
  const [active, setActive] = useState(s.isActive !== false);
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<unknown>, okMessage: string) => {
    setBusy(key);
    try {
      await fn();
      success();
      Alert.alert('Success', okMessage);
      return true;
    } catch (err) {
      failure();
      Alert.alert('Message', errorMessage(err, 'Failed to update staff'));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const savePassword = () => {
    const pw = password.trim();
    if (!pw) { failure(); Alert.alert('Message', 'Please enter a password'); return; }
    if (!strong(pw)) { weakPassword(); return; }
    void run('PASSWORD', () => apiRequest(`/staff/${s.id}`, { method: 'PUT', body: { password: pw } }), 'Staff info (Password) has been updated successfully!');
  };
  const saveInfo = () => {
    void run('INFO', () => apiRequest(`/staff/${s.id}`, {
      method: 'PUT',
      body: { role, designation: role, wMode, agent: agent.trim().toUpperCase(), mobile: mobile.trim(), address: address.trim().toUpperCase() },
    }), 'Staff info has been updated successfully!');
  };
  const toggleActive = async () => {
    const ok = await run('ACTIVE', () => apiRequest(`/staff/${s.id}/active`, { method: 'PATCH' }), 'Staff info (AccountStatus) has been updated successfully!');
    if (ok) setActive((a) => !a);
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#E5E7EB' }}>
      <BackHeader title={s.fullName} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24, gap: 10 }} keyboardShouldPersistTaps="handled">
          <View style={formStyles.card}>
            <Text style={formStyles.label}>Password</Text>
            <TextInput value={password} onChangeText={setPassword} autoCapitalize="none" autoCorrect={false} style={formStyles.input} />
            <Button label="UPDATE STAFF PASSWORD" busy={busy === 'PASSWORD'} onPress={savePassword} />
          </View>

          <View style={formStyles.card}>
            <View style={formStyles.two}>
              <View style={{ flex: 1 }}><Text style={formStyles.label}>Roles</Text><PickBox value={role} onPress={() => setPick('ROLE')} /></View>
              <View style={{ flex: 1 }}><Text style={formStyles.label}>StaffWorkMode</Text><PickBox value={wMode} onPress={() => setPick('WMODE')} /></View>
            </View>
            <Text style={formStyles.label}>Agent</Text>
            <PickBox value={agent} onPress={() => setPick('AGENT')} />
            <View style={formStyles.two}>
              <View style={{ flex: 1 }}><Text style={formStyles.label}>Mobile</Text><TextInput value={mobile} onChangeText={setMobile} keyboardType="phone-pad" style={formStyles.input} /></View>
              <View style={{ flex: 1 }}><Text style={formStyles.label}>Address</Text><TextInput value={address} onChangeText={setAddress} autoCapitalize="characters" style={formStyles.input} /></View>
            </View>
            <Button label="UPDATE STAFF INFO" busy={busy === 'INFO'} onPress={saveInfo} />
          </View>

          <View style={[formStyles.card, { paddingVertical: 26 }]}>
            <Button label={`ACCOUNT STATUS | ${active ? 'ACTIVATE NOW' : 'DEACTIVATE NOW'}`} busy={busy === 'ACTIVE'} onPress={() => { void toggleActive(); }} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      <OptionModal pick={pick} options={options} loading={pick === 'AGENT' && loadingAgents} onClose={() => setPick(null)} onPick={(v) => {
        if (pick === 'ROLE') setRole(v); else if (pick === 'WMODE') setWMode(v); else setAgent(v);
        setPick(null);
      }} />
    </View>
  );
}

// ---- Add -------------------------------------------------------------------------------------------
export function AddStaffScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { pick, setPick, options, loadingAgents } = usePickers();
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('DATA ENTRY OPERATOR');
  const [wMode, setWMode] = useState('NONE');
  const [agent, setAgent] = useState('');
  const [mobile, setMobile] = useState('');
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim() || !username.trim() || !password.trim()) {
      failure();
      Alert.alert('Invalid', 'Please enter all valid fields!');
      return;
    }
    if (!strong(password.trim())) { weakPassword(); return; }
    setSaving(true);
    try {
      await apiRequest('/staff', {
        method: 'POST',
        body: {
          fullName: name.trim().toUpperCase(),
          role,
          designation: role,
          wMode,
          username: username.replace(/\s+/g, '').toUpperCase() || 'NONE',
          password: password.trim(),
          agent: agent.trim().toUpperCase(),
          mobile: mobile.trim(),
          address: address.trim().toUpperCase(),
        },
      });
      success();
      Alert.alert('Success', 'Staff has been saved successfully!');
      navigation.goBack();
    } catch (err) {
      failure();
      Alert.alert('Message', errorMessage(err, 'Failed to save staff member'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#E5E7EB' }}>
      <BackHeader title="Add Staff" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24 }} keyboardShouldPersistTaps="handled">
          <View style={formStyles.card}>
            <Text style={formStyles.label}>Staff Name</Text>
            <TextInput value={name} onChangeText={setName} autoCapitalize="characters" autoCorrect={false} style={formStyles.input} />
            <View style={formStyles.two}>
              <View style={{ flex: 1 }}><Text style={formStyles.label}>Username</Text><TextInput value={username} onChangeText={setUsername} autoCapitalize="characters" autoCorrect={false} style={formStyles.input} /></View>
              <View style={{ flex: 1 }}><Text style={formStyles.label}>Password</Text><TextInput value={password} onChangeText={setPassword} autoCapitalize="none" autoCorrect={false} style={formStyles.input} /></View>
            </View>
            <View style={formStyles.two}>
              <View style={{ flex: 1 }}><Text style={formStyles.label}>Roles</Text><PickBox value={role} onPress={() => setPick('ROLE')} /></View>
              <View style={{ flex: 1 }}><Text style={formStyles.label}>StaffWorkMode</Text><PickBox value={wMode} onPress={() => setPick('WMODE')} /></View>
            </View>
            <Text style={formStyles.label}>Agent</Text>
            <PickBox value={agent} onPress={() => setPick('AGENT')} />
            <View style={formStyles.two}>
              <View style={{ flex: 1 }}><Text style={formStyles.label}>Mobile</Text><TextInput value={mobile} onChangeText={setMobile} keyboardType="phone-pad" style={formStyles.input} /></View>
              <View style={{ flex: 1 }}><Text style={formStyles.label}>Address</Text><TextInput value={address} onChangeText={setAddress} autoCapitalize="characters" style={formStyles.input} /></View>
            </View>
            <Button label="ADD STAFF" busy={saving} onPress={() => { void save(); }} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      <OptionModal pick={pick} options={options} loading={pick === 'AGENT' && loadingAgents} onClose={() => setPick(null)} onPick={(v) => {
        if (pick === 'ROLE') setRole(v); else if (pick === 'WMODE') setWMode(v); else setAgent(v);
        setPick(null);
      }} />
    </View>
  );
}

// ---- shared ------------------------------------------------------------------------------------
export function PickBox({ value, onPress }: { value: string; onPress: () => void }) {
  return (
    <Pressable onPress={() => { tap(); onPress(); }} style={[formStyles.input, { justifyContent: 'center' }]}>
      <Text style={formStyles.pickText} numberOfLines={1}>{value}</Text>
    </Pressable>
  );
}

export function Button({ label, busy, onPress }: { label: string; busy: boolean; onPress: () => void }) {
  return (
    <Pressable disabled={busy} onPress={() => { tap(); onPress(); }} style={({ pressed }) => [formStyles.button, (pressed || busy) && { opacity: 0.85 }]}>
      {busy ? <ActivityIndicator color={colors.white} /> : <Text style={formStyles.buttonText}>{label}</Text>}
    </Pressable>
  );
}

function OptionModal({ pick, options, loading, onClose, onPick }: { pick: Pick; options: string[]; loading: boolean; onClose: () => void; onPick: (v: string) => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={pick !== null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={formStyles.backdrop} onPress={onClose}>
        <View style={[formStyles.menu, pick === 'AGENT' ? { flex: 1, marginTop: insets.top + 80, marginBottom: insets.bottom + 40 } : { marginTop: 200 }]}>
          {loading && <ActivityIndicator color={colors.navy} style={{ margin: 16 }} />}
          <FlatList
            data={options}
            keyExtractor={(n, i) => `${n}-${i}`}
            renderItem={({ item }) => (
              <Pressable onPress={() => { tap(); onPick(item); }} style={({ pressed }) => [formStyles.menuItem, pressed && { backgroundColor: colors.canvas }]}>
                <Text style={formStyles.menuText} numberOfLines={1}>{item || 'NONE'}</Text>
              </Pressable>
            )}
          />
        </View>
      </Pressable>
    </Modal>
  );
}

export const formStyles = StyleSheet.create({
  card: { backgroundColor: colors.surface, paddingHorizontal: 18, paddingVertical: 20 },
  label: { fontSize: 15, color: '#666', marginBottom: 6 },
  input: { borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.lg, paddingHorizontal: 12, height: 46, fontSize: 17, fontWeight: '700', color: '#0F3B12', backgroundColor: colors.surface, marginBottom: 14 },
  pickText: { fontSize: 17, color: colors.text, fontWeight: '500', textTransform: 'uppercase' },
  two: { flexDirection: 'row', gap: 10 },
  button: { backgroundColor: colors.navy, borderRadius: radius.sm, height: 48, alignItems: 'center', justifyContent: 'center', marginTop: 4, ...shadow },
  buttonText: { color: colors.white, fontSize: 16, fontWeight: '500', letterSpacing: 0.3 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center' },
  menu: { width: '78%', backgroundColor: colors.surface, borderRadius: 4, ...shadow, elevation: 10 },
  menuItem: { paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.divider },
  menuText: { fontSize: 16, color: colors.text, textTransform: 'uppercase' },
});

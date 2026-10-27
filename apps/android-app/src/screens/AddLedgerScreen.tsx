import { useNavigation } from '@react-navigation/native';
import React, { useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiRequest, errorMessage } from '../api/client';
import type { Agent } from '../api/types';
import { BackHeader } from '../components/BackHeader';
import { FieldLabel, FormField, PrimaryButton, SelectField } from '../components/Controls';
import { LEDGER_GROUPS } from '../constants';
import { useApiList } from '../hooks/useApiList';
import { colors } from '../theme';
import { failure, success } from '../utils/haptics';

// Add Ledger — POST /ledgers with the same fields the web Add form sends (party name, group,
// agent, rates, commission, mobile …). The server validates and creates the party.
export function AddLedgerScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const agents = useApiList<Agent>('/agents');

  const [partyName, setPartyName] = useState('');
  const [realName, setRealName] = useState('');
  const [groupName, setGroupName] = useState('Fanter');
  const [agentName, setAgentName] = useState('');
  const [daraRate, setDaraRate] = useState('90');
  const [akharRate, setAkharRate] = useState('9');
  const [commission, setCommission] = useState('10');
  const [mobile, setMobile] = useState('');
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const agentOptions = useMemo(
    () => agents.data.map((a) => ({ value: a.agentName, label: a.agentName })).sort((a, b) => a.label.localeCompare(b.label)),
    [agents.data],
  );
  const needsAgent = groupName === 'Fanter' || groupName === 'Distributor';

  const save = async () => {
    setError(null);
    const name = partyName.trim().toUpperCase();
    const dara = parseFloat(daraRate);
    const akhar = parseFloat(akharRate);
    const comm = parseFloat(commission || '0');
    if (name.length < 2) { setError('Please enter valid Party Name!'); failure(); return; }
    if (needsAgent && !agentName) { setError('Please Enter valid Agent!'); failure(); return; }
    if (!(dara > 0) || !(akhar > 0)) { setError('Please enter valid Rate!'); failure(); return; }
    if (isNaN(comm) || comm < 0 || comm > 100) { setError('Please enter valid Commission!'); failure(); return; }
    setSaving(true);
    try {
      await apiRequest('/ledgers', {
        method: 'POST',
        body: {
          partyName: name,
          realName: realName.trim() || undefined,
          // 8-digit login user name, generated as the web form does
          userName: Math.floor(10000000 + Math.random() * 90000000).toString(),
          groupName,
          agentName: agentName || undefined,
          mobile: mobile.trim() || undefined,
          address: address.trim() || undefined,
          daraRate: dara,
          akharRate: akhar,
          commissionRate: comm,
          hasLimit: false,
          isRisky: false,
        },
      });
      success();
      Alert.alert('Message', 'Ledger has been saved successfully!');
      navigation.goBack();
    } catch (err) {
      failure();
      setError(errorMessage(err, 'Failed to create ledger'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <BackHeader title="Add Ledger" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: insets.bottom + 24 }} keyboardShouldPersistTaps="handled">
          {!!error && <Text style={styles.error}>{error}</Text>}
          <FormField label="Party Name" value={partyName} onChangeText={setPartyName} placeholder="PARTY NAME" />
          <FormField label="Real Name" value={realName} onChangeText={setRealName} placeholder="REAL NAME" />
          <View style={styles.field}>
            <FieldLabel>Group</FieldLabel>
            <View style={styles.row}>
              <SelectField title="Group" value={groupName} onChange={setGroupName} placeholder="GROUP" options={LEDGER_GROUPS.map((g) => ({ value: g, label: g }))} />
            </View>
          </View>
          <View style={styles.field}>
            <FieldLabel>Agent</FieldLabel>
            <View style={styles.row}>
              <SelectField title="Agent" value={agentName} onChange={setAgentName} placeholder={agents.loading ? 'LOADING...' : 'SELECT AGENT'} options={agentOptions} />
            </View>
          </View>
          <View style={styles.row}>
            <View style={{ flex: 1 }}><FormField label="Dara Rate" value={daraRate} onChangeText={setDaraRate} keyboardType="decimal-pad" /></View>
            <View style={{ flex: 1 }}><FormField label="Akhar Rate" value={akharRate} onChangeText={setAkharRate} keyboardType="decimal-pad" /></View>
            <View style={{ flex: 1 }}><FormField label="Comm %" value={commission} onChangeText={setCommission} keyboardType="decimal-pad" /></View>
          </View>
          <FormField label="Mobile" value={mobile} onChangeText={setMobile} keyboardType="phone-pad" placeholder="MOBILE" />
          <FormField label="Address" value={address} onChangeText={setAddress} placeholder="ADDRESS" />
          <PrimaryButton label="SAVE LEDGER" onPress={save} loading={saving} style={{ marginTop: 6 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  error: { color: colors.crimson, fontWeight: '700', marginBottom: 12, fontSize: 14 },
  field: { marginBottom: 14 },
  row: { flexDirection: 'row', gap: 10 },
});

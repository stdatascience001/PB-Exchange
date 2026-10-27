import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiRequest, errorMessage } from '../api/client';
import type { Agent, Ledger } from '../api/types';
import { BackHeader } from '../components/BackHeader';
import { useApiList } from '../hooks/useApiList';
import type { RootStackParamList } from '../navigation/types';
import { colors, radius, shadow } from '../theme';
import { failure, success, tap } from '../utils/haptics';

// UPDATE AGENT GROUP (live app: Agent Groups → tap a row): Main Agent (cash agent), Parent Agent
// (optional), Group Name, "Update Agent Group". Saves with PUT /agents/:id — the same call and
// fields as the web Agents page's edit (name upper-cased, Main Agent defaulting to VIKAS CASH).
export function UpdateAgentGroupScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { params } = useRoute<RouteProp<RootStackParamList, 'UpdateAgentGroup'>>();
  const cashAgents = useApiList<Ledger>('/ledgers?group=Cash%20Agent');
  const agents = useApiList<Agent>('/agents');

  // a group with no main agent on record starts on VIKAS CASH — the default the web edit saves
  const [mainAgent, setMainAgent] = useState(params.mainAgentName || 'VIKAS CASH');
  const [parentAgent, setParentAgent] = useState(params.parentAgentName || '');
  const [groupName, setGroupName] = useState(params.agentName || '');
  const [picker, setPicker] = useState<'MAIN' | 'PARENT' | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!groupName.trim()) {
      failure();
      Alert.alert('Invalid', 'Please enter all valid fields!');
      return;
    }
    setSaving(true);
    try {
      await apiRequest(`/agents/${params.id}`, {
        method: 'PUT',
        body: {
          agentName: groupName.trim().toUpperCase(),
          mainAgentName: mainAgent.trim().toUpperCase() || 'VIKAS CASH',
          parentAgentName: parentAgent.trim().toUpperCase() || '',
        },
      });
      success();
      Alert.alert('Message', 'Agent Group has been updated successfully!');
      navigation.goBack();
    } catch (err) {
      failure();
      Alert.alert('Message', errorMessage(err, 'Failed to update agent group'));
    } finally {
      setSaving(false);
    }
  };

  const options = useMemo(() => {
    if (picker === 'MAIN') return cashAgents.data.map((l) => l.partyName).sort((a, b) => a.localeCompare(b));
    if (picker === 'PARENT') return ['', ...agents.data.map((a) => a.agentName).filter((n) => n !== params.agentName).sort((a, b) => a.localeCompare(b))];
    return [];
  }, [picker, cashAgents.data, agents.data, params.agentName]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <BackHeader title="Update Agent Group" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Main Agent</Text>
          <Pressable onPress={() => { tap(); setPicker('MAIN'); }} style={styles.input}>
            <Text style={styles.value} numberOfLines={1}>{mainAgent}</Text>
          </Pressable>

          <Text style={styles.label}>Parent Agent</Text>
          <Pressable onPress={() => { tap(); setPicker('PARENT'); }} style={styles.input}>
            <Text style={styles.value} numberOfLines={1}>{parentAgent}</Text>
          </Pressable>

          <Text style={styles.label}>Group Name</Text>
          <TextInput value={groupName} onChangeText={setGroupName} autoCapitalize="characters" autoCorrect={false} style={[styles.input, styles.value]} />

          <Pressable disabled={saving} onPress={() => { tap(); void save(); }} style={({ pressed }) => [styles.button, (pressed || saving) && { backgroundColor: colors.navyDark }]}>
            {saving ? <ActivityIndicator color={colors.white} /> : <Text style={styles.buttonText}>Update Agent Group</Text>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={picker !== null} transparent animationType="fade" onRequestClose={() => setPicker(null)}>
        <Pressable style={styles.backdrop} onPress={() => setPicker(null)}>
          <View style={[styles.menu, { marginTop: insets.top + 80, marginBottom: insets.bottom + 40 }]}>
            {(picker === 'MAIN' ? cashAgents.loading : agents.loading) && <ActivityIndicator color={colors.navy} style={{ margin: 16 }} />}
            <FlatList
              data={options}
              keyExtractor={(n, i) => `${n}-${i}`}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => { tap(); if (picker === 'MAIN') setMainAgent(item); else setParentAgent(item); setPicker(null); }}
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

const styles = StyleSheet.create({
  form: { paddingHorizontal: 44, paddingTop: 48, paddingBottom: 32 },
  label: { fontSize: 17, color: '#8A8A8A', marginBottom: 8, marginLeft: 4 },
  input: { borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.lg, paddingHorizontal: 12, height: 52, justifyContent: 'center', marginBottom: 26, backgroundColor: colors.surface },
  value: { fontSize: 20, fontWeight: '700', color: '#0F3B12', textTransform: 'uppercase' },
  button: { backgroundColor: colors.navy, borderRadius: radius.sm, height: 54, alignItems: 'center', justifyContent: 'center', marginTop: 2, ...shadow },
  buttonText: { color: colors.white, fontSize: 18, fontWeight: '500' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center' },
  menu: { flex: 1, width: '78%', backgroundColor: colors.surface, borderRadius: 4, ...shadow, elevation: 10 },
  menuItem: { paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.divider },
  menuText: { fontSize: 16, color: colors.text, textTransform: 'uppercase' },
});

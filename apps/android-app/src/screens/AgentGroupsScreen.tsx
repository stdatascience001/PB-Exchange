import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiRequest, errorMessage } from '../api/client';
import type { Agent, Ledger } from '../api/types';
import { BackHeader } from '../components/BackHeader';
import { BottomActionBar, CenterMessage, FieldLabel, FormField, PrimaryButton, SearchBox, SelectField } from '../components/Controls';
import { ListRow } from '../components/ListRow';
import { useApiList } from '../hooks/useApiList';
import { colors } from '../theme';
import { dmyTime } from '../utils/format';
import { failure, success } from '../utils/haptics';

// AGENT GROUPS (live app): search, then each agent — name, its main (cash) agent and parent agent
// in amber; who updated it and when on the right. ADD AGENT GROUP: POST /agents as the web form.
// Tap a row: UPDATE AGENT GROUP (PUT /agents/:id); the list reloads on coming back.
export function AgentGroupsScreen() {
  const navigation = useNavigation<any>();
  const agents = useApiList<Agent>('/agents');
  const firstFocus = useRef(true);
  useFocusEffect(useCallback(() => {
    if (firstFocus.current) { firstFocus.current = false; return; }
    void agents.reload();
  }, [agents.reload]));
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);

  const list = useMemo(() => {
    const t = search.trim().toUpperCase();
    const sorted = [...agents.data].sort((a, b) => a.agentName.localeCompare(b.agentName));
    return t ? sorted.filter((a) => a.agentName.toUpperCase().includes(t)) : sorted;
  }, [agents.data, search]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <BackHeader title="Agent Groups" />
      <SearchBox value={search} onChangeText={setSearch} placeholder="SEARCH AGENT GROUPS..." />
      <View style={styles.sep} />
      <FlatList
        data={list}
        keyExtractor={(a) => String(a.id)}
        initialNumToRender={15}
        removeClippedSubviews
        refreshControl={<RefreshControl refreshing={agents.refreshing} onRefresh={agents.refresh} colors={[colors.navy]} />}
        ListEmptyComponent={<CenterMessage loading={agents.loading} text={agents.error || 'No agent groups found'} />}
        contentContainerStyle={list.length === 0 ? { flexGrow: 1 } : undefined}
        renderItem={({ item, index }) => (
          <ListRow
            index={index + 1}
            title={item.agentName}
            tag={item.mainAgentName || ''}
            tagColor={colors.amber}
            code={item.parentAgentName || ''}
            codeColor={colors.amber}
            rightTop={item.updatedBy || ''}
            rightBottom={dmyTime(item.updatedAt || item.createdAt)}
            onPress={() => navigation.navigate('UpdateAgentGroup', { id: item.id, agentName: item.agentName, mainAgentName: item.mainAgentName, parentAgentName: item.parentAgentName })}
          />
        )}
      />
      <BottomActionBar title="ADD AGENT GROUP" subtitle="CLICK HERE TO ADD NEW GROUP" onPress={() => setAdding(true)} />
      <AddAgentModal visible={adding} agents={agents.data} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); void agents.reload(); }} />
    </View>
  );
}

function AddAgentModal({ visible, agents, onClose, onSaved }: { visible: boolean; agents: Agent[]; onClose: () => void; onSaved: () => void }) {
  const insets = useSafeAreaInsets();
  // Main agent = a Cash Agent ledger (same list the web form offers)
  const cashAgents = useApiList<Ledger>(visible ? '/ledgers?group=Cash%20Agent' : null);
  const [name, setName] = useState('');
  const [mainAgent, setMainAgent] = useState('');
  const [parentAgent, setParentAgent] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => { setName(''); setMainAgent(''); setParentAgent(''); setError(null); onClose(); };

  const save = async () => {
    setError(null);
    if (!name.trim()) { setError('Please enter valid Agent Name!'); failure(); return; }
    setSaving(true);
    try {
      await apiRequest('/agents', {
        method: 'POST',
        body: { agentName: name.trim().toUpperCase(), mainAgentName: mainAgent || 'VIKAS CASH', parentAgentName: parentAgent || '' },
      });
      success();
      Alert.alert('Message', 'Agent Group has been saved successfully!');
      setName(''); setMainAgent(''); setParentAgent('');
      onSaved();
    } catch (err) {
      failure();
      setError(errorMessage(err, 'Failed to save agent'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>Add Agent Group</Text>
            <Pressable hitSlop={12} onPress={close}><MaterialIcons name="close" size={24} color={colors.text} /></Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled">
            {!!error && <Text style={styles.error}>{error}</Text>}
            <FormField label="Agent Name" value={name} onChangeText={setName} placeholder="AGENT NAME" />
            <FieldLabel>Main Agent (Cash Agent)</FieldLabel>
            <View style={styles.selectRow}>
              <SelectField
                title="Main Agent"
                value={mainAgent}
                onChange={setMainAgent}
                placeholder="VIKAS CASH"
                options={cashAgents.data.map((l) => ({ value: l.partyName, label: l.partyName }))}
              />
            </View>
            <FieldLabel>Parent Agent</FieldLabel>
            <View style={styles.selectRow}>
              <SelectField
                title="Parent Agent"
                value={parentAgent}
                onChange={setParentAgent}
                placeholder="NONE"
                options={[{ value: '', label: 'NONE' }, ...agents.map((a) => ({ value: a.agentName, label: a.agentName }))]}
              />
            </View>
            <PrimaryButton label="SAVE AGENT GROUP" onPress={save} loading={saving} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sep: { height: 1, backgroundColor: colors.border },
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 20, maxHeight: '85%' },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  sheetTitle: { fontSize: 20, fontWeight: '700', color: colors.navy },
  error: { color: colors.crimson, fontWeight: '600', marginBottom: 12 },
  selectRow: { flexDirection: 'row', marginBottom: 14 },
});

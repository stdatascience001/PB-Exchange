import { useFocusEffect, useNavigation } from '@react-navigation/native';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import type { Agent, Ledger } from '../api/types';
import { BackHeader } from '../components/BackHeader';
import { BottomActionBar, CenterMessage, FindButton, SearchBox, SelectField } from '../components/Controls';
import { ListRow } from '../components/ListRow';
import { LEDGER_GROUPS } from '../constants';
import { useApiList } from '../hooks/useApiList';
import { colors } from '../theme';
import { dmyTime, rateStr } from '../utils/format';

// ALL LEDGERS (live app): Agent / Group filters + FIND, "Search Party..", then one row per party —
// name, group (cyan), rate, user name (orange); on the right who added it and when.
export function LedgersScreen() {
  const navigation = useNavigation<any>();
  const ledgers = useApiList<Ledger>('/ledgers');
  const agents = useApiList<Agent>('/agents');

  const [agentId, setAgentId] = useState('');
  const [group, setGroup] = useState('');
  // FIND applies the two dropdowns (as live); the search box filters as you type
  const [applied, setApplied] = useState({ agentId: '', group: '' });
  const [search, setSearch] = useState('');

  // Coming back from Add / Update Ledger: reload so the change shows
  const firstFocus = useRef(true);
  useFocusEffect(useCallback(() => {
    if (firstFocus.current) { firstFocus.current = false; return; }
    void ledgers.reload();
  }, [ledgers.reload]));

  const agentOptions = useMemo(
    () => [{ value: '', label: 'ALL AGENTS' }, ...agents.data
      .map((a) => ({ value: String(a.id), label: a.agentName }))
      .sort((a, b) => a.label.localeCompare(b.label))],
    [agents.data],
  );
  const groupOptions = useMemo(() => [{ value: '', label: '-ALL GROUP-' }, ...LEDGER_GROUPS.map((g) => ({ value: g, label: g }))], []);

  const list = useMemo(() => {
    const term = search.trim().toUpperCase();
    // A–Z by party name, as the live list
    return [...ledgers.data].sort((a, b) => a.partyName.localeCompare(b.partyName)).filter((l) =>
      (!applied.agentId || String(l.agentId ?? '') === applied.agentId) &&
      (!applied.group || (l.groupName || 'Fanter').toUpperCase() === applied.group.toUpperCase()) &&
      (!term || l.partyName.toUpperCase().includes(term) || String(l.userName || '').includes(term) || String(l.realName || '').toUpperCase().includes(term)),
    );
  }, [ledgers.data, applied, search]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <BackHeader title="All Ledgers" />
      <View style={styles.filters}>
        <SelectField title="Agent" value={agentId} options={agentOptions} onChange={setAgentId} placeholder="ALL AGENTS" />
        <SelectField title="Group" value={group} options={groupOptions} onChange={setGroup} placeholder="-ALL GROUP-" />
        <FindButton onPress={() => setApplied({ agentId, group })} />
      </View>
      <SearchBox value={search} onChangeText={setSearch} placeholder="Search Party.." />
      <View style={styles.sep} />
      <FlatList
        data={list}
        keyExtractor={(l) => String(l.id)}
        initialNumToRender={15}
        maxToRenderPerBatch={20}
        windowSize={11}
        removeClippedSubviews
        refreshControl={<RefreshControl refreshing={ledgers.refreshing} onRefresh={ledgers.refresh} colors={[colors.navy]} />}
        ListEmptyComponent={<CenterMessage loading={ledgers.loading} text={ledgers.error || 'No ledgers found'} onRetry={ledgers.error ? () => ledgers.reload() : undefined} />}
        contentContainerStyle={list.length === 0 ? { flexGrow: 1 } : undefined}
        renderItem={({ item, index }) => (
          <ListRow
            index={index + 1}
            title={item.partyName}
            titleColor={item.isLocked ? colors.crimson : undefined}
            tag={item.groupName || 'Fanter'}
            middle={rateStr(item)}
            code={item.userName || ''}
            rightTop={item.addedBy || item.updatedBy || ''}
            rightBottom={dmyTime(item.createdAt || item.updatedAt)}
            onPress={() => navigation.navigate('UpdateLedger', { id: item.id })}
          />
        )}
      />
      <BottomActionBar title="ADD LEDGER" subtitle="CLICK HERE TO ADD NEW LEDGER" onPress={() => navigation.navigate('AddLedger')} />
    </View>
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', gap: 8, paddingHorizontal: 10, paddingTop: 12 },
  sep: { height: 1, backgroundColor: colors.border },
});

import { useFocusEffect, useNavigation } from '@react-navigation/native';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import type { Staff } from '../api/types';
import { BackHeader } from '../components/BackHeader';
import { BottomActionBar, CenterMessage, SearchBox } from '../components/Controls';
import { ListRow } from '../components/ListRow';
import { useApiList } from '../hooks/useApiList';
import { colors } from '../theme';
import { dmyTime } from '../utils/format';

// ALL STAFFS (live app): name (red when deactivated), role (cyan), login / party (amber),
// address; who updated the account and when on the right. Tap a staff: update it; ADD STAFF:
// a new one. The list reloads on coming back.
const HIDDEN_STAFF_ROLES = ['SUPER ADMIN', 'DEVELOPER'];

export function StaffsScreen() {
  const navigation = useNavigation<any>();
  const staff = useApiList<Staff>('/staff');
  const firstFocus = useRef(true);
  useFocusEffect(useCallback(() => {
    if (firstFocus.current) { firstFocus.current = false; return; }
    void staff.reload();
  }, [staff.reload]));
  const [search, setSearch] = useState('');

  // As the website's Staff List: SUPER ADMIN and DEVELOPER accounts are left out (display only —
  // the accounts themselves are untouched), before the search so they can't be searched into view
  const list = useMemo(() => {
    const t = search.trim().toUpperCase();
    const shown = staff.data.filter((s) => !HIDDEN_STAFF_ROLES.includes(String(s.role || s.designation || '').trim().toUpperCase()));
    return t
      ? shown.filter((s) => [s.fullName, s.username, s.role, s.partyName].some((v) => String(v || '').toUpperCase().includes(t)))
      : shown;
  }, [staff.data, search]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <BackHeader title="All Staffs" />
      <SearchBox value={search} onChangeText={setSearch} placeholder="Search Staff.." />
      <View style={styles.sep} />
      <FlatList
        data={list}
        keyExtractor={(s) => String(s.id)}
        initialNumToRender={15}
        removeClippedSubviews
        refreshControl={<RefreshControl refreshing={staff.refreshing} onRefresh={staff.refresh} colors={[colors.navy]} />}
        ListEmptyComponent={<CenterMessage loading={staff.loading} text={staff.error || 'No staff found'} />}
        contentContainerStyle={list.length === 0 ? { flexGrow: 1 } : undefined}
        renderItem={({ item, index }) => (
          <ListRow
            index={index + 1}
            title={item.fullName}
            titleColor={item.isActive === false ? colors.crimson : undefined}
            tag={item.role}
            middle={item.address || ''}
            code={item.username || item.partyName || ''}
            rightTop={item.updatedBy || ''}
            rightBottom={dmyTime(item.updatedAt || item.createdAt)}
            onPress={() => navigation.navigate('UpdateStaff', { staff: item })}
          />
        )}
      />
      <BottomActionBar title="ADD STAFF" subtitle="CLICK HERE TO ADD NEW STAFF" onPress={() => navigation.navigate('AddStaff')} />
    </View>
  );
}

const styles = StyleSheet.create({ sep: { height: 1, backgroundColor: colors.border } });

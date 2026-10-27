import { useFocusEffect, useNavigation } from '@react-navigation/native';
import React, { useCallback, useRef } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import type { Shift } from '../api/types';
import { BackHeader } from '../components/BackHeader';
import { BottomActionBar, CenterMessage } from '../components/Controls';
import { ListRow } from '../components/ListRow';
import { useApiList } from '../hooks/useApiList';
import { colors } from '../theme';
import { dmy, dmyTime } from '../utils/format';

// ALL SHIFTS (live app): name (red when disabled), shift-for (cyan), its open date, next-day
// flag (amber YES / NO); who updated it and when on the right. Tap a shift: its role cut-off
// times; long-press: its name / date / next day / working-for; ADD SHIFT: a new one. The list
// reloads on coming back.
export function ShiftsScreen() {
  const navigation = useNavigation<any>();
  const shifts = useApiList<Shift>('/shifts');
  const firstFocus = useRef(true);
  useFocusEffect(useCallback(() => {
    if (firstFocus.current) { firstFocus.current = false; return; }
    void shifts.reload();
  }, [shifts.reload]));
  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <BackHeader title="All Shifts" />
      <FlatList
        data={shifts.data}
        keyExtractor={(s) => String(s.id)}
        refreshControl={<RefreshControl refreshing={shifts.refreshing} onRefresh={shifts.refresh} colors={[colors.navy]} />}
        ListEmptyComponent={<CenterMessage loading={shifts.loading} text={shifts.error || 'No shifts found'} />}
        contentContainerStyle={shifts.data.length === 0 ? { flexGrow: 1 } : { paddingBottom: 8 }}
        renderItem={({ item, index }) => (
          <ListRow
            index={index + 1}
            title={item.name}
            titleColor={item.isActive === false ? colors.crimson : undefined}
            tag={(item.shiftFor || 'Both').toUpperCase()}
            middle={dmy(item.openDate)}
            code={item.isNextDay ? 'YES' : 'NO'}
            rightTop={item.updatedBy || ''}
            rightBottom={dmyTime(item.updatedAt || item.createdAt)}
            onPress={() => navigation.navigate('UpdateShift', { shift: item })}
            onLongPress={() => navigation.navigate('AddShift', { shift: item })}
          />
        )}
      />
      <BottomActionBar title="ADD SHIFT" subtitle="CLICK HERE TO ADD NEW SHIFT" onPress={() => navigation.navigate('AddShift')} />
    </View>
  );
}

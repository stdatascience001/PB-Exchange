import { MaterialCommunityIcons } from '@expo/vector-icons';
import { DrawerContentComponentProps, DrawerContentScrollView } from '@react-navigation/drawer';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { canOpenRoute } from '../config/roleAccess';
import { useAuth } from '../store/auth';
import { colors } from '../theme';
import { tap } from '../utils/haptics';

// ≡ menu: who is signed in, every screen of the app the role may open (website rules), and Logout
const ITEMS: Array<{ label: string; icon: keyof typeof MaterialCommunityIcons.glyphMap; route: string; params?: object; tab?: string }> = [
  { label: 'Dashboard', icon: 'monitor-dashboard', route: 'Tabs', tab: 'Dashboard' },
  { label: 'Staff Working', icon: 'account-hard-hat', route: 'StaffWorking' },
  { label: 'Ledger Management', icon: 'account-circle-outline', route: 'Ledgers' },
  { label: 'Agent Groups', icon: 'account-group-outline', route: 'AgentGroups' },
  { label: 'Payment Transfer', icon: 'credit-card-outline', route: 'Vouchers', params: { type: 'JOURNAL' } },
  { label: 'Limit Transfer', icon: 'cash-multiple', route: 'Vouchers', params: { type: 'LIMIT' } },
  { label: 'Voucher Audit / Verify', icon: 'file-check-outline', route: 'VoucherAudit' },
  { label: 'Staff Management', icon: 'badge-account-outline', route: 'Staffs' },
  { label: 'Shift Management', icon: 'clipboard-clock-outline', route: 'Shifts' },
  { label: 'Prediction Report', icon: 'chart-line', route: 'Prediction' },
  { label: 'Daily Report', icon: 'file-chart-outline', route: 'DailyReport' },
  { label: 'All Shifts Report', icon: 'file-table-outline', route: 'AllShiftReport' },
  { label: 'Profit Loss Report', icon: 'finance', route: 'ProfitLoss' },
  { label: 'Admin Cash Report', icon: 'cash-register', route: 'AdminCash' },
  { label: 'All Outstanding Report', icon: 'scale-balance', route: 'Outstanding' },
  { label: 'Agent Outstanding Report', icon: 'account-cash-outline', route: 'AgentOutstanding' },
  { label: 'Voucher List', icon: 'file-document-outline', route: 'VoucherReport' },
  { label: 'Cash Agent Report', icon: 'account-cash', route: 'CashAgentReport' },
  { label: 'Paid Vapsi Report', icon: 'cash-refund', route: 'PaidVapsi' },
  { label: 'Payroll Salary Register', icon: 'account-cash-outline', route: 'SalaryRegister' },
  { label: 'Paid Hp Report', icon: 'hand-coin-outline', route: 'PaidHp' },
  { label: 'Limit Balance Report', icon: 'speedometer', route: 'LimitBalance' },
  { label: 'Result Report', icon: 'trophy-outline', route: 'ResultReport' },
  { label: 'Productivity Report', icon: 'account-clock-outline', route: 'Productivity' },
  { label: 'Messages', icon: 'chat-outline', route: 'Tabs', tab: 'Chat' },
  { label: 'Profile', icon: 'account-cog-outline', route: 'Profile' },
];

export function DrawerContent(props: DrawerContentComponentProps) {
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);

  const go = (item: (typeof ITEMS)[number]) => {
    tap();
    props.navigation.closeDrawer();
    if (item.tab) props.navigation.navigate('Tabs', { screen: item.tab });
    else props.navigation.getParent()?.navigate(item.route, item.params);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={styles.head}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{(user?.username || '?').charAt(0).toUpperCase()}</Text></View>
        <Text style={styles.name} numberOfLines={1}>{(user?.username || '').toUpperCase()}</Text>
        <Text style={styles.role}>{(user?.roleName || '').toUpperCase()}</Text>
      </View>
      <DrawerContentScrollView {...props} contentContainerStyle={{ paddingTop: 8 }}>
        {ITEMS.filter((item) => item.tab || canOpenRoute(user?.roleName, item.route, item.params)).map((item) => (
          <Pressable key={item.label} onPress={() => go(item)} style={({ pressed }) => [styles.item, pressed && { backgroundColor: colors.canvas }]}>
            <MaterialCommunityIcons name={item.icon} size={22} color={colors.navy} />
            <Text style={styles.itemText}>{item.label}</Text>
          </Pressable>
        ))}
        <Pressable onPress={() => { tap(); void logout(); }} style={({ pressed }) => [styles.item, pressed && { backgroundColor: colors.canvas }]}>
          <MaterialCommunityIcons name="logout" size={22} color={colors.crimson} />
          <Text style={[styles.itemText, { color: colors.crimson }]}>Logout</Text>
        </Pressable>
      </DrawerContentScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { backgroundColor: colors.navy, paddingTop: 56, paddingBottom: 20, paddingHorizontal: 20 },
  avatar: { width: 58, height: 58, borderRadius: 29, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  avatarText: { color: colors.navy, fontSize: 26, fontWeight: '800' },
  name: { color: colors.white, fontSize: 20, fontWeight: '700' },
  role: { color: '#AFC0DA', fontSize: 13, fontWeight: '600', marginTop: 2 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, paddingVertical: 13 },
  itemText: { fontSize: 15, color: colors.text, fontWeight: '500' },
});

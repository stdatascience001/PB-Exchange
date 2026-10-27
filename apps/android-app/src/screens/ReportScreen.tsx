import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { canOpenRoute } from '../config/roleAccess';
import { useAuth } from '../store/auth';
import { colors, radius, shadow } from '../theme';
import { tap } from '../utils/haptics';

// Reports (live app): one card per report — receipt icon, name, chevron; only the reports the
// signed-in role may open (website role rules)
const REPORTS = [
  { route: 'Prediction', title: 'Prediction Report' },
  { route: 'DailyReport', title: 'Daily Report' },
  { route: 'AllShiftReport', title: 'All Shifts Report' },
  { route: 'ProfitLoss', title: 'Profit Loss Report' },
  { route: 'AdminCash', title: 'Admin Cash Report' },
  { route: 'Outstanding', title: 'All Outstanding Report' },
  { route: 'AgentOutstanding', title: 'Agent Outstanding Report' },
  { route: 'VoucherReport', title: 'Voucher List' },
  { route: 'CashAgentReport', title: 'Cash Agent Report' },
  { route: 'PaidVapsi', title: 'Paid Vapsi Report' },
  { route: 'SalaryRegister', title: 'Payroll Salary Register', yellow: true },
  { route: 'PaidHp', title: 'Paid Hp Report' },
  { route: 'LimitBalance', title: 'Limit Balance Report' },
  { route: 'Productivity', title: 'Productivity Report' },
  { route: 'ResultReport', title: 'Result Report' },
  { route: 'StaffWorking', title: 'Staff Working' },
] as Array<{ route: string; title: string; yellow?: boolean }>;

export function ReportScreen() {
  const navigation = useNavigation<any>();
  const role = useAuth((s) => s.user?.roleName);
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.canvas }} contentContainerStyle={{ padding: 18, paddingBottom: 28 }}>
      <Text style={styles.title}>Reports</Text>
      {REPORTS.filter((r) => canOpenRoute(role, r.route)).map((r) => (
        <Pressable
          key={r.route}
          onPress={() => { tap(); navigation.navigate(r.route); }}
          style={({ pressed }) => [styles.card, pressed && { opacity: 0.75 }]}
        >
          <MaterialCommunityIcons name="receipt" size={34} color={r.yellow ? '#F5C518' : colors.navy} />
          <Text style={styles.cardTitle} numberOfLines={1}>{r.title}</Text>
          <MaterialCommunityIcons name="chevron-right" size={34} color="#555" />
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 20, fontWeight: '600', color: colors.text, marginBottom: 12, marginTop: 2 },
  card: {
    backgroundColor: '#F1F1F2',
    borderRadius: radius.sm,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    ...shadow,
  },
  cardTitle: { flex: 1, fontSize: 18, color: colors.text, marginLeft: 28 },
});

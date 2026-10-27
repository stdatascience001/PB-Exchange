import { createDrawerNavigator } from '@react-navigation/drawer';
import { DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import React, { useEffect } from 'react';
import { View } from 'react-native';
import { canOpenRoute } from '../config/roleAccess';
import { AddLedgerScreen } from '../screens/AddLedgerScreen';
import { AdminCashScreen } from '../screens/AdminCashScreen';
import { AgentGroupsScreen } from '../screens/AgentGroupsScreen';
import { AgentOutstandingScreen } from '../screens/AgentOutstandingScreen';
import { AllShiftReportScreen } from '../screens/AllShiftReportScreen';
import { CashAgentReportScreen } from '../screens/CashAgentReportScreen';
import { CashReportDetailsScreen } from '../screens/CashReportDetailsScreen';
import { DailyReportScreen } from '../screens/DailyReportScreen';
import { JantriScreen } from '../screens/JantriScreen';
import { LedgersScreen } from '../screens/LedgersScreen';
import { LimitBalanceScreen } from '../screens/LimitBalanceScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { OutstandingScreen } from '../screens/OutstandingScreen';
import { PaidHpReportScreen } from '../screens/PaidHpReportScreen';
import { PaidVapsiReportScreen } from '../screens/PaidVapsiReportScreen';
import { PredictionScreen } from '../screens/PredictionScreen';
import { ProfitLossScreen } from '../screens/ProfitLossScreen';
import { ProfitLossShiftScreen } from '../screens/ProfitLossShiftScreen';
import { ProductivityScreen } from '../screens/ProductivityScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { ResultReportScreen } from '../screens/ResultReportScreen';
import { SalaryRegisterScreen } from '../screens/SalaryRegisterScreen';
import { ShiftTransactionsScreen } from '../screens/ShiftTransactionsScreen';
import { ShiftsScreen } from '../screens/ShiftsScreen';
import { AddShiftScreen, UpdateShiftScreen } from '../screens/ShiftFormScreens';
import { StaffWorkingScreen } from '../screens/StaffWorkingScreen';
import { StaffsScreen } from '../screens/StaffsScreen';
import { AddStaffScreen, UpdateStaffScreen } from '../screens/StaffFormScreens';
import { TransactionsScreen } from '../screens/TransactionsScreen';
import { UpdateLedgerScreen } from '../screens/UpdateLedgerScreen';
import { UpdateAgentGroupScreen } from '../screens/UpdateAgentGroupScreen';
import { VoucherAuditScreen } from '../screens/VoucherAuditScreen';
import { VoucherReportScreen } from '../screens/VoucherReportScreen';
import { VouchersScreen } from '../screens/VouchersScreen';
import { useAuth } from '../store/auth';
import { colors } from '../theme';
import { DrawerContent } from './DrawerContent';
import { MainTabs } from './MainTabs';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Drawer = createDrawerNavigator();

const theme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: colors.canvas, primary: colors.navy, card: colors.navy, text: colors.text },
};

// ≡ drawer around the four tabs
function MainDrawer() {
  return (
    <Drawer.Navigator
      drawerContent={(p) => <DrawerContent {...p} />}
      screenOptions={{ headerShown: false, drawerType: 'front', drawerStyle: { width: 300 } }}
    >
      <Drawer.Screen name="Tabs" component={MainTabs} />
    </Drawer.Navigator>
  );
}

// A screen the signed-in role may not open (website role rules — e.g. a stale link) is left
// straight away, the way the website sends such a page back to the dashboard.
function RouteGuard({ route, children }: { route: { name: string; params?: object }; children: React.ReactElement }) {
  const role = useAuth((s) => s.user?.roleName);
  const navigation = useNavigation<any>();
  const allowed = canOpenRoute(role, route.name, route.params);
  useEffect(() => {
    if (!allowed) { if (navigation.canGoBack()) navigation.goBack(); else navigation.navigate('Main'); }
  }, [allowed, navigation]);
  return allowed ? children : <View style={{ flex: 1, backgroundColor: colors.canvas }} />;
}

// Signed out -> Login only. Signed in -> the drawer + tabs, with every inner screen stacked on top.
// Signing out (Logout, expired token, SESSION_REPLACED) swaps the whole tree back to Login.
export function RootNavigator() {
  const token = useAuth((s) => s.token);
  return (
    <NavigationContainer theme={theme}>
      <Stack.Navigator
        screenOptions={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: colors.canvas } }}
        screenLayout={({ route, children }) => <RouteGuard route={route}>{children}</RouteGuard>}
      >
        {!token ? (
          <Stack.Screen name="Login" component={LoginScreen} />
        ) : (
          <>
            <Stack.Screen name="Main" component={MainDrawer} />
            <Stack.Screen name="StaffWorking" component={StaffWorkingScreen} />
            <Stack.Screen name="Profile" component={ProfileScreen} />
            <Stack.Screen name="Ledgers" component={LedgersScreen} />
            <Stack.Screen name="AddLedger" component={AddLedgerScreen} />
            <Stack.Screen name="UpdateLedger" component={UpdateLedgerScreen} />
            <Stack.Screen name="AgentGroups" component={AgentGroupsScreen} />
            <Stack.Screen name="UpdateAgentGroup" component={UpdateAgentGroupScreen} />
            <Stack.Screen name="Vouchers" component={VouchersScreen} />
            <Stack.Screen name="VoucherAudit" component={VoucherAuditScreen} />
            <Stack.Screen name="Staffs" component={StaffsScreen} />
            <Stack.Screen name="AddStaff" component={AddStaffScreen} />
            <Stack.Screen name="UpdateStaff" component={UpdateStaffScreen} />
            <Stack.Screen name="Shifts" component={ShiftsScreen} />
            <Stack.Screen name="AddShift" component={AddShiftScreen} />
            <Stack.Screen name="UpdateShift" component={UpdateShiftScreen} />
            <Stack.Screen name="Transactions" component={TransactionsScreen} />
            <Stack.Screen name="Prediction" component={PredictionScreen} />
            <Stack.Screen name="DailyReport" component={DailyReportScreen} />
            <Stack.Screen name="AllShiftReport" component={AllShiftReportScreen} />
            <Stack.Screen name="ProfitLoss" component={ProfitLossScreen} />
            <Stack.Screen name="ProfitLossShift" component={ProfitLossShiftScreen} />
            <Stack.Screen name="AdminCash" component={AdminCashScreen} />
            <Stack.Screen name="Outstanding" component={OutstandingScreen} />
            <Stack.Screen name="VoucherReport" component={VoucherReportScreen} />
            <Stack.Screen name="CashAgentReport" component={CashAgentReportScreen} />
            <Stack.Screen name="CashReportDetails" component={CashReportDetailsScreen} />
            <Stack.Screen name="PaidVapsi" component={PaidVapsiReportScreen} />
            <Stack.Screen name="PaidHp" component={PaidHpReportScreen} />
            <Stack.Screen name="SalaryRegister" component={SalaryRegisterScreen} />
            <Stack.Screen name="LimitBalance" component={LimitBalanceScreen} />
            <Stack.Screen name="ResultReport" component={ResultReportScreen} />
            <Stack.Screen name="AgentOutstanding" component={AgentOutstandingScreen} />
            <Stack.Screen name="ShiftTransactions" component={ShiftTransactionsScreen} />
            <Stack.Screen name="Jantri" component={JantriScreen} />
            <Stack.Screen name="Productivity" component={ProductivityScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

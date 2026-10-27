import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppHeader } from '../components/AppHeader';
import { OfflineBanner } from '../components/OfflineBanner';
import { hasMasterTab, hasReportTab } from '../config/roleAccess';
import { ChatScreen } from '../screens/ChatScreen';
import { DashboardScreen } from '../screens/DashboardScreen';
import { MasterScreen } from '../screens/MasterScreen';
import { ReportScreen } from '../screens/ReportScreen';
import { useAuth } from '../store/auth';
import { colors } from '../theme';
import { tap } from '../utils/haptics';
import type { TabParamList } from './types';

const Tab = createBottomTabNavigator<TabParamList>();

// Bottom bar (live app): Dashboard · Master · Report · Chat on navy, the active tab in white.
// Master / Report show only when the role may open something in them (website role rules).
export function MainTabs() {
  const insets = useSafeAreaInsets();
  const role = useAuth((s) => s.user?.roleName);
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        header: () => (
          <View>
            <AppHeader />
            <OfflineBanner />
          </View>
        ),
        tabBarStyle: [styles.bar, { height: 74 + insets.bottom, paddingBottom: insets.bottom + 8 }],
        tabBarActiveTintColor: colors.white,
        tabBarInactiveTintColor: '#5B6B86',
        tabBarLabelStyle: styles.label,
        tabBarIcon: ({ color }) => tabIcon(route.name, color),
      })}
      screenListeners={{ tabPress: () => tap() }}
    >
      <Tab.Screen name="Dashboard" component={DashboardScreen} />
      {hasMasterTab(role) && <Tab.Screen name="Master" component={MasterScreen} />}
      {hasReportTab(role) && <Tab.Screen name="Report" component={ReportScreen} />}
      <Tab.Screen name="Chat" component={ChatScreen} />
    </Tab.Navigator>
  );
}

function tabIcon(name: keyof TabParamList, color: string) {
  switch (name) {
    case 'Dashboard': return <MaterialIcons name="desktop-windows" size={30} color={color} />;
    case 'Master': return <MaterialCommunityIcons name="view-dashboard-variant-outline" size={30} color={color} />;
    case 'Report': return <MaterialCommunityIcons name="receipt" size={30} color={color} />;
    default: return <MaterialIcons name="chat" size={30} color={color} />;
  }
}

const styles = StyleSheet.create({
  bar: { backgroundColor: colors.navy, borderTopWidth: 0, paddingTop: 8 },
  label: { fontSize: 15, fontWeight: '600', marginTop: 2 },
});

import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { canOpenRoute } from '../config/roleAccess';
import { useAuth } from '../store/auth';
import { colors, radius, shadow } from '../theme';
import { tap } from '../utils/haptics';

// Master (live app): full-width management cards, plus Payment / Limit Transfer side by side.
// Only the cards the signed-in role may open (website role rules).
type IconSpec = { lib: 'mi' | 'mci'; name: string; bg: string };
const NAVY = colors.navy;
const AMBER = '#F2A007';
const RED = '#F0453A';

export function MasterScreen() {
  const navigation = useNavigation<any>();
  const go = (route: string, params?: object) => { tap(); navigation.navigate(route, params); };
  const role = useAuth((s) => s.user?.roleName);
  const can = (route: string, params?: object) => canOpenRoute(role, route, params);
  const journal = can('Vouchers', { type: 'JOURNAL' });
  const limit = can('Vouchers', { type: 'LIMIT' });

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.canvas }} contentContainerStyle={{ padding: 22, paddingBottom: 32 }}>
      <Text style={styles.title}>Master</Text>

      {can('Ledgers') && <WideCard icon={{ lib: 'mci', name: 'account-circle-outline', bg: NAVY }} title="Ledger Management" sub="Create new account and manage" onPress={() => go('Ledgers')} />}
      {can('AgentGroups') && <WideCard icon={{ lib: 'mi', name: 'groups', bg: AMBER }} title="Agent Groups Management" sub="Create new group and manage" onPress={() => go('AgentGroups')} />}

      {(journal || limit) && (
        <View style={styles.twoCol}>
          {journal && <HalfCard icon={{ lib: 'mi', name: 'credit-card', bg: NAVY }} title="Payment Transfer" sub="Journal Voucher Management" onPress={() => go('Vouchers', { type: 'JOURNAL' })} />}
          {limit && <HalfCard icon={{ lib: 'mci', name: 'cash-multiple', bg: RED }} title="Limit Transfer" sub="Limit Voucher Management" onPress={() => go('Vouchers', { type: 'LIMIT' })} />}
        </View>
      )}

      {can('VoucherAudit') && <WideCard icon={{ lib: 'mi', name: 'credit-card', bg: AMBER }} title="Voucher Audit / Verify" sub="Voucher Audit management" onPress={() => go('VoucherAudit')} />}
      {can('Staffs') && <WideCard icon={{ lib: 'mci', name: 'account-group', bg: NAVY }} title="Staff Management" sub="Create new staff account and manage" onPress={() => go('Staffs')} />}
      {can('Shifts') && <WideCard icon={{ lib: 'mci', name: 'clipboard-clock-outline', bg: AMBER }} title="Shift Management" sub="shift time manage" onPress={() => go('Shifts')} />}
    </ScrollView>
  );
}

function Icon({ spec }: { spec: IconSpec }) {
  return (
    <View style={[styles.iconBox, { backgroundColor: spec.bg }]}>
      {spec.lib === 'mi'
        ? <MaterialIcons name={spec.name as keyof typeof MaterialIcons.glyphMap} size={38} color={colors.white} />
        : <MaterialCommunityIcons name={spec.name as keyof typeof MaterialCommunityIcons.glyphMap} size={38} color={colors.white} />}
    </View>
  );
}

function WideCard({ icon, title, sub, onPress }: { icon: IconSpec; title: string; sub: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, styles.wide, pressed && styles.pressed]}>
      <Icon spec={icon} />
      <View style={{ flex: 1, marginLeft: 16 }}>
        <Text style={styles.cardTitle} numberOfLines={1} adjustsFontSizeToFit>{title}</Text>
        <Text style={styles.cardSub} numberOfLines={1}>{sub}</Text>
      </View>
      <MaterialIcons name="chevron-right" size={40} color="#555" />
    </Pressable>
  );
}

function HalfCard({ icon, title, sub, onPress }: { icon: IconSpec; title: string; sub: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, styles.half, pressed && styles.pressed]}>
      <Icon spec={icon} />
      <Text style={[styles.cardTitle, styles.halfTitle]} numberOfLines={1} adjustsFontSizeToFit>{title}</Text>
      <Text style={styles.cardSub} numberOfLines={1} adjustsFontSizeToFit>{sub}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '600', color: colors.text, marginBottom: 18, marginTop: 4 },
  card: { backgroundColor: '#F1F1F2', borderRadius: radius.lg, padding: 18, marginBottom: 18, ...shadow },
  wide: { flexDirection: 'row', alignItems: 'center' },
  half: { flex: 1 },
  twoCol: { flexDirection: 'row', gap: 16 },
  pressed: { opacity: 0.75 },
  iconBox: { width: 74, height: 74, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 20, fontWeight: '500', color: colors.text },
  halfTitle: { marginTop: 22, fontSize: 18 },
  cardSub: { fontSize: 13.5, color: '#555', marginTop: 4 },
});

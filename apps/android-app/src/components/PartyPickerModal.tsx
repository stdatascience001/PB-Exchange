import React, { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Ledger } from '../api/types';
import { colors } from '../theme';
import { tap } from '../utils/haptics';

// Party chooser of the live app (Admin Cash Report …): pale-yellow sheet, "SEARCH...", one row per
// party — name, its user name (green), mobile, who added it (amber) — and a navy CLOSE bar
export function PartyPickerModal({ visible, parties, loading, onClose, onPick }: {
  visible: boolean; parties: Ledger[]; loading?: boolean; onClose: () => void; onPick: (l: Ledger) => void;
}) {
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const t = q.trim().toUpperCase();
    const sorted = [...parties].sort((a, b) => a.partyName.localeCompare(b.partyName));
    return t ? sorted.filter((l) => l.partyName.toUpperCase().includes(t) || String(l.userName || '').includes(t) || String(l.mobile || '').includes(t)) : sorted;
  }, [parties, q]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { marginTop: insets.top + 50, marginBottom: insets.bottom + 8 }]}>
          <View style={styles.searchWrap}>
            <TextInput value={q} onChangeText={setQ} placeholder="SEARCH..." placeholderTextColor={colors.textMuted} autoCapitalize="characters" autoCorrect={false} style={styles.search} />
          </View>
          <FlatList
            data={list}
            keyExtractor={(l) => String(l.id)}
            keyboardShouldPersistTaps="handled"
            initialNumToRender={15}
            ListEmptyComponent={<Text style={styles.empty}>{loading ? 'Loading...' : 'No party found'}</Text>}
            renderItem={({ item, index }) => (
              <Pressable onPress={() => { tap(); setQ(''); onPick(item); }} style={({ pressed }) => [styles.row, pressed && { backgroundColor: '#F3F0C8' }]}>
                <Text style={styles.index}>{index + 1}.</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name} numberOfLines={1}>{item.partyName}</Text>
                  <View style={styles.sub}>
                    <Text style={styles.user} numberOfLines={1}>{item.userName || ''}</Text>
                    <Text style={styles.mobile} numberOfLines={1}>{item.mobile || ''}</Text>
                    <Text style={styles.added} numberOfLines={1}>{item.addedBy || item.updatedBy || ''}</Text>
                  </View>
                </View>
              </Pressable>
            )}
          />
          <Pressable onPress={() => { tap(); setQ(''); onClose(); }} style={({ pressed }) => [styles.close, pressed && { backgroundColor: colors.navyDark }]}>
            <Text style={styles.closeText}>CLOSE</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center' },
  card: { flex: 1, width: '84%', backgroundColor: '#FBFAD9', overflow: 'hidden' },
  searchWrap: { padding: 12, borderBottomWidth: 1, borderBottomColor: '#E2E0B8' },
  search: { backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 18, color: colors.text },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#E2E0B8' },
  index: { width: 42, fontSize: 18, color: colors.text },
  name: { fontSize: 17, fontWeight: '600', color: colors.text, textTransform: 'uppercase' },
  sub: { flexDirection: 'row', marginTop: 5, gap: 10 },
  user: { flex: 1.1, fontSize: 14, fontWeight: '600', color: '#7CB342' },
  mobile: { flex: 1.3, fontSize: 14, color: '#666' },
  added: { flex: 0.8, fontSize: 14, color: colors.amber },
  empty: { textAlign: 'center', color: colors.textMuted, padding: 24 },
  close: { backgroundColor: colors.navy, alignItems: 'center', paddingVertical: 16 },
  closeText: { color: colors.white, fontSize: 19, fontWeight: '500' },
});

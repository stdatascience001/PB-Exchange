import { MaterialIcons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { apiRequest } from '../api/client';
import type { MyMessage } from '../api/types';
import { colors, radius, shadow } from '../theme';
import { dmyTime } from '../utils/format';

// Chat tab: the messages the admin has set for this user's role (GET /messages/mine — the same
// MESSAGE ticker and flash message the web app shows under its navbar)
export function ChatScreen() {
  const [data, setData] = useState<MyMessage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest<MyMessage>('/messages/mine');
      setData(res.data || null);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Failed to load messages');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const items = [
    data?.flashMessage ? { title: 'Flash Message', text: data.flashMessage, icon: 'campaign' as const } : null,
    data?.message ? { title: 'Message', text: data.message, icon: 'chat' as const } : null,
  ].filter(Boolean) as Array<{ title: string; text: string; icon: 'campaign' | 'chat' }>;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.canvas }}
      contentContainerStyle={{ padding: 22, flexGrow: 1 }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} colors={[colors.navy]} />}
    >
      <Text style={styles.title}>Messages</Text>
      {items.map((m) => (
        <View key={m.title} style={styles.card}>
          <View style={styles.cardHead}>
            <MaterialIcons name={m.icon} size={22} color={colors.navy} />
            <Text style={styles.cardTitle}>{m.title}</Text>
          </View>
          <Text style={styles.text}>{m.text}</Text>
          {!!data?.updatedAt && <Text style={styles.time}>{dmyTime(data.updatedAt)}</Text>}
        </View>
      ))}
      {!loading && items.length === 0 && (
        <Text style={styles.empty}>{error || 'No messages for you right now'}</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '600', color: colors.text, marginBottom: 18, marginTop: 4 },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: 18, marginBottom: 16, ...shadow },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: colors.navy, textTransform: 'uppercase' },
  text: { fontSize: 16, color: colors.text, lineHeight: 22 },
  time: { fontSize: 12, color: colors.textMuted, marginTop: 10 },
  empty: { textAlign: 'center', color: colors.textMuted, marginTop: 48, fontSize: 15 },
});

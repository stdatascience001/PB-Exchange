import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, LayoutChangeEvent, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { apiRequest } from '../api/client';
import type { MyMessage } from '../api/types';
import { colors, radius, shadow } from '../theme';
import { tap } from '../utils/haptics';

// Dashboard notice of the signed-in user's role (GET /messages/mine — the API returns only that
// role's row; admins set it on the website's Utilities → Message / Flash Message pages):
//   Message        coral bar under the greeting: chat icon + the text scrolling right to left,
//                  shown as long as the role has a message set (live app; website's red ticker)
//   Flash Message  "Announcement" pop-up, once per app session per text until Close (website)
// Nothing shows when the role has no message. `reloadKey` changing reloads it (pull-to-refresh).

const seenFlash = new Map<number, string>(); // roleId → flash text closed this session
const SPEED = 55; // px per second

export function RoleMessageBanner({ roleId, reloadKey }: { roleId?: number; reloadKey?: number }) {
  const [data, setData] = useState<MyMessage | null>(null);
  const [showFlash, setShowFlash] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiRequest<MyMessage>('/messages/mine');
      const d = res.data || null;
      setData(d);
      setShowFlash(!!d?.flashMessage && roleId !== undefined && seenFlash.get(roleId) !== d.flashMessage);
    } catch {
      // keep whatever was shown; the dashboard itself reports connection problems
    }
  }, [roleId]);

  useEffect(() => { void load(); }, [load, reloadKey]);

  const closeFlash = () => {
    tap();
    if (roleId !== undefined && data?.flashMessage) seenFlash.set(roleId, data.flashMessage);
    setShowFlash(false);
  };

  const message = (data?.message || '').trim();
  return (
    <>
      {!!message && <Ticker text={message} />}
      <Modal visible={showFlash && !!data?.flashMessage} transparent animationType="fade" onRequestClose={closeFlash}>
        <View style={styles.backdrop}>
          <View style={styles.flash}>
            <View style={styles.flashHead}>
              <MaterialIcons name="campaign" size={20} color={colors.white} />
              <Text style={styles.flashTitle}>Announcement</Text>
            </View>
            <Text style={styles.flashText}>{data?.flashMessage}</Text>
            <View style={{ alignItems: 'flex-end', paddingHorizontal: 16, paddingBottom: 16 }}>
              <Pressable onPress={closeFlash} style={({ pressed }) => [styles.close, pressed && { opacity: 0.85 }]}>
                <Text style={styles.closeText}>Close</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

// The text glides in from the right edge and out at the left, then starts again
function Ticker({ text }: { text: string }) {
  const x = useRef(new Animated.Value(0)).current;
  const [boxW, setBoxW] = useState(0);
  const [textW, setTextW] = useState(0);

  useEffect(() => {
    if (!boxW || !textW) return;
    x.setValue(boxW);
    const anim = Animated.loop(Animated.timing(x, {
      toValue: -textW,
      duration: ((boxW + textW) / SPEED) * 1000,
      easing: Easing.linear,
      useNativeDriver: true,
    }));
    anim.start();
    return () => anim.stop();
  }, [boxW, textW, text, x]);

  return (
    <View style={styles.bar} accessibilityRole="text" accessibilityLabel={text}>
      <View style={styles.iconCircle}>
        <MaterialCommunityIcons name="message-processing" size={22} color="#F5B71A" />
      </View>
      <View style={styles.track} onLayout={(e: LayoutChangeEvent) => setBoxW(e.nativeEvent.layout.width)}>
        {/* a very wide row so the text keeps to one line; its own width is measured */}
        <Animated.View style={[styles.runner, { transform: [{ translateX: x }] }]}>
          <Text style={styles.text} onLayout={(e: LayoutChangeEvent) => setTextW(e.nativeEvent.layout.width)}>{text}</Text>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    marginHorizontal: 24, marginBottom: 12, backgroundColor: '#F4956E', borderRadius: radius.md,
    flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 8, ...shadow,
  },
  iconCircle: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  track: { flex: 1, height: 26, overflow: 'hidden', marginLeft: 10, justifyContent: 'center' },
  runner: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 10000, flexDirection: 'row', alignItems: 'center' },
  text: { color: colors.white, fontSize: 16, fontWeight: '700' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  flash: { width: '100%', maxWidth: 420, backgroundColor: colors.surface, borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: '#CBD5E1' },
  flashHead: { backgroundColor: '#B91C1C', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  flashTitle: { color: colors.white, fontSize: 15, fontWeight: '700' },
  flashText: { padding: 16, fontSize: 15, color: '#1E293B', fontWeight: '500', lineHeight: 22 },
  close: { backgroundColor: '#1E3A8A', borderRadius: 4, paddingHorizontal: 20, paddingVertical: 7 },
  closeText: { color: colors.white, fontSize: 13, fontWeight: '700' },
});

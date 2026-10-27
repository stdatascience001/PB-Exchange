import { MaterialIcons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { GestureResponderEvent, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors } from '../theme';
import { tap } from '../utils/haptics';
import { CORAL } from './CalendarModal';

// Material-style 24-hour clock of the live app (Update Time): coral header "23:59" (the part
// being picked is bright), a dial with 1-12 outside and 00,13-23 inside for the hour, then
// 00-55 for the minute; keyboard icon switches to typing, CANCEL / OK. Same on every platform.
const DIAL = 280;
const C = DIAL / 2;
const R_OUT = C - 26;
const R_IN = C - 64;
const pad = (n: number) => String(n).padStart(2, '0');

const parse = (v: string | null | undefined): [number, number] => {
  const m = /^(\d{1,2}):(\d{2})/.exec(v || '');
  return m ? [Math.min(23, Number(m[1])), Math.min(59, Number(m[2]))] : [0, 0];
};
const at = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180;
  return { x: C + r * Math.sin(a), y: C - r * Math.cos(a) };
};

export function TimePickerModal({ visible, value, onCancel, onConfirm }: {
  visible: boolean; value: string | null; onCancel: () => void; onConfirm: (hhmm: string) => void;
}) {
  const [hour, setHour] = useState(0);
  const [minute, setMinute] = useState(0);
  const [mode, setMode] = useState<'H' | 'M'>('H');
  const [typing, setTyping] = useState(false);
  const [hText, setHText] = useState('00');
  const [mText, setMText] = useState('00');

  // re-open on the row's current time, hour first
  useEffect(() => {
    if (!visible) return;
    const [h, m] = parse(value);
    setHour(h); setMinute(m); setMode('H'); setTyping(false);
    setHText(pad(h)); setMText(pad(m));
  }, [visible, value]);

  const pickAt = (e: GestureResponderEvent, release: boolean) => {
    // web click events carry offsetX/Y instead of locationX/Y
    const ne = e.nativeEvent as GestureResponderEvent['nativeEvent'] & { offsetX?: number; offsetY?: number };
    const dx = (ne.locationX ?? ne.offsetX ?? C) - C;
    const dy = (ne.locationY ?? ne.offsetY ?? C) - C;
    let deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
    if (deg < 0) deg += 360;
    if (mode === 'H') {
      const idx = Math.round(deg / 30) % 12;
      const inner = Math.hypot(dx, dy) < (R_OUT + R_IN) / 2;
      setHour(inner ? (idx === 0 ? 0 : idx + 12) : (idx === 0 ? 12 : idx));
      if (release) { tap(); setMode('M'); }
    } else {
      setMinute(Math.round(deg / 6) % 60);
      if (release) tap();
    }
  };

  const confirm = () => {
    tap();
    if (typing) {
      const h = Math.min(23, Number(hText) || 0);
      const m = Math.min(59, Number(mText) || 0);
      onConfirm(`${pad(h)}:${pad(m)}`);
    } else {
      onConfirm(`${pad(hour)}:${pad(minute)}`);
    }
  };

  const hand = mode === 'H'
    ? at((hour % 12) * 30, hour === 0 || hour > 12 ? R_IN : R_OUT)
    : at(minute * 6, R_OUT);
  const handLen = Math.hypot(hand.x - C, hand.y - C);
  const handDeg = mode === 'H' ? (hour % 12) * 30 : minute * 6;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.card} onPress={() => undefined}>
          <View style={styles.head}>
            <Pressable onPress={() => { tap(); setMode('H'); }}>
              <Text style={[styles.big, mode !== 'H' && !typing && styles.faded]}>{pad(hour)}</Text>
            </Pressable>
            <Text style={styles.big}>:</Text>
            <Pressable onPress={() => { tap(); setMode('M'); }}>
              <Text style={[styles.big, mode !== 'M' && !typing && styles.faded]}>{pad(minute)}</Text>
            </Pressable>
          </View>

          {typing ? (
            <View style={styles.typeRow}>
              <TextInput value={hText} onChangeText={(t) => setHText(t.replace(/\D/g, '').slice(0, 2))} keyboardType="number-pad" style={styles.typeBox} selectTextOnFocus />
              <Text style={styles.typeColon}>:</Text>
              <TextInput value={mText} onChangeText={(t) => setMText(t.replace(/\D/g, '').slice(0, 2))} keyboardType="number-pad" style={styles.typeBox} selectTextOnFocus />
            </View>
          ) : (
            <Pressable style={styles.dial} onPressIn={(e) => pickAt(e, false)} onPress={(e) => pickAt(e, true)}>
              <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                <View style={[styles.hand, { height: handLen, left: C - 1, top: C - handLen, transform: [{ translateY: handLen / 2 }, { rotate: `${handDeg}deg` }, { translateY: -handLen / 2 }] }]} />
                <View style={[styles.dot, { left: C - 4, top: C - 4 }]} />
                <View style={[styles.knob, { left: hand.x - 25, top: hand.y - 25 }]} />
                {mode === 'H' ? (
                  <>
                    {Array.from({ length: 12 }, (_, i) => {
                      const n = i === 0 ? 12 : i;
                      const p = at(i * 30, R_OUT);
                      return <Text key={`o${n}`} style={[styles.num, { left: p.x - 20, top: p.y - 12 }, hour === n && styles.numOn]}>{n}</Text>;
                    })}
                    {Array.from({ length: 12 }, (_, i) => {
                      const n = i === 0 ? 0 : i + 12;
                      const p = at(i * 30, R_IN);
                      return <Text key={`i${n}`} style={[styles.num, styles.inner, { left: p.x - 20, top: p.y - 10 }, hour === n && styles.numOn]}>{pad(n)}</Text>;
                    })}
                  </>
                ) : (
                  Array.from({ length: 12 }, (_, i) => {
                    const p = at(i * 30, R_OUT);
                    return <Text key={`m${i}`} style={[styles.num, { left: p.x - 20, top: p.y - 12 }, minute === i * 5 && styles.numOn]}>{pad(i * 5)}</Text>;
                  })
                )}
              </View>
            </Pressable>
          )}

          <View style={styles.actions}>
            <Pressable hitSlop={10} onPress={() => {
              tap();
              if (typing) { setHour(Math.min(23, Number(hText) || 0)); setMinute(Math.min(59, Number(mText) || 0)); }
              else { setHText(pad(hour)); setMText(pad(minute)); }
              setTyping(!typing);
            }}>
              <MaterialIcons name={typing ? 'schedule' : 'keyboard'} size={30} color={colors.textMuted} />
            </Pressable>
            <View style={{ flex: 1 }} />
            <Pressable hitSlop={8} onPress={() => { tap(); onCancel(); }}><Text style={styles.action}>CANCEL</Text></Pressable>
            <Pressable hitSlop={8} onPress={confirm}><Text style={styles.action}>OK</Text></Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 360, backgroundColor: colors.surface, borderRadius: 3, overflow: 'hidden' },
  head: { backgroundColor: CORAL, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingVertical: 22 },
  big: { color: colors.white, fontSize: 64, fontWeight: '600' },
  faded: { color: 'rgba(255,255,255,0.6)' },
  dial: { width: DIAL, height: DIAL, borderRadius: DIAL / 2, backgroundColor: '#EEEEEE', alignSelf: 'center', marginTop: 22 },
  hand: { position: 'absolute', width: 2, backgroundColor: CORAL },
  dot: { position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: CORAL },
  knob: { position: 'absolute', width: 50, height: 50, borderRadius: 25, backgroundColor: CORAL },
  num: { position: 'absolute', width: 40, textAlign: 'center', fontSize: 18, color: colors.text },
  inner: { fontSize: 14, color: colors.textMuted },
  numOn: { color: colors.white },
  typeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 36 },
  typeBox: { width: 90, height: 64, borderBottomWidth: 2, borderBottomColor: CORAL, textAlign: 'center', fontSize: 40, color: colors.text },
  typeColon: { fontSize: 40, color: colors.text, marginHorizontal: 10 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 40, paddingHorizontal: 26, paddingVertical: 22 },
  action: { color: CORAL, fontSize: 16, fontWeight: '600', letterSpacing: 0.4 },
});

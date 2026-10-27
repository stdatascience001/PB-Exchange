import { MaterialIcons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator, FlatList, KeyboardTypeOptions, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, shadow } from '../theme';
import { dmy, isoDate } from '../utils/format';
import { tap } from '../utils/haptics';

// ---- Search box ("Search Party..") ------------------------------------------------------------
export function SearchBox({ value, onChangeText, placeholder }: { value: string; onChangeText: (v: string) => void; placeholder: string }) {
  return (
    <View style={styles.searchWrap}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        autoCapitalize="characters"
        autoCorrect={false}
        style={styles.search}
        returnKeyType="search"
      />
      {!!value && (
        <Pressable hitSlop={10} onPress={() => onChangeText('')} style={styles.clear}>
          <MaterialIcons name="close" size={20} color={colors.textMuted} />
        </Pressable>
      )}
    </View>
  );
}

// ---- Bottom action bar ("ADD LEDGER / CLICK HERE TO ADD NEW LEDGER") ----------------------------
export function BottomActionBar({ title, subtitle, onPress }: { title: string; subtitle: string; onPress: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Pressable
      onPress={() => { tap(); onPress(); }}
      style={({ pressed }) => [styles.bottomBar, { paddingBottom: 12 + insets.bottom }, pressed && { backgroundColor: colors.navyDark }]}
    >
      <Text style={styles.bottomTitle}>{title}</Text>
      <Text style={styles.bottomSub}>{subtitle}</Text>
    </Pressable>
  );
}

// ---- Buttons --------------------------------------------------------------------------------
export function PrimaryButton({ label, onPress, loading, disabled, style }: {
  label: string; onPress: () => void; loading?: boolean; disabled?: boolean; style?: object;
}) {
  return (
    <Pressable
      disabled={disabled || loading}
      onPress={() => { tap(); onPress(); }}
      style={({ pressed }) => [styles.primary, (disabled || loading) && { opacity: 0.6 }, pressed && { backgroundColor: colors.navyDark }, style]}
    >
      {loading ? <ActivityIndicator color={colors.white} /> : <Text style={styles.primaryText}>{label}</Text>}
    </Pressable>
  );
}

// ---- Pill field (rounded outline box used by filters / dates) --------------------------------
function Pill({ label, onPress, muted }: { label: string; onPress: () => void; muted?: boolean }) {
  return (
    <Pressable onPress={() => { tap(); onPress(); }} style={({ pressed }) => [styles.pill, pressed && { backgroundColor: colors.canvas }]}>
      <Text style={[styles.pillText, muted && { color: colors.textMuted }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

// ---- Select (modal list with search) --------------------------------------------------------
export interface Option { value: string; label: string }
export function SelectField({ value, options, onChange, placeholder, title }: {
  value: string; options: Option[]; onChange: (v: string) => void; placeholder: string; title: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const insets = useSafeAreaInsets();
  const selected = options.find((o) => o.value === value);
  const filtered = useMemo(() => {
    const t = q.trim().toUpperCase();
    return t ? options.filter((o) => o.label.toUpperCase().includes(t)) : options;
  }, [options, q]);
  return (
    <>
      <Pill label={selected ? selected.label : placeholder} muted={!selected} onPress={() => setOpen(true)} />
      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View style={styles.sheetBackdrop}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 8 }]}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>{title}</Text>
              <Pressable hitSlop={12} onPress={() => setOpen(false)}>
                <MaterialIcons name="close" size={24} color={colors.text} />
              </Pressable>
            </View>
            {options.length > 8 && <SearchBox value={q} onChangeText={setQ} placeholder="Search.." />}
            <FlatList
              data={filtered}
              keyExtractor={(o) => o.value}
              keyboardShouldPersistTaps="handled"
              initialNumToRender={20}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => { tap(); onChange(item.value); setOpen(false); setQ(''); }}
                  style={({ pressed }) => [styles.option, pressed && { backgroundColor: colors.canvas }]}
                >
                  <Text style={[styles.optionText, item.value === value && { color: colors.navy, fontWeight: '700' }]}>{item.label}</Text>
                  {item.value === value && <MaterialIcons name="check" size={20} color={colors.navy} />}
                </Pressable>
              )}
            />
          </View>
        </View>
      </Modal>
    </>
  );
}

// ---- Date (DD-MM-YYYY pill, native picker) ---------------------------------------------------
export function DateField({ value, onChange }: { value: string; onChange: (iso: string) => void }) {
  const [open, setOpen] = useState(false);
  const date = useMemo(() => {
    const [y, m, d] = value.split('-').map(Number);
    return y ? new Date(y, (m || 1) - 1, d || 1) : new Date();
  }, [value]);
  const onPicked = (e: DateTimePickerEvent, d?: Date) => {
    if (Platform.OS === 'android') setOpen(false);
    if (e.type === 'set' && d) onChange(isoDate(d));
  };
  // Web build: no native picker — a plain YYYY-MM-DD box, applied once it is a valid date
  if (Platform.OS === 'web') return <WebDateInput value={value} onChange={onChange} />;
  return (
    <>
      <Pill label={dmy(value)} onPress={() => setOpen(true)} />
      {open && Platform.OS === 'android' && <DateTimePicker value={date} mode="date" onChange={onPicked} />}
      {Platform.OS === 'ios' && (
        <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
          <Pressable style={styles.sheetBackdrop} onPress={() => setOpen(false)}>
            <View style={[styles.sheet, { paddingBottom: 24 }]}>
              <DateTimePicker value={date} mode="date" display="inline" onChange={(e, d) => { onPicked(e, d); setOpen(false); }} />
            </View>
          </Pressable>
        </Modal>
      )}
    </>
  );
}

function WebDateInput({ value, onChange }: { value: string; onChange: (iso: string) => void }) {
  const [text, setText] = useState(value);
  return (
    <View style={[styles.pill, { paddingVertical: 0 }]}>
      <TextInput
        value={text}
        onChangeText={(t) => {
          setText(t);
          if (/^\d{4}-\d{2}-\d{2}$/.test(t) && !isNaN(new Date(t).getTime())) onChange(t);
        }}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={colors.textMuted}
        style={[styles.pillText, { paddingVertical: 15 }]}
      />
    </View>
  );
}

// ---- Find button (navy, square-ish, next to filters) -----------------------------------------
export function FindButton({ onPress, loading }: { onPress: () => void; loading?: boolean }) {
  return (
    <Pressable onPress={() => { tap(); onPress(); }} style={({ pressed }) => [styles.find, pressed && { backgroundColor: colors.navyDark }]}>
      {loading ? <ActivityIndicator color={colors.white} /> : <Text style={styles.findText}>FIND</Text>}
    </Pressable>
  );
}

// ---- Labeled text input (forms) --------------------------------------------------------------
export function FormField({ label, value, onChangeText, placeholder, keyboardType, secureTextEntry, autoCapitalize, multiline }: {
  label: string; value: string; onChangeText: (v: string) => void; placeholder?: string;
  keyboardType?: KeyboardTypeOptions; secureTextEntry?: boolean; autoCapitalize?: 'none' | 'characters' | 'words' | 'sentences'; multiline?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
        keyboardType={keyboardType}
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize ?? 'characters'}
        autoCorrect={false}
        multiline={multiline}
        style={[styles.input, multiline && { minHeight: 72, textAlignVertical: 'top' }]}
      />
    </View>
  );
}

export function FieldLabel({ children }: { children: string }) {
  return <Text style={styles.fieldLabel}>{children}</Text>;
}

// ---- States ----------------------------------------------------------------------------------
export function CenterMessage({ text, loading, onRetry }: { text?: string; loading?: boolean; onRetry?: () => void }) {
  return (
    <View style={styles.center}>
      {loading ? <ActivityIndicator size="large" color={colors.navy} /> : (
        <>
          <Text style={styles.centerText}>{text}</Text>
          {onRetry && <Pressable onPress={onRetry} style={styles.retry}><Text style={styles.retryText}>RETRY</Text></Pressable>}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  searchWrap: { justifyContent: 'center', marginHorizontal: 12, marginVertical: 8 },
  search: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 19,
    color: colors.text,
  },
  clear: { position: 'absolute', right: 14 },
  bottomBar: { backgroundColor: colors.navy, alignItems: 'center', paddingTop: 14 },
  bottomTitle: { color: colors.white, fontSize: 21, fontWeight: '600', letterSpacing: 0.3 },
  bottomSub: { color: colors.white, fontSize: 14, marginTop: 2, letterSpacing: 0.3 },
  primary: { backgroundColor: colors.navy, borderRadius: radius.md, paddingVertical: 15, alignItems: 'center', ...shadow },
  primaryText: { color: colors.white, fontSize: 17, fontWeight: '700', letterSpacing: 0.4 },
  pill: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 15,
    justifyContent: 'center',
  },
  pillText: { fontSize: 18, color: colors.text, textTransform: 'uppercase' },
  sheetBackdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, maxHeight: '80%', paddingTop: 8 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 12 },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: colors.text, textTransform: 'uppercase' },
  option: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.divider },
  optionText: { fontSize: 16, color: colors.text, textTransform: 'uppercase' },
  find: { backgroundColor: colors.navy, borderRadius: radius.md, paddingHorizontal: 26, justifyContent: 'center', alignItems: 'center', minWidth: 100, ...shadow },
  findText: { color: colors.white, fontSize: 20, fontWeight: '600' },
  field: { marginBottom: 14 },
  fieldLabel: { fontSize: 13, fontWeight: '700', color: colors.textMuted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.3 },
  input: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  centerText: { fontSize: 15, color: colors.textMuted, textAlign: 'center' },
  retry: { marginTop: 12, paddingHorizontal: 18, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.navy },
  retryText: { color: colors.white, fontWeight: '700' },
});

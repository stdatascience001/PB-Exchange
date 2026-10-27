import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';
import { tap } from '../utils/haptics';

// The numbered list row every master list uses on the live app:
//   1.  TITLE ───────────────────────── │   RIGHT TOP
//       TAG        MIDDLE        CODE   │   right bottom
export interface ListRowProps {
  index: number;
  title: string;
  titleColor?: string;
  tag?: string;
  tagColor?: string;
  middle?: string;
  code?: string;
  codeColor?: string;
  rightTop?: string;
  rightBottom?: string;
  rightNode?: React.ReactNode; // replaces rightTop / rightBottom (e.g. a status badge)
  onPress?: () => void;
  onLongPress?: () => void;
}

function ListRowBase(p: ListRowProps) {
  const body = (
    <View style={styles.row}>
      <Text style={styles.index}>{p.index}{p.rightNode ? '' : '.'}</Text>
      <View style={styles.main}>
        <Text style={[styles.title, p.titleColor ? { color: p.titleColor } : null]} numberOfLines={1}>{p.title}</Text>
        <View style={styles.line} />
        <View style={styles.sub}>
          {!!p.tag && <Text style={[styles.tag, { color: p.tagColor || colors.cyan }]} numberOfLines={1}>{p.tag}</Text>}
          {!!p.middle && <Text style={styles.middle} numberOfLines={1}>{p.middle}</Text>}
          {!!p.code && <Text style={[styles.code, { color: p.codeColor || colors.amber }]} numberOfLines={1}>{p.code}</Text>}
        </View>
      </View>
      <View style={styles.divider} />
      <View style={styles.right}>
        {p.rightNode ?? (
          <>
            {!!p.rightTop && <Text style={styles.rightTop} numberOfLines={1}>{p.rightTop}</Text>}
            {!!p.rightBottom && <Text style={styles.rightBottom} numberOfLines={1}>{p.rightBottom}</Text>}
          </>
        )}
      </View>
    </View>
  );
  if (!p.onPress) return body;
  return (
    <Pressable
      onPress={() => { tap(); p.onPress?.(); }}
      onLongPress={p.onLongPress ? () => { tap(); p.onLongPress?.(); } : undefined}
      style={({ pressed }) => pressed && { opacity: 0.7 }}>
      {body}
    </Pressable>
  );
}

export const ListRow = React.memo(ListRowBase);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: 14,
    paddingLeft: 14,
    paddingRight: 10,
  },
  index: { width: 38, fontSize: 20, color: colors.text, fontWeight: '500' },
  main: { flex: 1, paddingRight: 8 },
  title: { fontSize: 18, fontWeight: '600', color: colors.text, textTransform: 'uppercase' },
  line: { height: 1, backgroundColor: colors.divider, marginVertical: 5 },
  sub: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  tag: { fontSize: 14, fontWeight: '700', textTransform: 'uppercase', flexShrink: 0, maxWidth: '45%' },
  middle: { fontSize: 14, fontWeight: '600', color: colors.text, textTransform: 'uppercase', flexShrink: 1 },
  code: { fontSize: 14, fontWeight: '700', textTransform: 'uppercase', flexShrink: 1 },
  divider: { width: 1, alignSelf: 'stretch', backgroundColor: colors.border, marginHorizontal: 6 },
  right: { width: 112, alignItems: 'flex-end', justifyContent: 'center' },
  rightTop: { fontSize: 17, fontWeight: '700', color: colors.text },
  rightBottom: { fontSize: 11.5, color: colors.textMuted, marginTop: 4 },
});

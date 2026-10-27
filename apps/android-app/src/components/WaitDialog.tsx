import React from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';
import { CORAL } from './CalendarModal';

// "Please Wait..." box of the live app (coral spinner) while a report loads
export function WaitDialog({ visible }: { visible: boolean }) {
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={styles.box}>
          <ActivityIndicator size="large" color={CORAL} />
          <Text style={styles.text}>Please Wait...</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 28 },
  box: { width: '100%', maxWidth: 380, backgroundColor: colors.surface, borderRadius: 2, flexDirection: 'row', alignItems: 'center', paddingVertical: 30, paddingHorizontal: 36, gap: 34 },
  text: { fontSize: 18, color: '#555' },
});

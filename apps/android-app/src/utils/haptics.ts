import * as Haptics from 'expo-haptics';

// Light tactile feedback on taps (silently ignored where unsupported)
export const tap = () => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined); };
export const success = () => { void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined); };
export const failure = () => { void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined); };

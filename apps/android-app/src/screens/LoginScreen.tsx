import { MaterialIcons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiRequest, errorMessage } from '../api/client';
import type { Captcha } from '../api/types';
import { PrimaryButton } from '../components/Controls';
import { useAuth } from '../store/auth';
import { colors, radius } from '../theme';
import { failure, success, tap } from '../utils/haptics';

// Sign In (same as the web login): username, password and the captcha the API hands out
// (GET /auth/captcha -> POST /auth/login). A wrong attempt fetches a fresh captcha.
export function LoginScreen() {
  const insets = useSafeAreaInsets();
  const login = useAuth((s) => s.login);
  const endedReason = useAuth((s) => s.endedReason);
  const clearEndedReason = useAuth((s) => s.clearEndedReason);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [captcha, setCaptcha] = useState<Captcha | null>(null);
  const [captchaAnswer, setCaptchaAnswer] = useState('');
  const [captchaLoading, setCaptchaLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCaptcha = useCallback(async () => {
    setCaptchaLoading(true);
    setCaptchaAnswer('');
    try {
      const res = await apiRequest<Captcha>('/auth/captcha', { auth: false });
      setCaptcha(res.data || null);
    } catch (err) {
      setError(errorMessage(err, 'Unable to load captcha'));
    } finally {
      setCaptchaLoading(false);
    }
  }, []);

  useEffect(() => { void loadCaptcha(); }, [loadCaptcha]);

  const submit = async () => {
    setError(null);
    clearEndedReason();
    if (!username.trim() || !password) { setError('Please enter username and password'); failure(); return; }
    if (!captcha || !captchaAnswer.trim()) { setError('Please verify you are a human'); failure(); return; }
    setSubmitting(true);
    try {
      await login({ username, password, captchaId: captcha.id, captchaAnswer });
      success();
    } catch (err) {
      failure();
      setError(errorMessage(err, 'Login failed'));
      void loadCaptcha();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.navy }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.wrap, { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
        <View style={styles.brandRow}>
          <Text style={styles.brand}>PB EXCHANGE</Text>
          <Text style={styles.live}>LIVE</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.heading}>Sign In</Text>
          <Text style={styles.sub}>Sign in to your account to continue</Text>

          {!!(endedReason || error) && (
            <View style={styles.alert}>
              <MaterialIcons name="error-outline" size={18} color={colors.crimson} />
              <Text style={styles.alertText}>{error || endedReason}</Text>
            </View>
          )}

          <TextInput
            value={username}
            onChangeText={setUsername}
            placeholder="ENTER USERNAME"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
            returnKeyType="next"
          />
          <View style={styles.passwordWrap}>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="ENTER PASSWORD"
              placeholderTextColor={colors.textFaint}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.input, { marginBottom: 0, paddingRight: 48 }]}
            />
            <Pressable hitSlop={10} onPress={() => setShowPassword((v) => !v)} style={styles.eye}>
              <MaterialIcons name={showPassword ? 'visibility-off' : 'visibility'} size={22} color={colors.textMuted} />
            </Pressable>
          </View>

          <View style={styles.captchaRow}>
            <Pressable accessibilityLabel="New captcha" hitSlop={10} onPress={() => { tap(); void loadCaptcha(); }} style={styles.refresh}>
              {captchaLoading ? <ActivityIndicator color={colors.navy} /> : <MaterialIcons name="refresh" size={24} color={colors.navy} />}
            </Pressable>
            <Text style={styles.question}>{captcha?.question || '...'}</Text>
            <Text style={styles.equals}>=</Text>
            <TextInput
              value={captchaAnswer}
              onChangeText={setCaptchaAnswer}
              keyboardType="number-pad"
              style={[styles.input, styles.captchaInput]}
              onSubmitEditing={submit}
              returnKeyType="go"
            />
          </View>
          <Text style={styles.human}>Please verify you are a human.</Text>

          <PrimaryButton label="LOGIN" onPress={submit} loading={submitting} style={{ marginTop: 18 }} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flexGrow: 1, paddingHorizontal: 20 },
  brandRow: { flexDirection: 'row', alignSelf: 'center', alignItems: 'flex-start', marginBottom: 36 },
  brand: { color: colors.white, fontSize: 36, fontWeight: '600', letterSpacing: -0.5 },
  live: { color: colors.white, fontSize: 12, fontWeight: '700', marginLeft: 3 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 22 },
  heading: { fontSize: 28, fontWeight: '700', color: colors.navy },
  sub: { fontSize: 14, color: colors.textMuted, marginTop: 4, marginBottom: 18 },
  alert: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: '#FDECEE', borderRadius: radius.sm, padding: 10, marginBottom: 14 },
  alertText: { flex: 1, color: colors.crimson, fontSize: 13, fontWeight: '600' },
  input: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
    marginBottom: 12,
  },
  passwordWrap: { justifyContent: 'center', marginBottom: 12 },
  eye: { position: 'absolute', right: 14 },
  captchaRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  refresh: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.canvas },
  question: { fontSize: 20, fontWeight: '800', color: colors.navy, minWidth: 80, textAlign: 'center' },
  equals: { fontSize: 20, fontWeight: '700', color: colors.text },
  captchaInput: { flex: 1, minWidth: 0, width: 0, marginBottom: 0, textAlign: 'center', fontSize: 18 },
  human: { fontSize: 12, color: colors.textMuted, textAlign: 'center', marginTop: 8 },
});

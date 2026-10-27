import { Platform, TextStyle, ViewStyle } from 'react-native';

// PB Exchange mobile design tokens — taken from the live app's screenshots
export const colors = {
  navy: '#152847', // header, bottom bar, primary buttons
  navyDark: '#0F1D35', // status bar, pressed states
  navyBanner: '#1B2F52', // greeting banner gradient end
  canvas: '#F4F6F9', // screen background
  surface: '#FFFFFF', // cards
  surfaceMuted: '#F7F7F8', // list rows
  border: '#E3E6EC',
  divider: '#ECEEF2',
  text: '#1F2937',
  textMuted: '#6B7280',
  textFaint: '#9CA3AF',
  coral: '#E76F51', // declared result badge
  coralSoft: '#F28B6B',
  crimson: '#D90429', // live sale / exposure pill
  dateRed: '#C2410C', // date on shift cards
  peach: '#F4A261', // "Sale" label
  cyan: '#0284C7', // ledger group / role tags
  amber: '#F59E0B', // role tags, codes
  amberDark: '#D97706',
  magenta: '#E11D48', // staff sub-labels
  green: '#059669',
  white: '#FFFFFF',
  overlay: 'rgba(15,29,53,0.55)',
};

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 };
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24 };

export const shadow: ViewStyle = Platform.select<ViewStyle>({
  ios: { shadowColor: '#0F1D35', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  default: { elevation: 3 },
}) as ViewStyle;

// Condensed uppercase look of the live app (system font, tracked capitals)
export const font = {
  title: { fontSize: 22, fontWeight: '700', letterSpacing: 0.5, color: colors.white } as TextStyle,
  h1: { fontSize: 20, fontWeight: '700', letterSpacing: 0.4, color: colors.text, textTransform: 'uppercase' } as TextStyle,
  h2: { fontSize: 16, fontWeight: '700', letterSpacing: 0.3, color: colors.text, textTransform: 'uppercase' } as TextStyle,
  body: { fontSize: 14, color: colors.text } as TextStyle,
  small: { fontSize: 12, color: colors.textMuted } as TextStyle,
  label: { fontSize: 12, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' } as TextStyle,
};

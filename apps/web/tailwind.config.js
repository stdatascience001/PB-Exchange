/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        pb: {
          dark: '#0f172a',
          darker: '#080d1a',
          card: '#1e293b',
          border: '#334155',
          gold: '#f59e0b',
          accent: '#3b82f6',
          danger: '#ef4444',
          success: '#10b981',
          pink: '#ec4899',
        },
      },
    },
  },
  plugins: [],
}

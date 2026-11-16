/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      fontFamily: {
        display: ['Georgia', '"Iowan Old Style"', '"Palatino Linotype"', 'serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
        sans: ['"Inter"', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        linen: 'var(--bg-linen)',
        surface: 'var(--bg-surface)',
        card: 'var(--bg-card)',
        ink: 'var(--text-ink)',
        muted: 'var(--text-muted)',
        crimson: 'var(--accent-crimson)',
        indigoFolk: 'var(--accent-indigo)',
        ochre: 'var(--accent-ochre)',
        sage: 'var(--accent-sage)',
        borderFolk: 'var(--border-folk)',
      },
    },
  },
  plugins: [],
};

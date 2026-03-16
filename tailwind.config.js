/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['Syne', 'sans-serif'],
        sans: ['DM Sans', 'sans-serif'],
      },
      colors: {
        flare: {
          50: '#fff7ed',
          100: '#ffedd5',
          400: '#fb923c',
          500: '#f97316',
          600: '#ea6c0a',
        },
        surface: {
          DEFAULT: '#13131A',
          raised: '#1C1C26',
          overlay: '#252532',
        },
      },
      animation: {
        'story-progress': 'story-progress linear forwards',
        'fade-up': 'fadeUp 0.3s ease forwards',
        'scale-in': 'scaleIn 0.2s ease forwards',
        'slide-up': 'slideUp 0.35s cubic-bezier(0.34,1.56,0.64,1) forwards',
      },
      keyframes: {
        'story-progress': { from: { width: '0%' }, to: { width: '100%' } },
        fadeUp: { from: { opacity: 0, transform: 'translateY(12px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
        scaleIn: { from: { opacity: 0, transform: 'scale(0.92)' }, to: { opacity: 1, transform: 'scale(1)' } },
        slideUp: { from: { opacity: 0, transform: 'translateY(24px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
      },
    },
  },
  plugins: [],
};

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        cream: '#FAFAF7',
        deep:  '#1A1535',
        gold:  '#C9A84C',
        mist:  '#4A3F6B',
      },
      fontFamily: {
        georgia: ['Georgia', 'Times New Roman', 'serif'],
        bodoni: ['"Bodoni Moda"', 'Didot', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
}

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // reclaim-yard palette
        verdigris: { 50: '#EAF3F1', 100: '#D3E7E3', 300: '#7FB4AB', 500: '#2D8378', 600: '#1E6E66', 700: '#175650', 800: '#123F3B' },
        graphite: { 400: '#7B8287', 500: '#5B6267', 600: '#41474B', 800: '#2B3033', 900: '#1F2427' },
        slab: { 50: '#F7F8F6', 100: '#F1F2EF', 200: '#E6E8E4', 300: '#DCDFDB', 400: '#C5C9C4' },
        tag: { 300: '#F7D774', 400: '#F2C230', 600: '#B88A0B' },
        brick: { 50: '#F8ECE9', 500: '#A23E2C', 600: '#86321F' },
      },
      fontFamily: { sans: ['"Archivo Variable"', 'Archivo', 'system-ui', 'sans-serif'] },
      fontSize: {
        // modular scale ~1.25
        xs: ['0.75rem', '1.1rem'], sm: ['0.875rem', '1.3rem'], base: ['1rem', '1.55rem'],
        lg: ['1.25rem', '1.75rem'], xl: ['1.5625rem', '2rem'], '2xl': ['1.953rem', '2.3rem'], '3xl': ['2.441rem', '2.7rem'], '4xl': ['3.052rem', '3.2rem'],
      },
    },
  },
  plugins: [],
};

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Shared accent palette for the dashboard chrome.
        panel: 'rgba(10, 14, 22, 0.55)',
        accent: '#38bdf8',
      },
      backdropBlur: {
        xs: '2px',
      },
    },
  },
  plugins: [],
};

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/app/**/*.{ts,tsx,js,jsx}',
    './src/components/**/*.{ts,tsx,js,jsx}',
    './src/**/*.{ts,tsx,js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Brand
        emerald: {
          50: '#f7fbe8',
          100: '#f0f7d0',
          200: '#e0f09f',
          500: '#84cc16',
          600: '#6fb012',
          700: '#5a900e',
        },
        // Slate -> adapted to project palette
        slate: {
          50: '#f5f7fa',
          100: '#eef2f6',
          200: '#e6ebef',
          300: '#cfd8df',
          500: '#8b98a1',
          600: '#52606d',
          700: '#3b4650',
          900: '#1f2933',
          950: '#1f2933',
        },
        // aliases for explicit names
        'brand-lime': '#84cc16',
        'charcoal': '#1f2933',
        'dark-green': '#1a2e05',
        'mid-gray': '#52606d',
        'bg-light': '#f5f7fa',
      },
      borderRadius: {
        '3xl': '1.5rem',
      },
    },
  },
  plugins: [],
};

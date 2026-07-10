import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        yd: {
          bg:      '#121321',
          navy:    '#1D1E2F',
          card:    '#2D2E43',
          card2:   '#252636',
          orange:  '#F66C31',
          orangeHover: '#E05A20',
          yellow:  '#FBC318',
          yellowHover: '#E8AF0A',
          muted:   'rgba(255,255,255,0.5)',
          border:  'rgba(255,255,255,0.08)',
        },
      },
      fontFamily: {
        display: ['Righteous', 'cursive'],
        body:    ['"Plus Jakarta Sans"', 'sans-serif'],
      },
      keyframes: {
        slideUp: {
          '0%':   { transform: 'translateY(20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)',    opacity: '1' },
        },
        fadeIn: {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
      animation: {
        slideUp: 'slideUp 0.3s ease-out',
        fadeIn:  'fadeIn 0.2s ease-out',
      },
    },
  },
  plugins: [],
}

export default config

import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: { extend: {} },
  plugins: [require("@tailwindcss/typography"), require("daisyui")],
  daisyui: {
    themes: [
      {
        lumina: {
          "primary": "#3b82f6", // blue-500, matches the existing link color
          "secondary": "#a3a3a3", // neutral-400
          "accent": "#22c55e", // green-500, matches existing "ok" status color
          "neutral": "#171717", // neutral-900
          "base-100": "#0a0a0a", // neutral-950, matches layout.tsx's bg
          "base-200": "#171717", // neutral-900
          "base-300": "#262626", // neutral-800
          "info": "#3b82f6",
          "success": "#22c55e",
          "warning": "#eab308",
          "error": "#ef4444", // red-500, matches existing error color
        },
      },
    ],
  },
};

export default config;

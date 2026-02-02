/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    darkMode: ['class', '[data-theme="dark"]'],
    theme: {
        extend: {
            colors: {
                background: 'var(--bg-primary)',
                foreground: 'var(--text-primary)',
                muted: {
                    DEFAULT: 'var(--bg-tertiary)',
                    foreground: 'var(--text-muted)',
                },
                accent: {
                    DEFAULT: 'var(--accent-primary)',
                    foreground: 'white',
                },
                border: 'var(--border-subtle)',
            },
            borderRadius: {
                lg: 'var(--radius-lg)',
                md: 'var(--radius-md)',
                sm: 'var(--radius-sm)',
            },
        },
    },
    plugins: [],
}

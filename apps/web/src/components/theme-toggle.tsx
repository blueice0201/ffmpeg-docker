import { useEffect, useState } from 'react';
import { getStoredTheme, getSystemTheme, setTheme, type Theme } from '~/lib/theme';

function SunIcon(): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.05 3.05l1.06 1.06M11.89 11.89l1.06 1.06M3.05 12.95l1.06-1.06M11.89 4.11l1.06-1.06"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon(): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M12.2 9.4a5.5 5.5 0 0 1-6.6-6.6A5.5 5.5 0 1 0 12.2 9.4Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ThemeToggle(): React.JSX.Element {
  const [theme, setThemeState] = useState<Theme>(() => getStoredTheme() ?? getSystemTheme());

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = (): void => {
      if (!getStoredTheme()) {
        const next = media.matches ? 'light' : 'dark';
        setThemeState(next);
        setTheme(next);
      }
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const toggle = (): void => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setThemeState(next);
    setTheme(next);
  };

  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="flex size-8 items-center justify-center rounded-[var(--radius-md)] border border-stone-strong bg-elevated text-ink-secondary transition-colors hover:border-accent hover:bg-accent-soft hover:text-ink"
    >
      {isDark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

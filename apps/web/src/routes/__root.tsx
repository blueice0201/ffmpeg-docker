import { Link, Outlet, createRootRoute, useRouterState } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { ThemeToggle } from '~/components/theme-toggle';

const RouterDevtools = import.meta.env.DEV
  ? lazy(async () => {
      const mod = await import('@tanstack/router-devtools');
      return { default: mod.TanStackRouterDevtools };
    })
  : null;

export const Route = createRootRoute({
  component: RootComponent
});

function RootComponent(): React.JSX.Element {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isLogin = pathname === '/login';

  return (
    <div className="relative isolate flex min-h-dvh flex-col overflow-x-hidden">
      <div className="ambient-orb ambient-orb--a" aria-hidden="true" />
      <div className="ambient-orb ambient-orb--b" aria-hidden="true" />

      {!isLogin && (
        <header className="relative z-10 mx-auto flex w-full max-w-[1080px] items-center justify-between px-3 pt-4 md:px-5 md:pt-5">
          <Link to="/" className="group flex items-center gap-2 no-underline">
            <span className="flex size-7 items-center justify-center rounded-[var(--radius-md)] border border-stone-strong bg-elevated text-xs font-bold text-accent">
              ff
            </span>
            <span className="text-sm font-semibold tracking-tight text-ink-secondary transition-colors group-hover:text-ink">
              ffmpeg
            </span>
          </Link>
          <div className="flex items-center gap-4">
            <nav className="flex items-center gap-3 text-xs">
              <Link
                to="/"
                className="font-medium text-ink-muted transition-colors hover:text-ink-secondary"
                activeProps={{ className: 'font-medium text-ink' }}
              >
                Convert
              </Link>
              <Link
                to="/compose"
                className="font-medium text-ink-muted transition-colors hover:text-ink-secondary"
                activeProps={{ className: 'font-medium text-ink' }}
              >
                Compose
              </Link>
            </nav>
            <ThemeToggle />
            <form method="post" action="/auth/logout">
              <button
                type="submit"
                className="text-xs font-medium text-ink-muted transition-colors hover:text-ink-secondary"
              >
                Log out
              </button>
            </form>
          </div>
        </header>
      )}

      <main className="relative z-10 flex flex-1 flex-col">
        <Outlet />
      </main>

      {import.meta.env.DEV && RouterDevtools ? (
        <Suspense fallback={null}>
          <RouterDevtools />
        </Suspense>
      ) : null}
    </div>
  );
}

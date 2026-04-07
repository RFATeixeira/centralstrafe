"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { useAuthSession } from "@/components/auth-provider";
import { canManageRoles } from "@/lib/roles";

const navItems = [
  { href: "/", label: "Inicio", disabled: false },
  { href: "/granadas", label: "Granadas", disabled: false },
  { href: "/movimentacoes", label: "Movimentações", disabled: true },
  { href: "/calls", label: "Calls", disabled: true },
];

function RoleBadgeIcon({ role }: { role: string | null | undefined }) {
  if (role === "owner") {
    return (
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4 text-orange-300"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M3.75 17.25h16.5l-1.5-8.25-4.5 3-2.25-5.25L9.75 12l-4.5-3-1.5 8.25z" />
      </svg>
    );
  }

  if (role === "admin") {
    return (
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4 text-orange-300"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 3.75l7.5 3v5.91c0 4.38-3.03 7.98-7.12 8.88a1.4 1.4 0 0 1-.76 0C7.53 20.64 4.5 17.04 4.5 12.66V6.75l7.5-3z" />
      </svg>
    );
  }

  if (role === "mod") {
    return (
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4 text-orange-300"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M11.48 3.5a.56.56 0 0 1 1.04 0l2.07 5.06a.56.56 0 0 0 .48.35l5.45.44a.56.56 0 0 1 .32.98l-4.15 3.56a.56.56 0 0 0-.18.56l1.27 5.31a.56.56 0 0 1-.84.61l-4.67-2.86a.56.56 0 0 0-.58 0l-4.67 2.86a.56.56 0 0 1-.84-.61l1.27-5.31a.56.56 0 0 0-.18-.56L3.16 10.33a.56.56 0 0 1 .32-.98l5.45-.44a.56.56 0 0 0 .48-.35l2.07-5.06z" />
      </svg>
    );
  }

  return null;
}

export function SiteHeader() {
  const pathname = usePathname();
  const { user, role, loading, loginWithGoogle, logout } = useAuthSession();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const authLabel = useMemo(() => {
    if (loading) {
      return "Validando sessao";
    }

    if (user) {
      const displayName = user.displayName ?? user.email ?? "Usuario";
      return displayName;
    }

    return "Modo visitante";
  }, [loading, user]);

  return (
    <div className="mx-auto w-full max-w-400 px-3 py-5 pb-0 text-slate-100 sm:px-4 lg:px-6">
      <nav className="sticky top-3 z-30 mb-4 rounded-2xl border border-slate-700/80 bg-slate-950/85 px-4 py-2 backdrop-blur">
        <div className="relative flex items-center justify-center gap-3 md:justify-between">
          <p className="absolute left-0 top-1/2 inline-flex max-w-[44vw] -translate-y-1/2 items-center gap-1.5 rounded-full border border-slate-600 px-2.5 py-0.5 text-xs text-slate-300 md:hidden">
            <RoleBadgeIcon role={role} />
            <span className="truncate">{authLabel}</span>
          </p>

          <div className="flex flex-col items-center md:flex-1 md:items-start">
            <Link href="/" className="inline-flex">
              <Image
                src="/logo-cs-white.png"
                alt="CentralStrafe logo branco"
                width={116}
                height={27}
                className="h-auto w-auto"
                priority
              />
            </Link>
          </div>

          <button
            type="button"
            onClick={() => setMobileMenuOpen((current) => !current)}
            className="absolute right-0 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg border border-slate-600 bg-slate-900 text-slate-100 transition hover:border-slate-400 md:hidden"
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-site-menu"
            aria-label={mobileMenuOpen ? "Fechar menu" : "Abrir menu"}
          >
            <span className="sr-only">Menu</span>
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              {mobileMenuOpen ? (
                <path d="M6 6l12 12M18 6L6 18" />
              ) : (
                <>
                  <path d="M4 7h16" />
                  <path d="M4 12h16" />
                  <path d="M4 17h16" />
                </>
              )}
            </svg>
          </button>

          <div className="hidden flex-wrap items-center justify-center gap-1.5 text-sm text-slate-300 md:flex md:flex-1">
            {navItems.map((item) => {
              const isActive = pathname === item.href;

              if (item.disabled) {
                return (
                  <span
                    key={item.href}
                    className="group relative inline-flex"
                    aria-disabled="true"
                  >
                    <span className="cursor-not-allowed rounded-md px-2.5 py-1 text-slate-500">
                      {item.label}
                    </span>
                    <span className="pointer-events-none absolute left-1/2 top-full z-40 mt-1 -translate-x-1/2 whitespace-nowrap rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-[11px] font-medium text-slate-200 opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100">
                      Em breve
                    </span>
                  </span>
                );
              }

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-md px-2.5 py-1 transition ${
                    isActive
                      ? "bg-orange-400/90 text-slate-950"
                      : "hover:bg-slate-800 hover:text-white"
                  }`}
                  aria-current={isActive ? "page" : undefined}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>

          <div className="hidden items-center justify-end gap-1.5 md:flex md:flex-1">
            <p className="inline-flex items-center gap-1.5 rounded-full border border-slate-600 px-2.5 py-0.5 text-xs text-slate-300">
              <RoleBadgeIcon role={role} />
              <span>{authLabel}</span>
            </p>

            {!user ? (
              <button
                type="button"
                onClick={() => void loginWithGoogle()}
                className="rounded-lg border border-orange-300/40 bg-orange-400 px-2.5 py-1.5 text-sm font-semibold text-slate-950 transition hover:brightness-110"
              >
                Entrar
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void logout()}
                className="rounded-lg border border-slate-500 bg-slate-800 px-2.5 py-1.5 text-sm font-semibold text-slate-100 transition hover:border-slate-300"
              >
                Sair
              </button>
            )}

            {canManageRoles(role) && (
              <Link
                href="/painel"
                className={`rounded-lg border px-2.5 py-1.5 text-sm font-semibold transition ${
                  pathname === "/painel"
                    ? "border-orange-300/45 bg-orange-400 text-slate-950"
                    : "border-slate-500 bg-slate-800 text-slate-100 hover:border-slate-300"
                }`}
                aria-current={pathname === "/painel" ? "page" : undefined}
              >
                Painel
              </Link>
            )}
          </div>
        </div>

        <div
          id="mobile-site-menu"
          className={`${mobileMenuOpen ? "mt-3 flex" : "hidden"} flex-col gap-3 border-t border-slate-700/80 pt-3 md:hidden`}
        >
          <div className="flex flex-col gap-1 text-sm text-slate-300">
            {navItems.map((item) => {
              const isActive = pathname === item.href;

              if (item.disabled) {
                return (
                  <span
                    key={item.href}
                    className="group relative inline-flex"
                    aria-disabled="true"
                  >
                    <span className="cursor-not-allowed rounded-md px-2.5 py-1 text-slate-500">
                      {item.label}
                    </span>
                    <span className="pointer-events-none absolute left-1/2 top-full z-40 mt-1 -translate-x-1/2 whitespace-nowrap rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-[11px] font-medium text-slate-200 opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100">
                      Em breve
                    </span>
                  </span>
                );
              }

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`rounded-md px-2.5 py-2 transition ${
                    isActive
                      ? "bg-orange-400/90 text-slate-950"
                      : "hover:bg-slate-800 hover:text-white"
                  }`}
                  aria-current={isActive ? "page" : undefined}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>

          <div className="flex flex-col gap-2">
            {!user ? (
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  void loginWithGoogle();
                }}
                className="rounded-lg border border-orange-300/40 bg-orange-400 px-2.5 py-1.5 text-sm font-semibold text-slate-950 transition hover:brightness-110"
              >
                Entrar
              </button>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    void logout();
                  }}
                  className="rounded-lg border border-slate-500 bg-slate-800 px-2.5 py-1.5 text-sm font-semibold text-slate-100 transition hover:border-slate-300"
                >
                  Sair
                </button>

                {canManageRoles(role) ? (
                  <Link
                    href="/painel"
                    onClick={() => setMobileMenuOpen(false)}
                    className={`rounded-lg border px-2.5 py-2 text-center text-sm font-semibold transition ${
                      pathname === "/painel"
                        ? "border-orange-300/45 bg-orange-400 text-slate-950"
                        : "border-slate-500 bg-slate-800 text-slate-100 hover:border-slate-300"
                    }`}
                    aria-current={pathname === "/painel" ? "page" : undefined}
                  >
                    Painel
                  </Link>
                ) : (
                  <span className="rounded-lg border border-transparent px-2.5 py-2" aria-hidden="true" />
                )}
              </div>
            )}
          </div>
        </div>
      </nav>
    </div>
  );
}

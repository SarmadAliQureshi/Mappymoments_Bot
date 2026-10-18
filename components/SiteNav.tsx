"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/color-themes", label: "AI Color Themes" },
  { href: "/", label: "Map Studio" },
  { href: "/ad-studio", label: "Ad Studio" },
];

export default function SiteNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="sticky top-0 z-20 border-b border-tobacco/15 bg-parchment/90 backdrop-blur"
    >
      <ul className="mx-auto flex w-full max-w-5xl gap-1 overflow-x-auto px-4 sm:px-6">
        {TABS.map((tab) => {
          const current =
            tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={current ? "page" : undefined}
                className={`block whitespace-nowrap border-b-2 px-3 py-3 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-terracotta/40 ${
                  current
                    ? "border-terracotta font-bold text-ink"
                    : "border-transparent text-ink/70 hover:text-ink"
                }`}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

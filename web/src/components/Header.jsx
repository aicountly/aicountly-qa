import { useEffect, useState } from 'react'
import { navLinks, site } from '../config/site'

export default function Header({ onPaymentClick }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [menuOpen])

  const closeMenu = () => setMenuOpen(false)

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled || menuOpen
          ? 'border-b border-white/10 bg-slate-950/90 backdrop-blur-lg shadow-lg shadow-black/20'
          : 'bg-transparent'
      }`}
    >
      <div className="section-container flex h-16 items-center justify-between sm:h-20">
        <a href="#home" className="flex items-center gap-2.5" onClick={closeMenu}>
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-700 text-sm font-bold text-white shadow-lg shadow-brand-600/30">
            S
          </span>
          <span className="font-display text-lg font-bold tracking-tight text-white sm:text-xl">
            {site.name}
          </span>
        </a>

        <nav className="hidden items-center gap-8 lg:flex">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-slate-300 transition-colors hover:text-white"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-3 lg:flex">
          <a
            href="#contact"
            className="rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold text-white transition hover:border-white/30 hover:bg-white/5"
          >
            Get Quote
          </a>
          <button
            type="button"
            onClick={onPaymentClick}
            className="rounded-xl bg-gradient-to-r from-brand-500 to-brand-700 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-brand-600/30 transition hover:from-brand-400 hover:to-brand-600"
          >
            Payment
          </button>
        </div>

        <button
          type="button"
          className="relative z-50 flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 text-white lg:hidden"
          onClick={() => setMenuOpen((open) => !open)}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
        >
          <span className="sr-only">{menuOpen ? 'Close menu' : 'Open menu'}</span>
          <div className="flex w-5 flex-col gap-1.5">
            <span
              className={`block h-0.5 w-full bg-white transition-transform ${menuOpen ? 'translate-y-2 rotate-45' : ''}`}
            />
            <span className={`block h-0.5 w-full bg-white transition-opacity ${menuOpen ? 'opacity-0' : ''}`} />
            <span
              className={`block h-0.5 w-full bg-white transition-transform ${menuOpen ? '-translate-y-2 -rotate-45' : ''}`}
            />
          </div>
        </button>
      </div>

      {menuOpen && (
        <div className="fixed inset-0 top-16 z-40 bg-slate-950/98 backdrop-blur-xl lg:hidden">
          <nav className="section-container flex flex-col gap-1 py-6">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={closeMenu}
                className="rounded-xl px-4 py-3 text-lg font-medium text-slate-200 transition hover:bg-white/5 hover:text-white"
              >
                {link.label}
              </a>
            ))}
            <div className="mt-4 flex flex-col gap-3 border-t border-white/10 pt-6">
              <a
                href="#contact"
                onClick={closeMenu}
                className="rounded-xl border border-white/15 px-4 py-3 text-center font-semibold text-white"
              >
                Get Quote
              </a>
              <button
                type="button"
                onClick={() => {
                  closeMenu()
                  onPaymentClick()
                }}
                className="rounded-xl bg-gradient-to-r from-brand-500 to-brand-700 px-4 py-3 font-semibold text-white"
              >
                Payment
              </button>
            </div>
          </nav>
        </div>
      )}
    </header>
  )
}

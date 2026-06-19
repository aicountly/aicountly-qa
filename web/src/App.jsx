import { useState } from 'react'
import Header from './components/Header'
import PaymentModal from './components/PaymentModal'
import { reasons, services, site, stats, testimonials } from './config/site'

export default function App() {
  const [paymentOpen, setPaymentOpen] = useState(false)
  const openPayment = () => setPaymentOpen(true)

  return (
    <>
      <Header onPaymentClick={openPayment} />
      <PaymentModal open={paymentOpen} onClose={() => setPaymentOpen(false)} />

      <main>
        {/* Hero */}
        <section id="home" className="relative overflow-hidden pt-16 sm:pt-20">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute -left-32 top-20 h-96 w-96 rounded-full bg-brand-600/20 blur-3xl" />
            <div className="absolute -right-32 top-40 h-80 w-80 rounded-full bg-indigo-600/15 blur-3xl" />
            <div className="absolute bottom-0 left-1/2 h-64 w-[600px] -translate-x-1/2 rounded-full bg-brand-500/10 blur-3xl" />
          </div>

          <div className="section-container relative py-16 sm:py-24 lg:py-32">
            <div className="mx-auto max-w-4xl text-center">
              <div className="mb-6 inline-flex animate-fade-up items-center gap-2 rounded-full border border-brand-500/30 bg-brand-500/10 px-4 py-1.5 text-sm font-medium text-brand-300">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-400" />
                </span>
                Trusted IT Partner Since 2012
              </div>

              <h1 className="animate-fade-up font-display text-4xl font-extrabold leading-tight tracking-tight text-white sm:text-5xl lg:text-6xl [animation-delay:100ms]">
                {site.tagline.split(' ').slice(0, 2).join(' ')}{' '}
                <span className="bg-gradient-to-r from-brand-300 via-brand-400 to-indigo-400 bg-clip-text text-transparent">
                  {site.tagline.split(' ').slice(2).join(' ')}
                </span>
              </h1>

              <p className="mx-auto mt-6 max-w-2xl animate-fade-up text-base leading-relaxed text-slate-400 sm:text-lg [animation-delay:200ms]">
                We help businesses build, secure, and scale their technology — from cloud infrastructure
                and custom software to managed IT and cybersecurity.
              </p>

              <div className="mt-10 flex animate-fade-up flex-col items-center justify-center gap-4 sm:flex-row [animation-delay:300ms]">
                <a
                  href="#contact"
                  className="w-full rounded-xl bg-gradient-to-r from-brand-500 to-brand-700 px-8 py-3.5 text-sm font-semibold text-white shadow-xl shadow-brand-600/25 transition hover:from-brand-400 hover:to-brand-600 sm:w-auto"
                >
                  Start Your Project
                </a>
                <button
                  type="button"
                  onClick={openPayment}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-8 py-3.5 text-sm font-semibold text-emerald-300 transition hover:border-emerald-400/60 hover:bg-emerald-500/20 sm:w-auto"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                  </svg>
                  Payment
                </button>
                <a
                  href="#services"
                  className="w-full rounded-xl border border-white/15 px-8 py-3.5 text-sm font-semibold text-white transition hover:border-white/30 hover:bg-white/5 sm:w-auto"
                >
                  Explore Services
                </a>
              </div>
            </div>

            {/* Stats strip */}
            <div className="mx-auto mt-16 grid max-w-4xl grid-cols-2 gap-4 sm:grid-cols-4 lg:mt-24">
              {stats.map((stat) => (
                <div key={stat.label} className="glass-card p-4 text-center sm:p-6">
                  <div className="font-display text-2xl font-bold text-white sm:text-3xl">{stat.value}</div>
                  <div className="mt-1 text-xs text-slate-400 sm:text-sm">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Services */}
        <section id="services" className="py-16 sm:py-24">
          <div className="section-container">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-sm font-semibold uppercase tracking-wider text-brand-400">Our Services</p>
              <h2 className="mt-2 font-display text-3xl font-bold text-white sm:text-4xl">
                Technology Solutions That Drive Growth
              </h2>
              <p className="mt-4 text-slate-400">
                Comprehensive IT services designed to solve real business challenges and accelerate digital success.
              </p>
            </div>

            <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {services.map((service) => (
                <article
                  key={service.title}
                  className="glass-card group p-6 transition hover:border-brand-500/30 hover:bg-white/[0.07] sm:p-8"
                >
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-500/10 text-2xl transition group-hover:scale-110">
                    {service.icon}
                  </div>
                  <h3 className="font-display text-lg font-bold text-white">{service.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400">{service.description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* About */}
        <section id="about" className="py-16 sm:py-24">
          <div className="section-container">
            <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
              <div>
                <p className="text-sm font-semibold uppercase tracking-wider text-brand-400">About {site.name}</p>
                <h2 className="mt-2 font-display text-3xl font-bold text-white sm:text-4xl">
                  Your Partner in Digital Excellence
                </h2>
                <p className="mt-4 leading-relaxed text-slate-400">
                  {site.name} is a full-service IT company delivering innovative technology solutions to businesses
                  across India and beyond. We combine deep technical expertise with a client-first approach to
                  deliver projects that exceed expectations.
                </p>
                <p className="mt-4 leading-relaxed text-slate-400">
                  Whether you need to modernize legacy systems, build a new product, or outsource your IT
                  operations, our certified team is ready to help you succeed.
                </p>
                <ul className="mt-8 space-y-3">
                  {['ISO-aligned processes', 'Dedicated project managers', 'Flexible engagement models', 'Post-launch support'].map(
                    (item) => (
                      <li key={item} className="flex items-center gap-3 text-sm text-slate-300">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-500/20 text-xs text-brand-400">
                          ✓
                        </span>
                        {item}
                      </li>
                    ),
                  )}
                </ul>
              </div>

              <div className="relative">
                <div className="glass-card animate-float overflow-hidden p-8">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="rounded-xl bg-gradient-to-br from-brand-600/30 to-brand-800/30 p-6">
                      <div className="text-3xl font-bold text-white">150+</div>
                      <div className="mt-1 text-sm text-brand-200">Happy Clients</div>
                    </div>
                    <div className="rounded-xl bg-gradient-to-br from-indigo-600/30 to-indigo-800/30 p-6">
                      <div className="text-3xl font-bold text-white">50+</div>
                      <div className="mt-1 text-sm text-indigo-200">Tech Experts</div>
                    </div>
                    <div className="col-span-2 rounded-xl border border-white/10 bg-slate-900/50 p-6">
                      <div className="flex items-center gap-3">
                        <div className="flex -space-x-2">
                          {['A', 'B', 'C', 'D'].map((letter) => (
                            <div
                              key={letter}
                              className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-slate-900 bg-brand-600 text-xs font-bold text-white"
                            >
                              {letter}
                            </div>
                          ))}
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-white">Expert Team</div>
                          <div className="text-xs text-slate-400">Cloud · Dev · Security</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Why Us */}
        <section id="why-us" className="py-16 sm:py-24">
          <div className="section-container">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-sm font-semibold uppercase tracking-wider text-brand-400">Why Choose Us</p>
              <h2 className="mt-2 font-display text-3xl font-bold text-white sm:text-4xl">
                Built on Trust, Driven by Results
              </h2>
            </div>

            <div className="mt-12 grid gap-6 sm:grid-cols-2">
              {reasons.map((reason) => (
                <div key={reason.title} className="glass-card flex gap-4 p-6 sm:p-8">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-500/15 font-display text-sm font-bold text-brand-400">
                    {reason.title.charAt(0)}
                  </div>
                  <div>
                    <h3 className="font-display font-bold text-white">{reason.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-slate-400">{reason.description}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-12 grid gap-6 md:grid-cols-2">
              {testimonials.map((item) => (
                <blockquote key={item.author} className="glass-card p-6 sm:p-8">
                  <p className="text-sm italic leading-relaxed text-slate-300">&ldquo;{item.quote}&rdquo;</p>
                  <footer className="mt-4">
                    <div className="font-semibold text-white">{item.author}</div>
                    <div className="text-xs text-slate-500">{item.role}</div>
                  </footer>
                </blockquote>
              ))}
            </div>
          </div>
        </section>

        {/* Payment CTA */}
        <section id="payment" className="py-16 sm:py-24">
          <div className="section-container">
            <div className="relative overflow-hidden rounded-3xl border border-emerald-500/20 bg-gradient-to-br from-emerald-950/80 via-slate-900 to-slate-950 p-8 sm:p-12 lg:p-16">
              <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-emerald-500/10 blur-3xl" />
              <div className="relative mx-auto max-w-2xl text-center">
                <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 py-1.5 text-sm font-medium text-emerald-300">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  Secure Online Payments
                </div>
                <h2 className="font-display text-3xl font-bold text-white sm:text-4xl">
                  Pay Your Invoice Online
                </h2>
                <p className="mt-4 text-slate-400">
                  Quickly settle invoices using our secure payment portal. Enter your reference number and
                  amount to proceed.
                </p>
                <button
                  type="button"
                  onClick={openPayment}
                  className="mt-8 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-700 px-8 py-3.5 text-sm font-semibold text-white shadow-xl shadow-emerald-600/25 transition hover:from-emerald-400 hover:to-emerald-600"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                  </svg>
                  Make Payment
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Contact */}
        <section id="contact" className="py-16 sm:py-24">
          <div className="section-container">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-sm font-semibold uppercase tracking-wider text-brand-400">Contact Us</p>
              <h2 className="mt-2 font-display text-3xl font-bold text-white sm:text-4xl">
                Let&apos;s Build Something Great
              </h2>
              <p className="mt-4 text-slate-400">
                Ready to start your next project? Reach out and our team will get back to you within 24 hours.
              </p>

              <dl className="mt-10 space-y-6 text-left sm:mx-auto sm:max-w-md">
                <div className="flex items-start gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-500/15 text-brand-400">
                    ✉
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-slate-300">Email</dt>
                    <dd>
                      <a href={`mailto:${site.email}`} className="text-brand-400 hover:underline">
                        {site.email}
                      </a>
                    </dd>
                  </div>
                </div>
                <div className="flex items-start gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-500/15 text-brand-400">
                    ☎
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-slate-300">Mobile</dt>
                    <dd>
                      <a href={`tel:+91${site.phone}`} className="text-brand-400 hover:underline">
                        {site.phone}
                      </a>
                    </dd>
                  </div>
                </div>
                <div className="flex items-start gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-500/15 text-brand-400">
                    📍
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-slate-300">Address</dt>
                    <dd className="text-slate-400">{site.address}</dd>
                  </div>
                </div>
              </dl>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/10 py-10">
        <div className="section-container">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-700 text-xs font-bold text-white">
                S
              </span>
              <span className="font-display font-bold text-white">{site.name}</span>
            </div>

            <div className="space-y-2 text-sm text-slate-400">
              <p>
                <span className="font-medium text-slate-300">Address:</span> {site.address}
              </p>
              <p>
                <span className="font-medium text-slate-300">Mobile:</span>{' '}
                <a href={`tel:+91${site.phone}`} className="text-brand-400 hover:underline">
                  {site.phone}
                </a>
              </p>
              <p>
                <span className="font-medium text-slate-300">Email:</span>{' '}
                <a href={`mailto:${site.email}`} className="text-brand-400 hover:underline">
                  {site.email}
                </a>
              </p>
            </div>

            <div className="flex flex-col items-start gap-4 sm:items-end">
              <button
                type="button"
                onClick={openPayment}
                className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-300 transition hover:bg-emerald-500/20"
              >
                Payment
              </button>
              <p className="text-sm text-slate-500">
                &copy; {new Date().getFullYear()} {site.name}. All rights reserved.
              </p>
            </div>
          </div>
        </div>
      </footer>
    </>
  )
}

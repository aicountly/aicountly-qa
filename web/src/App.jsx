export default function App() {
  return (
    <div className="flex min-h-screen flex-col bg-white text-neutral-800">
      <header className="border-b border-aicountly-100 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-aicountly-600 text-sm font-bold text-white">
            QA
          </span>
          <div>
            <h1 className="text-lg font-semibold text-neutral-900">AICOUNTLY QA Portal</h1>
            <p className="text-sm text-neutral-500">qa.aicountly.org — Internal testing control centre</p>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-6 py-16">
        <div className="rounded-2xl border border-aicountly-100 bg-aicountly-50/50 p-8 sm:p-12">
          <p className="text-sm font-medium uppercase tracking-wide text-aicountly-700">Coming soon</p>
          <h2 className="mt-2 text-2xl font-bold text-neutral-900 sm:text-3xl">
            QA Testing Agent Portal
          </h2>
          <p className="mt-4 max-w-2xl text-neutral-600">
            Functional testing, deterministic dummy data, UI workflow validation, report verification,
            and evidence capture for approved AICOUNTLY target apps.
          </p>
          <ul className="mt-8 grid gap-3 sm:grid-cols-2">
            {[
              'Target App Profiles',
              'Session Plans & Approval',
              'Sequential Playwright Runs',
              'QA Reports & Audit Logs',
            ].map((item) => (
              <li
                key={item}
                className="flex items-center gap-2 rounded-lg border border-white bg-white px-4 py-3 text-sm text-neutral-700 shadow-sm"
              >
                <span className="text-aicountly-600">✓</span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      </main>

      <footer className="border-t border-neutral-100 px-6 py-4 text-center text-xs text-neutral-400">
        AICOUNTLY QA Portal — testing and reporting only; does not modify target app source code.
      </footer>
    </div>
  )
}

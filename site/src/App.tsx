import { DriveApp } from '@/components/DriveApp'
import { StorebaseLogo } from '@/components/StorebaseLogo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useState } from 'react'

const INSTALL = 'curl -fsSL https://raw.githubusercontent.com/NoahWhiteson/Storebase/main/install.sh | bash'
const GITHUB = 'https://github.com/NoahWhiteson/Storebase'

const fieldClass =
  'h-12 rounded-xl border-0 bg-[#242424] text-white shadow-none placeholder:text-[#8d8d8d] outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0'

export default function Landing() {
  const [copied, setCopied] = useState(false)

  async function copyInstall() {
    try {
      await navigator.clipboard.writeText(INSTALL)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="min-h-full bg-[#1a1a1a] text-[#e8e8e8]">
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between bg-[#1a1a1a]/95 px-4 backdrop-blur md:px-8">
        <a href="#top" className="flex items-center gap-2.5">
          <StorebaseLogo className="size-8" />
          <span className="text-[20px] font-medium tracking-tight text-white">Storebase</span>
        </a>
        <nav className="flex items-center gap-2">
          <a
            href="#install"
            className="hidden h-10 items-center rounded-full px-4 text-sm text-[#b3b3b3] hover:bg-white/5 hover:text-white sm:flex"
          >
            Install
          </a>
          <a
            href={GITHUB}
            className="hidden h-10 items-center rounded-full px-4 text-sm text-[#b3b3b3] hover:bg-white/5 hover:text-white sm:flex"
          >
            GitHub
          </a>
          <Button asChild className="h-10 rounded-full bg-white px-4 text-[#1a1a1a] hover:bg-[#f2f2f2]">
            <a href="#install">Get the installer</a>
          </Button>
        </nav>
      </header>

      <main id="top">
        <section className="mx-auto max-w-6xl px-4 pb-8 pt-10 md:px-8 md:pt-16">
          <p className="text-sm font-medium text-[#8d8d8d]">Self-hosted Drive</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-medium tracking-tight text-white md:text-5xl">
            Your files live on a machine you own.
          </h1>
          <p className="mt-4 max-w-2xl text-[15px] leading-7 text-[#8d8d8d]">
            Install it on a box you control, reserve disk, and every account gets a real profile. Uploads, shares,
            trash, Temp, and the Mac app all hit that node — not a browser-only cloud.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild className="h-11 rounded-full bg-white px-5 text-[#1a1a1a] hover:bg-[#f2f2f2]">
              <a href="#install">Install on a machine</a>
            </Button>
            <Button
              asChild
              variant="outline"
              className="h-11 rounded-full border-white/20 bg-transparent px-5 text-white hover:bg-white/10 hover:text-white"
            >
              <a href={GITHUB}>Source on GitHub</a>
            </Button>
          </div>
        </section>

        <section className="px-4 pb-16 md:px-8">
          <div className="mx-auto max-w-6xl overflow-hidden rounded-2xl border border-white/10 shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
            <div className="h-[min(78vh,820px)] min-h-[560px]">
              <DriveApp />
            </div>
          </div>
          <p className="mx-auto mt-3 max-w-6xl text-xs text-[#8d8d8d]">
            This is the actual Storebase chrome — sidebar, search, grid, Settings, Terminal — with sample files. Click
            around.
          </p>
        </section>

        <section className="mx-auto grid max-w-6xl gap-10 px-4 py-8 md:grid-cols-3 md:px-8 md:py-16">
          <Feature
            title="Per-user drives"
            body="Each signed-in account gets an isolated folder on the node. Node reserve is the disk cap. Admins can also set a per-user GB cap. Uploads fail if either cap would be exceeded."
          />
          <Feature
            title="Temp with a timer"
            body="Set 1 hour, 1 day, 3, 7, 30 days, or a custom count. Each file is deleted that long after it landed in Temp. Right-click Move to Temp, or keep it in My files."
          />
          <Feature
            title="Mac capture"
            body="Pair with a link and code. The Mac app watches Downloads, uploads, then leaves a cloud copy with the real name and icon. Double-click downloads from the node. Close it and the local bytes go away."
          />
          <Feature
            title="Share on your terms"
            body="Right-click Share to email someone on this node, or turn on Anyone with the link for a view-only page. They cannot see the rest of the app."
          />
          <Feature
            title="Live, no refresh"
            body="The file list updates live when the Mac uploads or anything else writes the drive. Trash keeps files 30 days. Over 20 GB skips trash and warns you first."
          />
          <Feature
            title="A shell on the node"
            body="Terminal in the sidebar opens a real shell. Settings has a master on/off, plus per-user max and idle expiry. Off hides the tab and kills live shells."
          />
        </section>

        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-8 md:grid-cols-2 md:px-8 md:py-16">
          <div>
            <h2 className="text-3xl font-medium tracking-tight text-white">Sign-in is the same screen.</h2>
            <p className="mt-3 text-[15px] leading-7 text-[#8d8d8d]">
              First visit is onboarding: admin, storage cap, optional extra users. Later visits are this. Passwords are
              scrypt hashes. Sessions are httpOnly cookies.
            </p>
          </div>
          <div className="overflow-hidden rounded-2xl border border-white/10">
            <div className="flex min-h-[420px] flex-col bg-[#1a1a1a] text-white">
              <header className="flex h-16 items-center gap-2.5 px-5">
                <StorebaseLogo className="size-8" />
                <span className="text-[20px] font-medium tracking-tight">Storebase</span>
              </header>
              <div className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-5 pb-16">
                <h3 className="text-3xl font-medium tracking-tight">Sign in</h3>
                <p className="mt-2 text-sm text-[#8d8d8d]">Sign in to home-node.</p>
                <div className="mt-8 space-y-3">
                  <Input readOnly className={fieldClass} value="noah@home-node" />
                  <Input readOnly className={fieldClass} type="password" value="password" />
                </div>
                <Button type="button" className="mt-8 h-11 rounded-full bg-white text-[#1a1a1a] hover:bg-[#f2f2f2]">
                  Continue
                </Button>
              </div>
            </div>
          </div>
        </section>

        <section id="install" className="mx-auto max-w-6xl px-4 py-16 md:px-8">
          <h2 className="text-3xl font-medium tracking-tight text-white">One command on a machine you own.</h2>
          <p className="mt-3 max-w-2xl text-[15px] leading-7 text-[#8d8d8d]">
            Needs curl, git, and either Node 20+ or network to download Node. Linux (systemd user service) and macOS
            (launchd) are supported. After it finishes, open the node URL and walk through onboarding.
          </p>
          <div className="mt-8 overflow-hidden rounded-2xl bg-[#242424]">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <p className="truncate font-mono text-sm text-[#e8e8e8]">{INSTALL}</p>
              <Button
                type="button"
                className="h-9 shrink-0 rounded-full bg-white px-4 text-[#1a1a1a] hover:bg-[#f2f2f2]"
                onClick={() => void copyInstall()}
              >
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>
          <p className="mt-4 text-sm text-[#8d8d8d]">
            Mac client: on a Mac run <code className="text-[#e8e8e8]">macos/make-dmg.sh</code>, then pair from Settings
            → Mac app.
          </p>
        </section>
      </main>

      <footer className="border-t border-white/10 px-4 py-8 md:px-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <StorebaseLogo className="size-6" />
            <span className="text-sm text-[#8d8d8d]">Storebase</span>
          </div>
          <a href={GITHUB} className="text-sm text-[#8d8d8d] hover:text-white">
            GitHub
          </a>
        </div>
      </footer>
    </div>
  )
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h2 className="text-lg font-medium text-white">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-[#8d8d8d]">{body}</p>
    </div>
  )
}

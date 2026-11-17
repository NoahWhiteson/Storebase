import { StorebaseLogo } from '@/components/StorebaseLogo'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from 'cn'
import type { SettingsSection } from '@/components/Settings'
import { askAi } from '@/lib/api'
import { Grid2x2, List, Menu, Search, Settings, SquareTerminal } from 'lucide-react'
import { useState } from 'react'

type TopBarProps = {
  search: string
  view: 'grid' | 'list'
  account: { name: string; email: string }
  initials: string
  avatarUrl?: string | null
  settingsOpen: boolean
  terminalsOpen: boolean
  terminalsEnabled?: boolean
  aiEnabled?: boolean
  onSearch: (value: string) => void
  onView: (view: 'grid' | 'list') => void
  onOpenSidebar: () => void
  onOpenSettings: (section?: SettingsSection) => void
  onOpenTerminals: () => void
  onSignOut: () => void
}

export function TopBar({
  search,
  view,
  account,
  initials,
  avatarUrl,
  settingsOpen,
  terminalsOpen,
  terminalsEnabled = true,
  aiEnabled = false,
  onSearch,
  onView,
  onOpenSidebar,
  onOpenSettings,
  onOpenTerminals,
  onSignOut,
}: TopBarProps) {
  const [aiOpen, setAiOpen] = useState(false)
  const [aiText, setAiText] = useState('')
  const [aiAnswer, setAiAnswer] = useState('')
  const [aiBusy, setAiBusy] = useState(false)

  async function ask() {
    const message = aiText.trim()
    if (!message || aiBusy) return
    setAiBusy(true)
    setAiAnswer('')
    try {
      setAiAnswer(await askAi(message))
    } catch (error) {
      setAiAnswer(error instanceof Error ? error.message : 'AI failed')
    } finally {
      setAiBusy(false)
    }
  }

  return (
    <header className="flex h-16 shrink-0 items-center bg-[#1a1a1a]">
      <div className="flex h-full w-auto shrink-0 items-center gap-2 px-3 md:w-[256px] md:gap-2.5 md:px-4">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={onOpenSidebar}
          aria-label="Open menu"
        >
          <Menu />
        </Button>
        <StorebaseLogo className="size-8" />
        <span className="text-[20px] font-medium tracking-tight text-white">Storebase</span>
      </div>

      <div className="flex h-full min-w-0 flex-1 items-center gap-2 px-3 md:gap-3 md:pr-4 md:pl-2">
        {settingsOpen ? (
          <div className="min-w-0 flex-1 text-[15px] font-medium text-white">Settings</div>
        ) : terminalsOpen ? (
          <div className="min-w-0 flex-1 text-[15px] font-medium text-white">Terminal</div>
        ) : (
          <div className="relative flex h-12 min-w-0 flex-1 items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-[#9a9a9a]" />
              <Input
                value={search}
                onChange={(e) => onSearch(e.target.value)}
                placeholder="Search in Storebase"
                className="h-12 rounded-full border-0 bg-[#242424] pl-12 text-[15px] shadow-none placeholder:text-[#8d8d8d] outline-none focus-visible:bg-[#2a2a2a] focus-visible:ring-0"
              />
            </div>
            {aiEnabled ? (
              <button
                type="button"
                className={cn('h-12 shrink-0 rounded-full px-4 text-[15px] font-medium', aiOpen ? 'bg-white text-[#1a1a1a]' : 'bg-[#242424] text-white')}
                onClick={() => setAiOpen((open) => !open)}
              >
                AI
              </button>
            ) : null}
            {aiEnabled && aiOpen ? (
              <form
                className="absolute top-14 right-0 z-30 w-[min(420px,calc(100vw-2rem))] rounded-2xl bg-[#242424] p-3 shadow-xl"
                onSubmit={(event) => {
                  event.preventDefault()
                  void ask()
                }}
              >
                <Input
                  value={aiText}
                  onChange={(event) => setAiText(event.target.value)}
                  placeholder="Ask about your files"
                  className="h-11 rounded-full border-0 bg-[#1a1a1a] px-4 text-[15px] shadow-none placeholder:text-[#8d8d8d] outline-none focus-visible:ring-0"
                />
                <p className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap text-sm leading-6 text-[#e8e8e8]">
                  {aiBusy ? 'Looking through your files…' : aiAnswer || 'Ask something about the files in this drive.'}
                </p>
              </form>
            ) : null}
          </div>
        )}

        <div className="flex shrink-0 items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-10"
                aria-label={view === 'grid' ? 'List View' : 'Grid View'}
                onClick={() => onView(view === 'grid' ? 'list' : 'grid')}
              >
                {view === 'grid' ? <List /> : <Grid2x2 />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{view === 'grid' ? 'List View' : 'Grid View'}</TooltipContent>
          </Tooltip>
          {terminalsEnabled ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn('size-10', terminalsOpen ? 'bg-white/10' : '')}
                  aria-label="Terminal"
                  onClick={onOpenTerminals}
                >
                  <SquareTerminal />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Terminal</TooltipContent>
            </Tooltip>
          ) : null}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-10" aria-label="Settings" onClick={() => onOpenSettings()}>
                <Settings />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Settings</TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="ml-1 rounded-full outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-white/30">
                <Avatar>
                  {avatarUrl ? <AvatarImage src={avatarUrl} alt="" className="object-cover" /> : null}
                  <AvatarFallback className="bg-[#2a2a2a] text-sm font-medium text-white">
                    {initials}
                  </AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                {account.name}
                <div className="font-normal text-muted-foreground">{account.email}</div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onOpenSettings('account')}>Account</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onOpenSettings('storage')}>Storage</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onSignOut}>Sign Out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  )
}

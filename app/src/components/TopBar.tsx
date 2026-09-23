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
import { Grid2x2, List, Menu, Search, Settings, SquareTerminal } from 'lucide-react'

type TopBarProps = {
  search: string
  view: 'grid' | 'list'
  account: { name: string; email: string }
  initials: string
  avatarUrl?: string | null
  settingsOpen: boolean
  terminalsOpen: boolean
  terminalsEnabled?: boolean
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
  onSearch,
  onView,
  onOpenSidebar,
  onOpenSettings,
  onOpenTerminals,
  onSignOut,
}: TopBarProps) {
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
          <div className="relative flex h-12 min-w-0 flex-1 items-center">
            <Search className="pointer-events-none absolute left-4 size-[18px] text-[#9a9a9a]" />
            <Input
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Search in Storebase"
              className="h-12 rounded-full border-0 bg-[#242424] pl-12 text-[15px] shadow-none placeholder:text-[#8d8d8d] outline-none focus-visible:bg-[#2a2a2a] focus-visible:ring-0"
            />
          </div>
        )}

        <div className="flex shrink-0 items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-10"
                aria-label={view === 'grid' ? 'List view' : 'Grid view'}
                onClick={() => onView(view === 'grid' ? 'list' : 'grid')}
              >
                {view === 'grid' ? <List /> : <Grid2x2 />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{view === 'grid' ? 'List view' : 'Grid view'}</TooltipContent>
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
              <DropdownMenuItem onSelect={onSignOut}>Sign out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  )
}

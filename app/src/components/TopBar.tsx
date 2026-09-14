import { AskAI } from '@/components/AskAI'
import { StorebaseLogo } from '@/components/StorebaseLogo'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
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
import type { DriveItem } from '@/types'
import { Grid2x2, List, Menu, Search, Settings, Sparkles } from 'lucide-react'
import { useState } from 'react'

type TopBarProps = {
  search: string
  view: 'grid' | 'list'
  files: DriveItem[]
  onSearch: (value: string) => void
  onView: (view: 'grid' | 'list') => void
  onOpenSidebar: () => void
}

export function TopBar({
  search,
  view,
  files,
  onSearch,
  onView,
  onOpenSidebar,
}: TopBarProps) {
  const [askOpen, setAskOpen] = useState(false)

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
        <div className="relative flex h-12 min-w-0 flex-1 items-center">
          <Search className="pointer-events-none absolute left-4 size-[18px] text-[#9a9a9a]" />
          <Input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search in Storebase"
            className="h-12 rounded-full border-0 bg-[#242424] pl-12 text-[15px] shadow-none placeholder:text-[#8d8d8d] focus-visible:bg-[#2a2a2a] focus-visible:ring-1 focus-visible:ring-white/15"
          />
        </div>

        <Button
          type="button"
          variant="secondary"
          aria-label="Ask AI"
          onClick={() => setAskOpen(true)}
          className="h-10 shrink-0 rounded-full bg-[#242424] px-3 text-sm font-medium text-white hover:bg-[#2e2e2e] md:px-4"
        >
          <Sparkles className="size-4" />
          <span className="hidden sm:inline">Ask AI</span>
        </Button>

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
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-10" aria-label="Settings">
                <Settings />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Settings</TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="ml-1 rounded-full outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-white/30">
                <Avatar>
                  <AvatarFallback className="bg-[#2a2a2a] text-sm font-medium text-white">
                    NW
                  </AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                Noah Whiteson
                <div className="font-normal text-muted-foreground">noah@storebase.local</div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem>Account</DropdownMenuItem>
              <DropdownMenuItem>Storage</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem>Sign out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <AskAI open={askOpen} files={files} onOpenChange={setAskOpen} />
    </header>
  )
}

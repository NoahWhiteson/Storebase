import { DriveLogo } from '@/components/DriveLogo'
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
import { Grid2x2, Info, List, Menu, Search, Settings } from 'lucide-react'

type TopBarProps = {
  search: string
  view: 'grid' | 'list'
  detailsOpen: boolean
  onSearch: (value: string) => void
  onView: (view: 'grid' | 'list') => void
  onToggleDetails: () => void
  onOpenSidebar: () => void
}

export function TopBar({
  search,
  view,
  detailsOpen,
  onSearch,
  onView,
  onToggleDetails,
  onOpenSidebar,
}: TopBarProps) {
  return (
    <header className="flex h-16 shrink-0 items-center gap-3 px-3 md:px-4">
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        onClick={onOpenSidebar}
        aria-label="Open menu"
      >
        <Menu />
      </Button>

      <div className="hidden items-center gap-2.5 md:flex">
        <DriveLogo className="size-8" />
        <span className="text-[22px] font-medium tracking-tight text-[#e3e3e3]">Drive</span>
      </div>

      <div className="relative mx-auto flex h-12 min-w-0 flex-1 items-center md:mx-8 md:max-w-[720px]">
        <Search className="pointer-events-none absolute left-4 size-5 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search in Drive"
          className="h-12 rounded-full border-0 bg-[#2c2c2c] pl-12 text-[15px] shadow-none placeholder:text-[#9aa0a6] focus-visible:ring-1 focus-visible:ring-[#8ab4f8]/40"
        />
      </div>

      <div className="flex items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
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
            <Button
              variant="ghost"
              size="icon"
              aria-label="View details"
              onClick={onToggleDetails}
              className={detailsOpen ? 'bg-[#2c2c2c]' : undefined}
            >
              <Info />
            </Button>
          </TooltipTrigger>
          <TooltipContent>View details</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Settings">
              <Settings />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Settings</TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="ml-1 rounded-full outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring">
              <Avatar>
                <AvatarFallback className="bg-[#394457] text-sm font-medium text-[#d3e3fd]">
                  NW
                </AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              Noah Whiteson
              <div className="font-normal text-muted-foreground">noah@arkdrive.local</div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Account</DropdownMenuItem>
            <DropdownMenuItem>Storage</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Sign out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}

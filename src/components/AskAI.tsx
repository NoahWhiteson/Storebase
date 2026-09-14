import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { answerQuery } from '@/lib/ask'
import type { DriveItem } from '@/types'
import { Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

type ChatMessage = {
  id: string
  role: 'user' | 'ai'
  text: string
}

const chips = ['What’s using space?', 'Starred files', 'Recent activity', 'Shared with me']

export function AskAI({
  open,
  files,
  onOpenChange,
}: {
  open: boolean
  files: DriveItem[]
  onOpenChange: (open: boolean) => void
}) {
  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'intro',
      role: 'ai',
      text: 'Ask about anything in Storebase. Storage hogs, starred files, a name — I’ll look it up.',
    },
  ])
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, open])

  function send(text: string) {
    const q = text.trim()
    if (!q) return
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: 'user', text: q },
      { id: crypto.randomUUID(), role: 'ai', text: answerQuery(q, files) },
    ])
    setDraft('')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(640px,85vh)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            Ask AI
          </DialogTitle>
          <DialogDescription>Answers from the files currently in this Storebase.</DialogDescription>
        </DialogHeader>
        <ScrollArea className="h-[320px]">
          <div className="flex flex-col gap-3 px-6 py-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={
                  message.role === 'user'
                    ? 'ml-8 rounded-2xl rounded-br-md bg-[#394457] px-3.5 py-2.5 text-sm'
                    : 'mr-8 whitespace-pre-wrap rounded-2xl rounded-bl-md bg-[#2c2c2c] px-3.5 py-2.5 text-sm'
                }
              >
                {message.text}
              </div>
            ))}
            <div ref={endRef} />
          </div>
        </ScrollArea>
        <div className="border-t border-border px-4 py-3">
          <div className="mb-3 flex flex-wrap gap-1.5">
            {chips.map((chip) => (
              <button
                key={chip}
                type="button"
                className="rounded-full bg-[#2c2c2c] px-3 py-1 text-xs text-[#c4c7c5] hover:bg-[#333] hover:text-foreground"
                onClick={() => send(chip)}
              >
                {chip}
              </button>
            ))}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              send(draft)
            }}
          >
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ask about your files"
              className="h-10"
            />
            <Button type="submit" className="h-10" disabled={!draft.trim()}>
              Ask
            </Button>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  )
}

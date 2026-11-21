"use client";

import { useState } from "react";
import { MessageSquareDashed, SquarePen, Trash2 } from "lucide-react";
import { Loader } from "@/components/prompt-kit/loader";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { groupConversations } from "./storage";
import type { Conversation } from "./types";

export function BrandMark({ className = "" }: { className?: string }) {
  return <span className={`jeffy-brand-mark ${className}`} aria-hidden />;
}

export function ChatSidebar({
  conversations,
  activeId,
  runningId,
  onSelect,
  onNew,
  onDelete,
}: {
  conversations: Conversation[];
  activeId: string | null;
  runningId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}) {
  const { isMobile, setOpenMobile } = useSidebar();
  // "Now" for grouping is captured per mount; groups only need day precision.
  const [now] = useState(() => Date.now());
  const groups = groupConversations(conversations, now);
  const close = () => isMobile && setOpenMobile(false);

  return (
    <Sidebar className="border-sidebar-border">
      <SidebarHeader className="flex flex-row items-center justify-between gap-2 px-3 pt-4 pb-2">
        <div className="flex items-center gap-2.5 px-1">
          <BrandMark />
          <span className="text-[15px] font-semibold tracking-tight">Jeffy</span>
        </div>
      </SidebarHeader>
      <SidebarContent className="pt-1">
        <div className="px-3 pb-2">
          <Button
            variant="outline"
            onClick={() => {
              onNew();
              close();
            }}
            className="bg-sidebar-accent/40 hover:bg-sidebar-accent h-9 w-full justify-start gap-2 rounded-lg px-3 font-medium"
          >
            <SquarePen className="size-4" />
            New chat
          </Button>
        </div>
        {groups.length === 0 && (
          <div className="text-muted-foreground flex flex-col items-center gap-2 px-6 pt-10 text-center text-sm">
            <MessageSquareDashed className="size-5 opacity-60" aria-hidden />
            Your chats will show up here.
          </div>
        )}
        {groups.map((g) => (
          <SidebarGroup key={g.label} className="py-1">
            <SidebarGroupLabel className="text-muted-foreground/80 text-[11px] font-medium tracking-wide uppercase">
              {g.label}
            </SidebarGroupLabel>
            <SidebarMenu>
              {g.items.map((c) => (
                <SidebarMenuItem key={c.id}>
                  <SidebarMenuButton
                    isActive={c.id === activeId}
                    onClick={() => {
                      onSelect(c.id);
                      close();
                    }}
                    className="h-9 pr-8 text-[13.5px]"
                    title={c.title}
                  >
                    {c.id === runningId && <Loader variant="pulse-dot" size="sm" className="shrink-0" />}
                    <span className="truncate">{c.title}</span>
                  </SidebarMenuButton>
                  <SidebarMenuAction
                    showOnHover
                    aria-label={`Delete “${c.title}”`}
                    title="Delete chat"
                    onClick={() => onDelete(c.id)}
                    className="hover:text-destructive top-2"
                  >
                    <Trash2 />
                  </SidebarMenuAction>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter className="px-4 pb-4">
        <p className="text-muted-foreground/70 text-[11px] leading-snug">
          Chats are saved in this browser only.
        </p>
      </SidebarFooter>
    </Sidebar>
  );
}

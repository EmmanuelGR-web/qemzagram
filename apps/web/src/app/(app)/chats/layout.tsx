'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { ChatsProvider } from '@/lib/chats-context';
import { ChatList } from './ChatList';

export default function ChatsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const conversationOpen = pathname !== '/chats';

  return (
    <ChatsProvider>
      <div className="chats-shell" data-conversation-open={conversationOpen}>
        <ChatList />
        <section className="chat-pane">{children}</section>
      </div>
    </ChatsProvider>
  );
}

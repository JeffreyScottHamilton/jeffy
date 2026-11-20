import { Chat } from "@/components/jeffy/chat";

export default function Home() {
  return (
    <main className="mx-auto flex h-dvh w-full max-w-[640px] flex-col">
      <header className="shrink-0 px-5 pt-4 pb-3">
        <h1 className="text-xl font-medium tracking-tight">Jeffy</h1>
      </header>
      <Chat />
    </main>
  );
}

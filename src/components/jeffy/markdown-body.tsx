"use client";

import { createContext, memo, useContext, useEffect, useRef, useState } from "react";
import type { Components } from "react-markdown";
import { bundledLanguages } from "shiki";
import { Check, Code2, Copy, Eye } from "lucide-react";
import { CodeBlock, CodeBlockCode, CodeBlockGroup } from "@/components/prompt-kit/code-block";
import { JSXPreview } from "@/components/prompt-kit/jsx-preview";
import { MessageContent } from "@/components/prompt-kit/message";
import { cn } from "@/lib/utils";

const THEME = "github-dark-default";
const PREVIEW_LANGS = new Set(["jsx", "tsx-preview"]);

/** True while the reply that owns this markdown is still streaming in. */
const StreamingContext = createContext(false);

function languageOf(className?: string): string {
  const m = className?.match(/language-([\w+#-]+)/);
  return m ? m[1].toLowerCase() : "";
}

function highlightLang(lang: string): string {
  if (lang === "tsx-preview") return "tsx";
  return lang && lang in bundledLanguages ? lang : "plaintext";
}

function useCopy() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };
  return { copied, copy };
}

function CopyButton({ text, label = "Copy code" }: { text: string; label?: string }) {
  const { copied, copy } = useCopy();
  return (
    <button
      type="button"
      onClick={() => void copy(text)}
      aria-label={copied ? "Copied" : label}
      className="text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:ring-ring/60 inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none"
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      <span>{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

function FencedCode({ code, lang }: { code: string; lang: string }) {
  return (
    <CodeBlock className="jeffy-code my-4 bg-[#0d1117]/80">
      <CodeBlockGroup className="border-border/70 border-b py-1 pr-1.5 pl-4">
        <span className="text-muted-foreground font-mono text-xs">{lang || "text"}</span>
        <CopyButton text={code} />
      </CodeBlockGroup>
      <CodeBlockCode code={code} language={highlightLang(lang)} theme={THEME} />
    </CodeBlock>
  );
}

function JsxBlock({ code, lang }: { code: string; lang: string }) {
  const streaming = useContext(StreamingContext);
  const [picked, setPicked] = useState<"code" | "preview" | null>(null);
  const tab = picked ?? (streaming ? "code" : "preview");
  const tabBtn = (id: "code" | "preview", label: string, Icon: typeof Eye) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      onClick={() => setPicked(id)}
      className={cn(
        "focus-visible:ring-ring/60 inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none",
        tab === id ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  );
  return (
    <CodeBlock className="jeffy-code my-4 bg-[#0d1117]/80">
      <CodeBlockGroup className="border-border/70 border-b py-1 pr-1.5 pl-1.5">
        <div role="tablist" aria-label="JSX view" className="flex items-center gap-1">
          {tabBtn("preview", "Preview", Eye)}
          {tabBtn("code", "Code", Code2)}
        </div>
        <CopyButton text={code} />
      </CodeBlockGroup>
      {tab === "code" ? (
        <CodeBlockCode code={code} language={highlightLang(lang)} theme={THEME} />
      ) : (
        <div className="jeffy-preview text-foreground overflow-x-auto p-5 text-sm" role="tabpanel">
          {/* Default blacklists stay in place: no on* attributes, no <script>, no bound components or functions. */}
          <JSXPreview
            jsx={code}
            isStreaming={streaming}
            renderError={() => (
              <p className="text-muted-foreground text-sm">This snippet can&apos;t be previewed.</p>
            )}
          />
        </div>
      )}
    </CodeBlock>
  );
}

const COMPONENTS: Partial<Components> = {
  code: function CodeComponent({ className, children, node }) {
    const isInline =
      !node?.position?.start.line || node.position.start.line === node.position.end.line;
    if (isInline && !languageOf(className)) {
      return <code className={className}>{children}</code>;
    }
    const code = String(children ?? "").replace(/\n$/, "");
    const lang = languageOf(className);
    return PREVIEW_LANGS.has(lang) ? <JsxBlock code={code} lang={lang} /> : <FencedCode code={code} lang={lang} />;
  },
  pre: function PreComponent({ children }) {
    return <>{children}</>;
  },
  table: function TableComponent({ children }) {
    return (
      <div className="jeffy-table not-prose my-4 overflow-x-auto rounded-xl border">
        <table>{children}</table>
      </div>
    );
  },
  a: function LinkComponent({ href, children }) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
};

export const MarkdownBody = memo(function MarkdownBody({
  id,
  text,
  streaming,
}: {
  id: string;
  text: string;
  streaming: boolean;
}) {
  return (
    <StreamingContext.Provider value={streaming}>
      <MessageContent
        markdown
        id={id}
        components={COMPONENTS}
        className="jeffy-prose prose prose-invert w-full max-w-none rounded-none bg-transparent p-0 text-[15.5px] leading-7"
      >
        {text}
      </MessageContent>
    </StreamingContext.Provider>
  );
});

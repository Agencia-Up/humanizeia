import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  return (
    <div className={cn('markdown-body overflow-hidden [overflow-wrap:anywhere]', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ children, ...props }) => (
            <div className="my-4 w-full overflow-x-auto rounded-lg border border-border/50">
              <table className="w-full text-sm" {...props}>
                {children}
              </table>
            </div>
          ),
          thead: ({ children, ...props }) => (
            <thead className="bg-muted/60 text-left text-xs uppercase tracking-wider text-muted-foreground" {...props}>
              {children}
            </thead>
          ),
          tbody: ({ children, ...props }) => (
            <tbody className="divide-y divide-border/30" {...props}>
              {children}
            </tbody>
          ),
          tr: ({ children, ...props }) => (
            <tr className="transition-colors hover:bg-muted/30" {...props}>
              {children}
            </tr>
          ),
          th: ({ children, ...props }) => (
            <th className="px-3 py-2.5 font-semibold text-foreground whitespace-nowrap" {...props}>
              {children}
            </th>
          ),
          td: ({ children, ...props }) => (
            <td className="px-3 py-2 text-foreground/90 whitespace-nowrap" {...props}>
              {children}
            </td>
          ),
          h1: ({ children, ...props }) => (
            <h1 className="mt-6 mb-3 text-xl font-bold text-foreground border-b border-border/30 pb-2" {...props}>
              {children}
            </h1>
          ),
          h2: ({ children, ...props }) => (
            <h2 className="mt-5 mb-2 text-lg font-semibold text-foreground" {...props}>
              {children}
            </h2>
          ),
          h3: ({ children, ...props }) => (
            <h3 className="mt-4 mb-2 text-base font-semibold text-foreground" {...props}>
              {children}
            </h3>
          ),
          h4: ({ children, ...props }) => (
            <h4 className="mt-3 mb-1.5 text-sm font-semibold text-foreground" {...props}>
              {children}
            </h4>
          ),
          p: ({ children, ...props }) => (
            <p className="mb-2 text-sm leading-relaxed text-foreground/85" {...props}>
              {children}
            </p>
          ),
          ul: ({ children, ...props }) => (
            <ul className="mb-3 ml-4 list-disc space-y-1 text-sm text-foreground/85" {...props}>
              {children}
            </ul>
          ),
          ol: ({ children, ...props }) => (
            <ol className="mb-3 ml-4 list-decimal space-y-1 text-sm text-foreground/85" {...props}>
              {children}
            </ol>
          ),
          li: ({ children, ...props }) => (
            <li className="leading-relaxed" {...props}>
              {children}
            </li>
          ),
          strong: ({ children, ...props }) => (
            <strong className="font-semibold text-foreground" {...props}>
              {children}
            </strong>
          ),
          blockquote: ({ children, ...props }) => (
            <blockquote className="my-3 border-l-2 border-primary/50 pl-4 italic text-muted-foreground" {...props}>
              {children}
            </blockquote>
          ),
          code: ({ children, className: codeClassName, ...props }) => {
            const isInline = !codeClassName;
            if (isInline) {
              return (
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono text-primary" {...props}>
                  {children}
                </code>
              );
            }
            return (
              <code className={cn('block rounded-lg bg-muted/50 p-3 text-xs font-mono overflow-x-auto', codeClassName)} {...props}>
                {children}
              </code>
            );
          },
          hr: (props) => <hr className="my-4 border-border/30" {...props} />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

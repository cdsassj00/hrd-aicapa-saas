import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { normalizeMarkdown } from '@/lib/markdownNormalize';
import { cn } from '@/lib/utils';


interface Props {
  content: string | null | undefined;
  /** 'question' = 본문(약간 큼) | 'scenario' = 세트 시나리오(약간 작음) */
  variant?: 'question' | 'scenario';
  className?: string;
}

const baseClass =
  'text-foreground ' +
  // headings
  '[&_h1]:font-bold [&_h1]:tracking-tight [&_h1]:mt-5 [&_h1]:mb-2.5 [&_h1]:pb-1 [&_h1]:border-b [&_h1]:border-border ' +
  '[&_h2]:font-bold [&_h2]:tracking-tight [&_h2]:mt-4 [&_h2]:mb-2 ' +
  '[&_h3]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1.5 ' +
  '[&_h4]:font-semibold [&_h4]:mt-2.5 [&_h4]:mb-1 ' +
  // text
  '[&_p]:my-2 [&_strong]:font-bold [&_strong]:text-foreground [&_em]:italic ' +
  // lists
  '[&_ul]:my-2 [&_ul]:pl-6 [&_ul]:list-disc [&_ul_ul]:list-[circle] ' +
  '[&_ol]:my-2 [&_ol]:pl-6 [&_ol]:list-decimal ' +
  '[&_li]:my-1 [&_li>p]:my-0 ' +
  // code
  '[&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono ' +
  '[&_pre]:bg-muted [&_pre]:rounded-md [&_pre]:p-3 [&_pre]:my-3 [&_pre]:overflow-x-auto ' +
  '[&_pre>code]:bg-transparent [&_pre>code]:p-0 ' +
  // table (스크롤 래퍼는 components.table 에서)
  '[&_table]:border-collapse [&_table]:w-full [&_table]:table-auto ' +
  '[&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:font-semibold [&_th]:text-left ' +
  '[&_th]:whitespace-normal [&_th]:break-keep [&_th]:leading-relaxed ' +
  '[&_td]:border [&_td]:border-border [&_td]:px-2.5 [&_td]:py-1.5 [&_td]:align-top ' +
  '[&_td]:whitespace-normal [&_td]:break-keep [&_td]:leading-relaxed ' +
  // misc
  '[&_blockquote]:border-l-4 [&_blockquote]:border-primary/40 [&_blockquote]:pl-3 [&_blockquote]:py-1 [&_blockquote]:my-2 [&_blockquote]:text-muted-foreground [&_blockquote]:bg-muted/30 ' +
  '[&_hr]:my-4 [&_hr]:border-t [&_hr]:border-border ' +
  '[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:opacity-80 ' +
  '[&_img]:rounded [&_img]:my-2 [&_img]:max-w-full';

const variantClass = {
  question:
    'text-[14.5px] leading-[1.85] ' +
    '[&_h1]:text-[20px] [&_h2]:text-[17px] [&_h3]:text-[15.5px] ' +
    '[&_code]:text-[13px] [&_pre]:text-[13px] ' +
    '[&_table]:text-[13.5px] [&_table]:my-3',
  scenario:
    'text-[14px] leading-[1.8] ' +
    '[&_h1]:text-[18px] [&_h2]:text-[16px] [&_h3]:text-[14.5px] ' +
    '[&_code]:text-[12.5px] [&_pre]:text-[12.5px] ' +
    '[&_table]:text-[12.5px] [&_table]:my-2',
};

const components: Components = {
  // 표는 가로 스크롤 가능한 래퍼로 감싸 좁은 화면에서도 깨지지 않도록
  table: ({ node, ...props }) => (
    <div className="my-3 w-full overflow-x-auto rounded border border-border">
      <table {...props} />
    </div>
  ),
  // 외부 링크는 새 탭
  a: ({ node, href, ...props }) => (
    <a
      href={href}
      target={href?.startsWith('http') ? '_blank' : undefined}
      rel={href?.startsWith('http') ? 'noopener noreferrer' : undefined}
      {...props}
    />
  ),
};

/**
 * 공용 마크다운 렌더러. 입력 본문을 정규화한 뒤 일관된 스타일로 출력한다.
 */
export default function MarkdownView({ content, variant = 'question', className }: Props) {
  const normalized = normalizeMarkdown(content);
  if (!normalized) return null;
  return (
    <div className={cn(baseClass, variantClass[variant], className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={components}>
        {normalized}
      </ReactMarkdown>

    </div>
  );
}

import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'

interface MarkdownRendererProps {
  content: string
}

const REMARK_PLUGINS = [remarkGfm]
const REHYPE_PLUGINS = [rehypeHighlight]

export default function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <Markdown
      remarkPlugins={REMARK_PLUGINS}
      rehypePlugins={REHYPE_PLUGINS}
    >
      {content}
    </Markdown>
  )
}

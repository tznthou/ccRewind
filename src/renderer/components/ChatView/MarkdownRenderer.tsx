import { memo, useMemo } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import rehypeSanitize from 'rehype-sanitize'
import rehypeSearchHighlight from '../../utils/rehypeSearchHighlight'
import 'highlight.js/styles/atom-one-dark.css'

interface MarkdownRendererProps {
  content: string
  searchQuery?: string
}

const REMARK_PLUGINS = [remarkGfm]
const REHYPE_PLUGINS_BASE = [rehypeSanitize, rehypeHighlight]

export default memo(function MarkdownRenderer({ content, searchQuery }: MarkdownRendererProps) {
  const rehypePlugins = useMemo(
    () =>
      searchQuery
        ? [rehypeSanitize, [rehypeSearchHighlight, { query: searchQuery }], rehypeHighlight]
        : REHYPE_PLUGINS_BASE,
    [searchQuery],
  )
  return (
    <Markdown
      remarkPlugins={REMARK_PLUGINS}
      rehypePlugins={rehypePlugins}
    >
      {content}
    </Markdown>
  )
})

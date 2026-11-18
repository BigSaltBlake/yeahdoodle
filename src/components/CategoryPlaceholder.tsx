'use client'

export const CATEGORY_GRADIENTS: Record<string, string> = {
  'Music':            'from-purple-900 via-purple-800 to-indigo-900',
  'Comedy':           'from-yellow-900 via-amber-800 to-orange-900',
  'Food & Drink':     'from-amber-900 via-orange-800 to-red-900',
  'Arts & Culture':   'from-pink-900 via-rose-800 to-fuchsia-900',
  'Sports & Outdoors':'from-blue-900 via-sky-800 to-cyan-900',
  'Sports':           'from-blue-900 via-sky-800 to-cyan-900',
  'Outdoors':         'from-green-900 via-emerald-800 to-teal-900',
  'Nightlife':        'from-indigo-950 via-violet-900 to-purple-950',
  'Community':        'from-teal-900 via-cyan-800 to-emerald-900',
}

const CATEGORY_ICONS: Record<string, string> = {
  'Music': `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" width="64" height="64" style="opacity:0.3"><path d="M22 48V20l28-6v28" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="16" cy="48" r="6" stroke="white" stroke-width="3"/><circle cx="44" cy="42" r="6" stroke="white" stroke-width="3"/></svg>`,
  'Comedy': `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" width="64" height="64" style="opacity:0.3"><circle cx="32" cy="32" r="22" stroke="white" stroke-width="3"/><circle cx="23" cy="26" r="3" fill="white" opacity="0.6"/><circle cx="41" cy="26" r="3" fill="white" opacity="0.6"/><path d="M20 40c2 5 6 8 12 8s10-3 12-8" stroke="white" stroke-width="3" stroke-linecap="round"/></svg>`,
  'Food & Drink': `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" width="64" height="64" style="opacity:0.3"><path d="M20 8v16c0 4.4 3.6 8 8 8s8-3.6 8-8V8" stroke="white" stroke-width="3" stroke-linecap="round"/><path d="M28 32v24M20 56h16" stroke="white" stroke-width="3" stroke-linecap="round"/><path d="M44 8c0 0 4 4 4 12s-4 12-4 12v24" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  'Arts & Culture': `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" width="64" height="64" style="opacity:0.3"><circle cx="32" cy="32" r="20" stroke="white" stroke-width="3"/><circle cx="22" cy="26" r="4" stroke="white" stroke-width="2.5"/><circle cx="42" cy="26" r="4" stroke="white" stroke-width="2.5"/><circle cx="32" cy="42" r="4" stroke="white" stroke-width="2.5"/></svg>`,
  'Sports & Outdoors': `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" width="64" height="64" style="opacity:0.3"><path d="M32 8l6 12h14l-11 8 4 13-13-9-13 9 4-13L12 20h14z" stroke="white" stroke-width="3" stroke-linejoin="round"/></svg>`,
  'Sports': `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" width="64" height="64" style="opacity:0.3"><path d="M32 8l6 12h14l-11 8 4 13-13-9-13 9 4-13L12 20h14z" stroke="white" stroke-width="3" stroke-linejoin="round"/></svg>`,
  'Nightlife': `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" width="64" height="64" style="opacity:0.3"><path d="M38 10a20 20 0 1 1-24 24 14 14 0 0 0 24-24z" stroke="white" stroke-width="3" stroke-linejoin="round"/><path d="M42 18l2 2M48 28l3 1M44 38l2 2" stroke="white" stroke-width="2.5" stroke-linecap="round"/></svg>`,
  'Outdoors': `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" width="64" height="64" style="opacity:0.3"><path d="M8 52l24-36 24 36H8z" stroke="white" stroke-width="3" stroke-linejoin="round"/><path d="M20 52l12-18 12 18" stroke="white" stroke-width="2.5" stroke-linejoin="round"/></svg>`,
  'Community': `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" width="64" height="64" style="opacity:0.3"><circle cx="32" cy="20" r="8" stroke="white" stroke-width="3"/><path d="M14 52c0-9.9 8.1-18 18-18s18 8.1 18 18" stroke="white" stroke-width="3" stroke-linecap="round"/><circle cx="12" cy="28" r="5" stroke="white" stroke-width="2.5"/><path d="M4 48c0-6.1 3.6-11 8-11" stroke="white" stroke-width="2.5" stroke-linecap="round"/><circle cx="52" cy="28" r="5" stroke="white" stroke-width="2.5"/><path d="M60 48c0-6.1-3.6-11-8-11" stroke="white" stroke-width="2.5" stroke-linecap="round"/></svg>`,
}

interface Props {
  category: string
  /** Pass true when the placeholder sits inside a Tailwind `group` element and should scale on hover */
  groupHover?: boolean
}

export default function CategoryPlaceholder({ category, groupHover = false }: Props) {
  const gradient = CATEGORY_GRADIENTS[category] ?? CATEGORY_GRADIENTS['Other']
  const icon = CATEGORY_ICONS[category] ?? CATEGORY_ICONS['Other']
  return (
    <div
      className={`w-full h-full bg-gradient-to-br ${gradient} flex items-center justify-center ${
        groupHover ? 'group-hover:scale-105 transition-transform duration-300' : ''
      }`}
    >
      <div
        className="absolute inset-0 opacity-10"
        style={{
          backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)',
          backgroundSize: '20px 20px',
        }}
      />
      <div dangerouslySetInnerHTML={{ __html: icon }} />
    </div>
  )
}

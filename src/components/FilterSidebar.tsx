'use client'

import type { EventCategory, GroupType, AgeGroup, WhenFilter } from '@/types'

interface Props {
  categories:   EventCategory[]
  groups:       GroupType[]
  ageGroups:    AgeGroup[]
  when:         WhenFilter
  onCategories: (v: EventCategory[]) => void
  onGroups:     (v: GroupType[]) => void
  onAgeGroups:  (v: AgeGroup[]) => void
  onWhen:       (v: WhenFilter) => void
  onReset:      () => void
}

const ALL_CATEGORIES: { value: EventCategory; icon: string }[] = [
  { value: 'Music',          icon: '🎵' },
  { value: 'Food & Drink',   icon: '🍻' },
  { value: 'Arts & Culture', icon: '🎨' },
  { value: 'Sports',         icon: '⚽' },
  { value: 'Nightlife',      icon: '🌙' },
  { value: 'Outdoors',       icon: '🌲' },
]

const ALL_GROUPS: { value: GroupType; label: string; icon: string }[] = [
  { value: 'singles',       label: 'Singles',       icon: '👤' },
  { value: 'couples',       label: 'Couples',       icon: '💑' },
  { value: 'friend-groups', label: 'Friend Groups', icon: '👯' },
  { value: 'families',      label: 'Families',      icon: '👨‍👩‍👧' },
  { value: 'child-friendly',label: 'Child Friendly',icon: '🧒' },
]

const ALL_AGE_GROUPS: { value: AgeGroup; label: string }[] = [
  { value: 'toddlers',   label: 'Toddlers (0-3)' },
  { value: 'young-kids', label: 'Young Kids (4-8)' },
  { value: 'tweens',     label: 'Tweens (9-12)' },
  { value: 'teens',      label: 'Teens (13-17)' },
]

const WHEN_OPTIONS: { value: WhenFilter; label: string }[] = [
  { value: 'today',   label: 'Today' },
  { value: 'weekend', label: 'This Weekend' },
  { value: 'week',    label: 'This Week' },
]

function toggle<T>(arr: T[], val: T): T[] {
  return arr.includes(val) ? arr.filter(v => v !== val) : [...arr, val]
}

function CheckRow({ checked, label, icon, onChange }: {
  checked: boolean; label: string; icon?: string; onChange: () => void
}) {
  return (
    <label className="flex items-center gap-2.5 cursor-pointer group">
      <span className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] shrink-0 transition-all ${
        checked ? 'bg-yd-orange border-yd-orange text-white' : 'border-white/20 group-hover:border-white/40'
      }`}>
        {checked && '✓'}
      </span>
      {icon && <span className="text-sm">{icon}</span>}
      <span className={`text-sm transition-colors ${checked ? 'text-white' : 'text-white/60 group-hover:text-white/80'}`}>
        {label}
      </span>
    </label>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-3">
      {children}
    </p>
  )
}

const hasFilters = (cats: EventCategory[], groups: GroupType[], ages: AgeGroup[], when: WhenFilter) =>
  cats.length > 0 || groups.length > 0 || ages.length > 0 || when !== ''

export default function FilterSidebar({
  categories, groups, ageGroups, when,
  onCategories, onGroups, onAgeGroups, onWhen, onReset,
}: Props) {
  const active = hasFilters(categories, groups, ageGroups, when)

  return (
    <aside className="w-56 shrink-0 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-base text-white">Filters</h2>
        {active && (
          <button onClick={onReset} className="text-xs text-yd-orange hover:underline">
            Clear all
          </button>
        )}
      </div>

      <div>
        <SectionTitle>When</SectionTitle>
        <div className="space-y-2.5">
          {WHEN_OPTIONS.map(opt => (
            <CheckRow
              key={opt.value}
              checked={when === opt.value}
              label={opt.label}
              onChange={() => onWhen(when === opt.value ? '' : opt.value)}
            />
          ))}
        </div>
      </div>

      <div className="border-t border-white/5" />

      <div>
        <SectionTitle>Category</SectionTitle>
        <div className="space-y-2.5">
          {ALL_CATEGORIES.map(cat => (
            <CheckRow
              key={cat.value}
              checked={categories.includes(cat.value)}
              label={cat.value}
              icon={cat.icon}
              onChange={() => onCategories(toggle(categories, cat.value))}
            />
          ))}
        </div>
      </div>

      <div className="border-t border-white/5" />

      <div>
        <SectionTitle>Who&apos;s Going</SectionTitle>
        <div className="space-y-2.5">
          {ALL_GROUPS.map(g => (
            <CheckRow
              key={g.value}
              checked={groups.includes(g.value)}
              label={g.label}
              icon={g.icon}
              onChange={() => onGroups(toggle(groups, g.value))}
            />
          ))}
        </div>
      </div>

      <div className="border-t border-white/5" />

      <div>
        <SectionTitle>Age Groups</SectionTitle>
        <div className="space-y-2.5">
          {ALL_AGE_GROUPS.map(a => (
            <CheckRow
              key={a.value}
              checked={ageGroups.includes(a.value)}
              label={a.label}
              onChange={() => onAgeGroups(toggle(ageGroups, a.value))}
            />
          ))}
        </div>
      </div>
    </aside>
  )
}

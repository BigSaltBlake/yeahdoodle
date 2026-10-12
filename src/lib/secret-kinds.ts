// Kinds of local secret and the YeahDoodle category each one counts as.
// Shared by the share form (browser) and the server.

export const SECRET_KINDS = {
  beach:      { label: 'Beach',             category: 'Outdoors' },
  trail:      { label: 'Trail or hike',     category: 'Outdoors' },
  viewpoint:  { label: 'Viewpoint',         category: 'Outdoors' },
  swimming:   { label: 'Swimming hole',     category: 'Outdoors' },
  waterfall:  { label: 'Waterfall',         category: 'Outdoors' },
  hot_spring: { label: 'Hot spring',        category: 'Outdoors' },
  park:       { label: 'Park or garden',    category: 'Outdoors' },
  food:       { label: 'Food',              category: 'Food & Drink' },
  drink:      { label: 'Bar or drinks',     category: 'Nightlife' },
  activity:   { label: 'Something to do',   category: 'Activities' },
  culture:    { label: 'Art, history or culture', category: 'Arts & Culture' },
  other:      { label: 'Something else',    category: 'Activities' },
} as const

export type SecretKind = keyof typeof SECRET_KINDS

export function isSecretKind(k: unknown): k is SecretKind {
  return typeof k === 'string' && k in SECRET_KINDS
}

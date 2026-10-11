// ---------------------------------------------------------------------------
// No chains. YeahDoodle is the local friend who knows the hidden spot — an
// Applebee's is never a pick, even if that means showing fewer than three.
// ---------------------------------------------------------------------------
export const CHAIN_NAMES = [
  // Sit-down chains
  "applebee's", "chili's", 'olive garden', 'red robin', "denny's", 'ihop', 'buffalo wild wings',
  "tgi friday's", 'tgi fridays', 'outback steakhouse', 'texas roadhouse', 'cheesecake factory',
  'red lobster', 'cracker barrel', "p.f. chang's", 'pf changs', 'longhorn steakhouse', 'ruby tuesday',
  "carrabba's", "bj's restaurant", 'hooters', 'twin peaks', 'golden corral', 'village inn',
  'black bear diner', 'old spaghetti factory', "famous dave's", "bonefish grill", "maggiano's",
  'yard house', 'buca di beppo', 'rodizio grill', "ruth's chris", "fogo de chao", 'texas de brazil',
  "perkins", "bob evans", "waffle house", "red lobster", "olive garden italian",
  // Fast food / fast casual
  "mcdonald's", 'burger king', "wendy's", 'taco bell', 'kfc', 'subway', 'chipotle', 'panera',
  'panda express', 'five guys', 'in-n-out', 'chick-fil-a', "arby's", 'sonic drive-in', 'jack in the box',
  "carl's jr", 'popeyes', 'raising cane', 'wingstop', 'qdoba', 'del taco', 'shake shack', 'jimmy john',
  'firehouse subs', "jersey mike's", 'noodles & company', 'noodles and company', 'el pollo loco',
  "culver's", 'whataburger', 'smashburger', 'habit burger', 'cafe rio', 'café rio', 'costa vida',
  'cafe zupas', 'café zupas', 'swig', 'crumbl', "jcw's", 'teriyaki stix', 'betos', "beto's",
  "domino's", 'pizza hut', "papa john's", 'little caesars', 'papa murphy', 'mod pizza', 'blaze pizza',
  // Coffee / dessert
  'starbucks', 'dunkin', 'dutch bros', "peet's coffee", 'baskin-robbins', 'dairy queen', 'cold stone',
  'krispy kreme', 'cinnabon', 'jamba', 'tropical smoothie',
  // Entertainment chains
  "dave & buster's", 'dave and busters', 'main event', 'topgolf', 'round1', 'chuck e. cheese',
  'amc theatres', 'amc theaters', 'amc dine-in', 'regal cinemas', 'cinemark', 'megaplex', 'bowlero', 'urban air', 'sky zone',
].map(n => n.toLowerCase())

// Whole-word match so "Swig" is caught but "Swigert's Tavern" isn't
const CHAIN_PATTERNS = CHAIN_NAMES.map(c =>
  new RegExp(`(^|[^a-z0-9])${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`),
)

export function isChain(name: string | null | undefined): boolean {
  if (!name) return false
  const n = name.toLowerCase().replace(/[’`]/g, "'")
  return CHAIN_PATTERNS.some(re => re.test(n))
}

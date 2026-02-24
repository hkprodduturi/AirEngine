/**
 * AIR Element → JSX Tag + Tailwind Classes mapping
 *
 * Maps AIR element names and resolved modifiers to concrete
 * HTML tags and Tailwind utility classes.
 */

export interface ElementMapping {
  tag: string;
  className: string;
  selfClosing?: boolean;
  inputType?: string;
}

interface MappingEntry {
  tag: string;
  className: string;
  selfClosing?: boolean;
  inputType?: string;
  modifiers?: Record<string, Partial<ElementMapping>>;
}

const ELEMENT_MAP: Record<string, MappingEntry> = {
  header: {
    tag: 'header',
    className: 'flex flex-col sm:flex-row items-center justify-between gap-4 py-4 mb-2 border-b border-[var(--border)]',
  },
  footer: {
    tag: 'footer',
    className: 'mt-auto p-4 text-center text-sm text-[var(--muted)]',
  },
  main: {
    tag: 'main',
    className: 'flex-1 p-6 space-y-6',
  },
  sidebar: {
    tag: 'aside',
    className: 'w-64 min-h-screen border-r border-[var(--border)] p-5 flex flex-col gap-2',
  },
  row: {
    tag: 'div',
    className: 'flex flex-wrap gap-4 items-center',
    modifiers: {
      center: { className: 'flex flex-wrap gap-4 items-center justify-center' },
    },
  },
  grid: {
    tag: 'div',
    className: 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4',
    modifiers: {
      responsive: { className: 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4' },
      '1': { className: 'grid grid-cols-1 gap-4 max-w-lg mx-auto' },
      '2': { className: 'grid grid-cols-1 sm:grid-cols-2 gap-4' },
      '3': { className: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4' },
      '4': { className: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4' },
    },
  },
  card: {
    tag: 'div',
    className: 'rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-6 space-y-3 shadow-[var(--card-shadow)]',
  },
  btn: {
    tag: 'button',
    className: 'px-5 py-2.5 rounded-[var(--radius)] cursor-pointer transition-colors',
    modifiers: {
      primary: { className: 'bg-[var(--accent)] text-white px-5 py-2.5 rounded-[var(--radius)] font-medium hover:brightness-110 min-w-[80px] cursor-pointer transition-colors' },
      secondary: { className: 'border border-[var(--accent)] text-[var(--accent)] px-5 py-2.5 rounded-[var(--radius)] font-medium cursor-pointer hover:opacity-90 transition-colors' },
      ghost: { className: 'bg-transparent hover:bg-[var(--hover)] px-4 py-2 rounded-[var(--radius)] cursor-pointer transition-colors' },
      icon: { className: 'p-2 rounded-full hover:bg-[var(--hover)] cursor-pointer transition-colors' },
      submit: { className: 'w-full bg-[var(--accent)] text-white px-5 py-2.5 rounded-[var(--radius)] font-medium cursor-pointer hover:opacity-90 transition-colors' },
    },
  },
  input: {
    tag: 'input',
    className: 'rounded-[var(--radius)] px-3.5 py-2.5',
    selfClosing: true,
    modifiers: {
      text: { inputType: 'text' },
      number: { inputType: 'number' },
      email: { inputType: 'email' },
      password: { inputType: 'password' },
      search: { inputType: 'search' },
    },
  },
  select: {
    tag: 'select',
    className: 'border border-[var(--border-input)] rounded-[var(--radius)] px-3 py-2 bg-transparent focus:outline-none',
  },
  h1: {
    tag: 'h1',
    className: 'text-3xl font-bold',
    modifiers: {
      hero: { className: 'text-5xl md:text-6xl font-extrabold tracking-tight leading-tight' },
      display: { className: 'text-4xl md:text-5xl font-bold tracking-tight' },
    },
  },
  h2: {
    tag: 'h2',
    className: 'text-2xl font-semibold',
  },
  h3: {
    tag: 'h3',
    className: 'text-xl font-semibold',
  },
  p: {
    tag: 'p',
    className: '',
    modifiers: {
      muted: { className: 'text-[var(--muted)]' },
      center: { className: 'text-center' },
      small: { className: 'text-sm text-[var(--muted)]' },
      lead: { className: 'text-lg text-[var(--muted)] leading-relaxed max-w-2xl mx-auto text-center' },
    },
  },
  text: {
    tag: 'span',
    className: '',
  },
  badge: {
    tag: 'span',
    className: 'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-[var(--accent)]/20 text-[var(--accent)]',
  },
  list: {
    tag: 'ul',
    className: 'space-y-3',
  },
  table: {
    tag: 'table',
    className: 'w-full',
  },
  tabs: {
    tag: 'div',
    className: 'flex gap-2',
  },
  toggle: {
    tag: 'input',
    className: '',
    selfClosing: true,
    inputType: 'checkbox',
  },
  check: {
    tag: 'input',
    className: 'rounded',
    selfClosing: true,
    inputType: 'checkbox',
  },
  alert: {
    tag: 'div',
    className: 'border-l-4 border-red-500 bg-red-500/10 p-4 rounded',
    modifiers: {
      error: { className: 'border-l-4 border-red-500 bg-red-500/10 p-4 rounded' },
      success: { className: 'border-l-4 border-green-500 bg-green-500/10 p-4 rounded' },
      warning: { className: 'border-l-4 border-yellow-500 bg-yellow-500/10 p-4 rounded' },
    },
  },
  spinner: {
    tag: 'div',
    className: 'animate-spin h-6 w-6 border-2 border-current border-t-transparent rounded-full mx-auto',
  },
  link: {
    tag: 'a',
    className: 'text-[var(--accent)] hover:underline cursor-pointer block text-center text-sm',
    modifiers: {
      primary: { className: 'bg-[var(--accent)] text-white px-5 py-2.5 rounded-[var(--radius)] font-medium hover:brightness-110 cursor-pointer transition-colors inline-flex items-center justify-center no-underline' },
      secondary: { className: 'border border-[var(--accent)] text-[var(--accent)] px-5 py-2.5 rounded-[var(--radius)] font-medium cursor-pointer hover:opacity-90 transition-colors inline-flex items-center justify-center no-underline' },
      ghost: { className: 'bg-transparent hover:bg-[var(--hover)] px-4 py-2 rounded-[var(--radius)] cursor-pointer transition-colors inline-flex items-center justify-center no-underline' },
    },
  },
  form: {
    tag: 'form',
    className: 'space-y-5',
  },
  stat: {
    tag: 'div',
    className: 'rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-5',
  },
  progress: {
    tag: 'div',
    className: 'w-full bg-[var(--hover)] rounded-full h-3 overflow-hidden',
    modifiers: {
      bar: { className: 'w-full bg-[var(--hover)] rounded-full h-3 overflow-hidden' },
    },
  },
  chart: {
    tag: 'div',
    className: 'w-full h-64 border border-[var(--border)] rounded-[var(--radius)] flex items-center justify-center text-[var(--muted)]',
    modifiers: {
      line: {},
      bar: {},
    },
  },
  search: {
    tag: 'input',
    className: 'rounded-[var(--radius)] px-3.5 py-2.5',
    selfClosing: true,
    modifiers: {
      input: { inputType: 'search' },
    },
  },
  pagination: {
    tag: 'div',
    className: 'flex gap-2 items-center justify-center',
  },
  img: {
    tag: 'img',
    className: 'max-w-full rounded-[var(--radius)]',
    selfClosing: true,
  },
  icon: {
    tag: 'span',
    className: 'text-xl',
  },
  logo: {
    tag: 'div',
    className: 'text-xl font-bold',
  },
  nav: {
    tag: 'nav',
    className: 'flex flex-wrap gap-3 sm:gap-4',
    modifiers: {
      vertical: { className: 'flex flex-col gap-2' },
    },
  },
  slot: {
    tag: 'div',
    className: 'flex-1',
    modifiers: {
      content: { className: 'flex-1' },
    },
  },
  plan: {
    tag: 'div',
    className: 'rounded-[var(--radius)] border border-[var(--border)] p-6 flex flex-col items-center gap-4',
  },
  section: {
    tag: 'section',
    className: 'py-16 px-6 space-y-6',
  },
  code: {
    tag: 'code',
    className: 'font-mono text-sm bg-[var(--surface)] px-1.5 py-0.5 rounded',
    modifiers: {
      block: { tag: 'pre', className: 'font-mono text-sm bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius)] p-5 overflow-x-auto whitespace-pre leading-relaxed' },
    },
  },
  pre: {
    tag: 'pre',
    className: 'font-mono text-sm bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius)] p-5 overflow-x-auto whitespace-pre leading-relaxed',
  },
  divider: {
    tag: 'hr',
    className: 'border-t border-[var(--border)] my-8',
    selfClosing: true,
  },
  details: {
    tag: 'details',
    className: 'rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--card-shadow)] space-y-3 [&:not([open])]:pb-0 [&[open]]:pb-5 px-6 group',
  },
  summary: {
    tag: 'summary',
    className: "cursor-pointer select-none py-4 font-semibold text-lg list-none flex items-center justify-between marker:hidden after:content-['↓_Expand'] after:text-lg after:font-semibold after:text-[var(--muted)] group-open:after:content-['↑_Collapse']",
  },
};

/**
 * Look up an AIR element name + modifiers and return the JSX mapping.
 * Unknown elements soft-fail to a `<div>` with a data attribute.
 */
export function mapElement(element: string, modifiers: string[]): ElementMapping {
  const entry = ELEMENT_MAP[element];

  if (!entry) {
    // Unknown element — soft-fail
    return {
      tag: 'div',
      className: '',
    };
  }

  const base: ElementMapping = {
    tag: entry.tag,
    className: entry.className,
    selfClosing: entry.selfClosing,
    inputType: entry.inputType,
  };

  // Apply modifier overrides
  if (modifiers.length > 0 && entry.modifiers) {
    for (const mod of modifiers) {
      const override = entry.modifiers[mod];
      if (override) {
        if (override.className !== undefined) base.className = override.className;
        if (override.tag) base.tag = override.tag;
        if (override.inputType) base.inputType = override.inputType;
        if (override.selfClosing !== undefined) base.selfClosing = override.selfClosing;
      }
    }
  }

  return base;
}

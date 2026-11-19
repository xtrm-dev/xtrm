import { type LucideIcon } from "lucide-react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Blocks,
  Box,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Command,
  Copy,
  ExternalLink,
  File,
  FlaskConical,
  Folder,
  FolderTree,
  Gavel,
  GitBranch,
  GitCommit,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  History,
  Kanban,
  Layers,
  Link,
  List,
  ListFilter,
  Lock,
  Maximize,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Moon,
  MousePointer2,
  PanelLeft,
  PanelRight,
  Pin,
  PinOff,
  Plus,
  Radar,
  Radio,
  Search,
  Settings,
  Share2,
  SquareDot,
  SquareStack,
  Sun,
  Tag,
  Target,
  Trash2,
  UserRoundCheck,
  UserRoundCog,
  Workflow,
  X,
} from "lucide-react";

const registry = {
  activity: Activity,
  plus: Plus,
  check: Check,
  open: Maximize2,
  agent: MousePointer2,
  alert: AlertTriangle,
  chevronDown: ChevronDown,
  chevronRight: ChevronRight,
  chevronUp: ChevronUp,
  back: ArrowLeft,
  forward: ArrowRight,
  external: ExternalLink,
  program: Box,
  close: X,
  observability: Radar,
  issues: SquareStack,
  board: Kanban,
  list: List,
  comment: SquareDot,
  command: Command,
  copy: Copy,
  delete: Trash2,
  file: File,
  content: FolderTree,
  ci: Workflow,
  repositories: Folder,
  branch: GitBranch,
  commit: GitCommit,
  merge: GitMerge,
  pull: GitPullRequest,
  pullDraft: GitPullRequestDraft,
  pullClosed: GitPullRequestClosed,
  work: Layers,
  link: Link,
  live: Radio,
  filter: ListFilter,
  lock: Lock,
  maximize: Maximize,
  restore: Minimize2,
  moon: Moon,
  more: MoreHorizontal,
  pin: Pin,
  unpin: PinOff,
  search: Search,
  settings: Settings,
  graph: Share2,
  sidebar: PanelLeft,
  inspector: PanelRight,
  sun: Sun,
  release: Tag,
  target: Target,
  done: CheckCircle2,
  research: FlaskConical,
  agents: MousePointer2,
  assignment: UserRoundCheck,
  decision: Gavel,
  changes: History,
  specialists: UserRoundCog,
  skills: Blocks,
} as const satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof registry;

/**
 * The glyph ladder in rem, applied as CSS: the one place a glyph size is written. The class strings
 * stay literal because Tailwind scans source text; `ICON_REM` and `ICON_PX` both derive from this
 * object, so the ladder cannot drift into hand-maintained copies (XTRM-907 review of XTRM-897).
 *
 * The class is what the browser applies, so a glyph keeps its relation to the text beside it when
 * the root font size is not 16px (XTRM-897: a 13px glyph beside 9.75px body text).
 */
const SIZE_CLASS = {
  micro: "size-[0.75rem]",
  text: "size-[0.8125rem]",
  xs: "size-[0.875rem]",
  sm: "size-4",
  nav: "size-4",
  md: "size-[1.125rem]",
  lg: "size-5",
} as const;

export type IconSize = keyof typeof SIZE_CLASS;

/** `size-4` → 1rem, `size-[0.8125rem]` → 0.8125. */
const remOf = (className: string) => {
  const bracket = className.match(/^size-\[([\d.]+)rem\]$/);
  if (bracket) return Number(bracket[1]);
  const step = className.match(/^size-(\d+)$/);
  return step ? Number(step[1]) * 0.25 : Number.NaN;
};

/** The rem size each icon size resolves to, derived from `SIZE_CLASS`. */
export const ICON_REM = Object.fromEntries(
  Object.entries(SIZE_CLASS).map(([size, className]) => [size, remOf(className)]),
) as Record<IconSize, number>;

/**
 * The px a size has at a 16px root. Only the SVG `size` attribute uses it, as the no-CSS fallback.
 */
export const ICON_PX = Object.fromEntries(
  Object.entries(ICON_REM).map(([size, rem]) => [size, Math.round(rem * 16)]),
) as Record<IconSize, number>;

/** The rem class of one ladder step, so a glyph outside Lucide (the octocat mark) reuses the ladder. */
export const ICON_CLASS: Record<IconSize, string> = SIZE_CLASS;

/**
 * Lucide ships 2; the sidebar and the tables read better at 2.25
 * (docs/mocks/sidebar-weight-connection-activity.html A1). At 12–13px the smaller weight closes the
 * counters of `git-pull-request` and its siblings (docs/design/console-ui-system.md §3.2).
 */
const defaultStroke = (size: IconSize) => (size === "text" || size === "micro" ? 2 : 2.25);

export function Icon({
  name,
  size = "sm",
  strokeWidth,
  className,
}: {
  name: IconName;
  size?: IconSize;
  strokeWidth?: number;
  className?: string;
}) {
  const Comp = registry[name];
  return (
    <Comp
      size={ICON_PX[size]}
      strokeWidth={strokeWidth ?? defaultStroke(size)}
      className={className ? `${SIZE_CLASS[size]} ${className}` : SIZE_CLASS[size]}
      aria-hidden
    />
  );
}

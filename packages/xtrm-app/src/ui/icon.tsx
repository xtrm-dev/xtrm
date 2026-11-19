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

const SIZES = { micro: 12, text: 13, xs: 14, sm: 16, nav: 16, md: 18, lg: 20 } as const;

/**
 * The same ladder in rem, applied as CSS. The `size` attribute is a fixed px fallback; the class is
 * what the browser uses, so a glyph keeps its relation to the text beside it when the root font size
 * is not 16px (XTRM-897: a 13px glyph beside 9.75px body text). Class values equal `SIZES` at a
 * 16px root and the unit test pins that equivalence.
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

/** The rem size each icon size resolves to; the unit test compares it with `SIZES`. */
export const ICON_REM = { micro: 0.75, text: 0.8125, xs: 0.875, sm: 1, nav: 1, md: 1.125, lg: 1.25 } as const;

/**
 * Lucide ships 2; the sidebar and the tables read better at 2.25
 * (docs/mocks/sidebar-weight-connection-activity.html A1). At 12–13px the smaller weight closes the
 * counters of `git-pull-request` and its siblings (docs/design/console-ui-system.md §3.2).
 */
const defaultStroke = (size: keyof typeof SIZES) => (size === "text" || size === "micro" ? 2 : 2.25);

export function Icon({
  name,
  size = "sm",
  strokeWidth,
  className,
}: {
  name: IconName;
  size?: keyof typeof SIZES;
  strokeWidth?: number;
  className?: string;
}) {
  const Comp = registry[name];
  return (
    <Comp
      size={SIZES[size]}
      strokeWidth={strokeWidth ?? defaultStroke(size)}
      className={className ? `${SIZE_CLASS[size]} ${className}` : SIZE_CLASS[size]}
      aria-hidden
    />
  );
}

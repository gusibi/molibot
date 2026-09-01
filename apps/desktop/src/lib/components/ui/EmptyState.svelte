<script lang="ts">
  import Activity from "reicon-svelte/icons/Activity";
  import Bell from "reicon-svelte/icons/Bell";
  import Box from "reicon-svelte/icons/Box";
  import ChartLine from "reicon-svelte/icons/ChartLine";
  import ChatDots from "reicon-svelte/icons/ChatDots";
  import CheckCircle from "reicon-svelte/icons/CheckCircle";
  import CloudCross from "reicon-svelte/icons/CloudCross";
  import Cpu from "reicon-svelte/icons/Cpu";
  import Eye from "reicon-svelte/icons/Eye";
  import EyeSlash from "reicon-svelte/icons/EyeSlash";
  import FileText from "reicon-svelte/icons/FileText";
  import Film from "reicon-svelte/icons/Film";
  import History from "reicon-svelte/icons/History";
  import Image from "reicon-svelte/icons/Image";
  import Inbox from "reicon-svelte/icons/Inbox";
  import Magnifier from "reicon-svelte/icons/Magnifier";
  import Plug from "reicon-svelte/icons/Plug";
  import PlugCircle from "reicon-svelte/icons/PlugCircle";
  import Pulse from "reicon-svelte/icons/Pulse";
  import Ranking from "reicon-svelte/icons/Ranking";
  import Search from "reicon-svelte/icons/Search";
  import ShieldAlert from "reicon-svelte/icons/ShieldAlert";
  import ShieldSlash from "reicon-svelte/icons/ShieldSlash";
  import Sparkle from "reicon-svelte/icons/Sparkle";
  import Speaker from "reicon-svelte/icons/Speaker";
  import Timer from "reicon-svelte/icons/Timer";
  import TriangleWarning from "reicon-svelte/icons/TriangleWarning";
  import User from "reicon-svelte/icons/User";
  import type { ReiconComponent } from "./iconTypes";

  const EMPTY_STATE_ICONS = {
    activity: Activity,
    bell: Bell,
    "chart-line": ChartLine,
    "chat-circle-dots": ChatDots,
    "check-circle": CheckCircle,
    "clock-countdown": Timer,
    "clock-counter-clockwise": History,
    "cloud-slash": CloudCross,
    cpu: Cpu,
    cube: Box,
    eye: Eye,
    "eye-slash": EyeSlash,
    "file-text": FileText,
    "film-strip": Film,
    image: Image,
    "list-magnifying-glass": Search,
    "magnifying-glass": Magnifier,
    plugs: Plug,
    "plugs-connected": PlugCircle,
    pulse: Pulse,
    ranking: Ranking,
    robot: Cpu,
    "shield-slash": ShieldSlash,
    "shield-warning": ShieldAlert,
    sparkle: Sparkle,
    "speaker-high": Speaker,
    tray: Inbox,
    user: User,
    "warning-circle": TriangleWarning
  } satisfies Record<string, ReiconComponent>;

  type EmptyStateIcon = keyof typeof EMPTY_STATE_ICONS;

  export let title: string;
  export let description = "";
  export let icon: EmptyStateIcon = "tray";

  $: Icon = EMPTY_STATE_ICONS[icon];
</script>

<div class="section-empty" role="status">
  <Icon class="section-empty-icon" size={24} aria-hidden="true" />
  <strong>{title}</strong>
  {#if description}<p>{description}</p>{/if}
  <div class="section-empty-action"><slot /></div>
</div>

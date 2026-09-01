import type { ReiconComponent } from "../components/ui/iconTypes";

export interface FileMenuItem {
  id: string;
  label: string;
  icon: ReiconComponent;
  /** Renders a separator above this item. */
  startsGroup?: boolean;
  disabled?: boolean;
}

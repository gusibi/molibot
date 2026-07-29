export interface FileMenuItem {
  id: string;
  label: string;
  icon: string;
  /** Renders a separator above this item. */
  startsGroup?: boolean;
  disabled?: boolean;
}

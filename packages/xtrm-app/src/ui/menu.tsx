import { Menu } from "@base-ui/react/menu";
import type { ReactNode } from "react";
import { Icon, type IconName } from "./icon.tsx";
import { IconButton } from "./primitives.tsx";

export interface OptionItem {
  label: string;
  icon?: IconName;
  onSelect: () => void;
  disabled?: boolean;
}

/** `⋯` options menu for surface and drawer headers (§4.4). A Base UI menu, not a toolbar. */
export function OptionsMenu({ label = "Options", items, header, trigger }: { label?: string; items: OptionItem[]; header?: ReactNode; trigger?: React.ReactElement }) {
  return (
    <Menu.Root>
      <Menu.Trigger render={trigger ?? <IconButton icon="more" label={label} />} />
      <Menu.Portal>
        <Menu.Positioner align="end" sideOffset={4} className="z-50">
          <Menu.Popup className="min-w-48 rounded-lg bg-raised p-1 text-sm shadow-float outline-none">
            {header && <div className="px-2 pt-1 pb-1.5 text-xs text-ink-faint">{header}</div>}
            {items.map((item) => (
              <Menu.Item
                key={item.label}
                disabled={item.disabled}
                onClick={item.onSelect}
                className="flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-ink-muted outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-hover data-[highlighted]:text-ink"
              >
                {item.icon && <Icon name={item.icon} size="xs" />}
                {item.label}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
